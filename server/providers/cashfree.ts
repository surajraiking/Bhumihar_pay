import crypto from "node:crypto";
import { cashfreeBaseUrl, env } from "../config.js";

export type CashfreeOrder = {
  order_id: string;
  payment_session_id?: string;
  order_status?: string;
  order_amount?: number;
  order_currency?: string;
};

function credentialsRequired(): void {
  if (!env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY) {
    throw new Error("Cashfree credentials are not configured");
  }
}

async function cashfreeFetch(path: string, init: RequestInit = {}): Promise<Response> {
  credentialsRequired();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("x-client-id", env.CASHFREE_APP_ID!);
  headers.set("x-client-secret", env.CASHFREE_SECRET_KEY!);
  headers.set("x-api-version", env.CASHFREE_API_VERSION);
  return fetch(cashfreeBaseUrl + path, { ...init, headers });
}

export async function createCashfreeOrder(input: {
  orderId: string;
  amountPaise: number;
  customerId: string;
  customerPhone: string;
  customerEmail?: string;
  returnUrl: string;
  notifyUrl: string;
}): Promise<CashfreeOrder> {
  const response = await cashfreeFetch("/orders", {
    method: "POST",
    body: JSON.stringify({
      order_id: input.orderId,
      order_amount: input.amountPaise / 100,
      order_currency: "INR",
      customer_details: {
        customer_id: input.customerId,
        customer_phone: input.customerPhone,
        customer_email: input.customerEmail
      },
      order_meta: {
        return_url: input.returnUrl,
        notify_url: input.notifyUrl
      }
    })
  });
  const data = await response.json() as CashfreeOrder & { message?: string };
  if (!response.ok) throw new Error(data.message || "Cashfree order creation failed");
  return data;
}

export async function getCashfreeOrder(orderId: string): Promise<CashfreeOrder> {
  const response = await cashfreeFetch("/orders/" + encodeURIComponent(orderId));
  const data = await response.json() as CashfreeOrder & { message?: string };
  if (!response.ok) throw new Error(data.message || "Cashfree status lookup failed");
  return data;
}

export function verifyCashfreeWebhook(rawBody: string, signature: string | undefined, timestamp: string | undefined): boolean {
  if (!env.CASHFREE_WEBHOOK_SECRET || !signature || !timestamp) return false;
  const expected = crypto
    .createHmac("sha256", env.CASHFREE_WEBHOOK_SECRET)
    .update(timestamp + rawBody)
    .digest("base64");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
