import crypto from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import { env } from "./config.js";
import { api, processCashfreeWebhook } from "./routes.js";
import { verifyCashfreeWebhook } from "./providers/cashfree.js";

const app = express();
app.use(helmet());

app.post("/v1/webhooks/cashfree", express.raw({ type: "application/json" }), async (req, res, next) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const valid = verifyCashfreeWebhook(
      rawBody,
      req.header("x-webhook-signature"),
      req.header("x-webhook-timestamp")
    );
    if (!valid) return res.status(401).json({ error: "INVALID_WEBHOOK_SIGNATURE" });

    const event = JSON.parse(rawBody);
    const providerEventId = crypto.createHash("sha256").update(rawBody).digest("hex");
    const amount = event?.data?.payment?.payment_amount ?? event?.payment?.payment_amount;
    await processCashfreeWebhook(
      event,
      providerEventId,
      amount == null ? undefined : Math.round(Number(amount) * 100)
    );
    res.status(200).json({ received: true });
  } catch (error) { next(error); }
});

app.use(express.json({ limit: "256kb" }));
app.use("/api", api);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
});

app.listen(env.PORT, () => console.log("Suraj Rai Pay API listening on port " + env.PORT));
