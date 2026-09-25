CREATE TABLE IF NOT EXISTS payment_orders (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_order_id TEXT UNIQUE,
  provider_session_id TEXT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CREATED','PENDING','SUCCESS','FAILED','CANCELLED','REFUND_PENDING','REFUNDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY,
  payment_order_id TEXT NOT NULL REFERENCES payment_orders(id),
  provider_event_id TEXT UNIQUE NOT NULL,
  provider_payment_id TEXT,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY,
  payment_order_id TEXT NOT NULL REFERENCES payment_orders(id),
  direction TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  account TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_orders_status_idx ON payment_orders(status);
CREATE INDEX IF NOT EXISTS payment_events_order_idx ON payment_events(payment_order_id);
CREATE INDEX IF NOT EXISTS ledger_order_idx ON ledger_entries(payment_order_id);
