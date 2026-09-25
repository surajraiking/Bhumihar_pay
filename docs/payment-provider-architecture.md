# Suraj Rai Pay — Real Payment Provider Architecture

## Product boundary
Suraj Rai Pay can have its own branding and user experience, but regulated payment functions must be supplied through authorized partners unless Suraj Rai Pay itself obtains the required approvals.

Launch model:
- Merchant checkout and UPI acceptance: provider such as Cashfree or Razorpay.
- Recharge and bill payments: authorized recharge provider and/or BBPS-enabled partner.
- Payouts: authorized payout provider after required onboarding.
- Full consumer UPI app features such as bank-account linking, P2P send/receive and UPI PIN flows require the appropriate PSP-bank/NPCI TPAP route; a normal payment-gateway API is not a substitute.

NPCI's UPI material describes third-party UPI apps operating with PSP-bank arrangements and security/audit requirements. UPI PINs must remain inside the approved bank/PSP flow and must never be collected by Suraj Rai Pay.

## Target architecture
Android App → API Gateway → Auth/User → Payment Orchestrator → Provider Adapter
                                      → Recharge/Bill Orchestrator
                                      → Payout Orchestrator
                                      → Ledger
                                      → Webhook Receiver
                                      → Risk/Fraud
                                      → Notifications
                                      → Reconciliation/Admin

Data layer: PostgreSQL + Redis/queue + object storage.

## Provider abstraction
Use a provider-neutral internal interface:
- createOrder()
- getPaymentStatus()
- refund()
- createPaymentLink()
- verifyWebhook()

Adapters should live separately, for example providers/cashfree and providers/razorpay. Business logic must never call a provider SDK directly.

## Payment state machine
CREATED → PENDING → SUCCESS
                     ↘ FAILED
                     ↘ CANCELLED
SUCCESS → REFUND_PENDING → REFUNDED

The Android callback is never authoritative. The backend verifies the provider webhook and/or queries the provider before marking a payment successful.

## Database
Minimum production tables:
users, user_devices, kyc_profiles, payment_orders, payment_attempts, payment_events, ledger_accounts, ledger_entries, refunds, payouts, recharges, bill_payments, webhook_events, provider_credentials, reconciliation_runs, audit_logs, support_tickets.

Financial records should contain internal UUID, provider IDs, idempotency key, amount in paise, currency, status and timestamps.

Never store UPI PIN, card CVV, OTP or provider secrets.

## Idempotency
Every money-moving request gets a server-side idempotency key. Database uniqueness must prevent duplicate order creation, duplicate webhook effects, duplicate refunds and duplicate recharge execution.

Webhook processing: verify signature → check event ID → persist raw event → process once → mark processed.

## API contract
Auth: POST /v1/auth/send-otp, POST /v1/auth/verify-otp, POST /v1/auth/refresh, POST /v1/auth/logout
Payments: POST /v1/payments/orders, GET /v1/payments/orders/{id}, POST /v1/payments/orders/{id}/refund, GET /v1/payments/orders/{id}/events
Transactions: GET /v1/transactions, GET /v1/transactions/{id}
Webhooks: POST /v1/webhooks/cashfree, POST /v1/webhooks/razorpay

## Ledger
Use a double-entry ledger rather than calculating balances from UI transaction history. Keep provider clearing, customer funds, merchant payable, fees and refunds as separate ledger accounts.

Example: a ₹100 payment creates a balanced debit/credit movement; provider fees are separate ledger events.

## Recharge and bills
Keep recharge and bill payment adapters separate from payment-gateway adapters.
Recharge interface: getOperators, validateNumber, createRecharge, getRechargeStatus, verifyWebhook.
Bill interface: fetchCategories, fetchBiller, fetchCustomerParameters, fetchBill, payBill, getStatus, verifyWebhook.
If using BBPS, onboard through an authorized BBPS participant/partner rather than representing the app as BBPS itself.

## UPI roadmap
Phase A: provider-backed merchant payments — UPI checkout, QR/intent where supported, status, refunds, payment links and transaction history.
Phase B: merchant acceptance — dynamic QR, merchant KYB, settlements and disputes.
Phase C: full UPI app capability — PSP bank partnership, NPCI TPAP onboarding, device binding, account linking, approved UPI authentication, send/receive, mandates and dispute/fraud workflows.

## Secrets
Provider credentials belong only on the backend. Android must receive none of them. Use CI encrypted secrets and a production secret manager.

## Environments
Development → provider sandbox + test DB.
Staging → sandbox + staging DB + test webhooks.
Production → live provider account + production DB + production webhooks.

## Reconciliation
Compare provider transactions against internal payment_orders, ledger_entries and settlement reports. Exceptions become reconciliation cases for admin review.

## Observability
Track payment success/failure, provider latency, webhook latency, signature failures, duplicate events, reconciliation mismatches, refund failures and pending recharge/bill durations.

Do not log UPI PIN, OTP, CVV, authentication credentials or API secrets.

## Implementation order
1. Backend + PostgreSQL.
2. Auth/device security.
3. Provider abstraction.
4. First provider in sandbox.
5. Signed webhooks.
6. Payment state machine.
7. Double-entry ledger.
8. Reconciliation.
9. Refunds.
10. Recharge provider.
11. BBPS-enabled bill provider.
12. Merchant KYB.
13. Payouts.
14. PSP-bank/NPCI route for full UPI capabilities.

Current Android app remains the client layer until this backend is connected.