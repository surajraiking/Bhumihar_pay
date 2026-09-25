import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import { pool, withTransaction } from "./db.js";
import { env } from "./config.js";
import { createCashfreeOrder, getCashfreeOrder } from "./providers/cashfree.js";

export const api = express.Router();

const createPaymentSchema = z.object({
  amountPaise: z.number().int().min(100).max(100000000),
  customerId: z.string().min(1).max(100),
  customerPhone: z.string().regex(/^\+?[0-9]{10,15}$/),
  customerEmail: z.string().email().optional(),
  purpose: z.enum(["MERCHANT_PAYMENT", "CHECKOUT"]).default("CHECKOUT")
});

api.get("/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "suraj-rai-pay-api", environment: env.NODE_ENV });
  } catch (error) { next(error); }
});

api.post("/v1/payments/orders", async (req, res, next) => {
  try {
    const input = createPaymentSchema.parse(req.body);
    const orderId = "srp_" + crypto.randomUUID().replaceAll("-", "").slice(0, 24);
    const returnUrl = env.PUBLIC_BASE_URL ? env.PUBLIC_BASE_URL + "/api/v1/payments/return" : "https://example.invalid/payment-return";
    const notifyUrl = env.PUBLIC_BASE_URL ? env.PUBLIC_BASE_URL + "/v1/webhooks/cashfree" : "https://example.invalid/webhook";

    await pool.query(
      "INSERT INTO payment_orders (id, provider, amount_paise, currency, purpose, status) VALUES ($1,$2,$3,$4,$5,$6)",
      [orderId, "cashfree", input.amountPaise, "INR", input.purpose, "CREATED"]
    );

    try {
      const providerOrder = await createCashfreeOrder({
        orderId,
        amountPaise: input.amountPaise,
        customerId: input.customerId,
        customerPhone: input.customerPhone,
        customerEmail: input.customerEmail,
        returnUrl,
        notifyUrl
      });

      await pool.query(
        "UPDATE payment_orders SET provider_order_id=$1, provider_session_id=$2, status=$3, updated_at=now() WHERE id=$4",
        [providerOrder.order_id, providerOrder.payment_session_id ?? null, "PENDING", orderId]
      );

      res.status(201).json({
        orderId,
        provider: "cashfree",
        paymentSessionId: providerOrder.payment_session_id,
        status: "PENDING"
      });
    } catch (providerError) {
      await pool.query("UPDATE payment_orders SET status='FAILED', updated_at=now() WHERE id=$1", [orderId]);
      throw providerError;
    }
  } catch (error) { next(error); }
});

api.get("/v1/payments/orders/:id", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM payment_orders WHERE id=$1", [req.params.id]);
    const order = result.rows[0];
    if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });

    if (order.provider_order_id) {
      const remote = await getCashfreeOrder(order.provider_order_id);
      res.json({ orderId: order.id, status: mapStatus(remote.order_status), providerStatus: remote.order_status });
      return;
    }
    res.json({ orderId: order.id, status: order.status });
  } catch (error) { next(error); }
});

function mapStatus(status?: string): string {
  switch (status) {
    case "PAID": return "SUCCESS";
    case "ACTIVE": return "PENDING";
    case "EXPIRED":
    case "TERMINATED": return "FAILED";
    default: return "PENDING";
  }
}

api.get("/v1/payments/return", async (req, res) => {
  res.status(200).json({
    message: "Payment return received. Query the backend for the authoritative status.",
    orderId: req.query.order_id ?? null
  });
});

export async function processCashfreeWebhook(
  event: any,
  providerEventId: string,
  providerPaymentAmountPaise?: number
) {
  const orderId = event?.order?.order_id ?? event?.data?.order?.order_id;
  const paymentStatus = event?.payment?.payment_status ?? event?.data?.payment?.payment_status;
  const paymentId = event?.payment?.cf_payment_id ?? event?.data?.payment?.cf_payment_id;
  if (!orderId) return;

  const status = paymentStatus === "SUCCESS" ? "SUCCESS"
    : paymentStatus === "FAILED" ? "FAILED"
    : "PENDING";

  await withTransaction(async (client) => {
    const order = await client.query(
      "SELECT * FROM payment_orders WHERE provider_order_id=$1 FOR UPDATE",
      [orderId]
    );
    if (!order.rows[0]) return;

    const inserted = await client.query(
      "INSERT INTO payment_events (id, payment_order_id, provider_event_id, provider_payment_id, event_type, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (provider_event_id) DO NOTHING RETURNING id",
      [crypto.randomUUID(), order.rows[0].id, providerEventId, paymentId ?? null, paymentStatus ?? "UNKNOWN", JSON.stringify(event)]
    );
    if (!inserted.rowCount) return;

    const amountMatches = providerPaymentAmountPaise == null ||
      Number(providerPaymentAmountPaise) === Number(order.rows[0].amount_paise);

    if (status === "SUCCESS" && order.rows[0].status !== "SUCCESS" && amountMatches) {
      await client.query(
        "UPDATE payment_orders SET status='SUCCESS', updated_at=now() WHERE id=$1",
        [order.rows[0].id]
      );
      await client.query(
        "INSERT INTO ledger_entries (id, payment_order_id, direction, amount_paise, currency, account) VALUES ($1,$2,$3,$4,$5,$6)",
        [crypto.randomUUID(), order.rows[0].id, "CREDIT", order.rows[0].amount_paise, "INR", "provider_clearing"]
      );
    } else if (status === "FAILED" && ["CREATED", "PENDING"].includes(order.rows[0].status)) {
      await client.query(
        "UPDATE payment_orders SET status='FAILED', updated_at=now() WHERE id=$1",
        [order.rows[0].id]
      );
    }
  });
}
