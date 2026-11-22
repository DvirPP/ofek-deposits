CREATE SCHEMA desk;
CREATE SCHEMA deposits;
CREATE SCHEMA agent;

REVOKE ALL ON SCHEMA desk FROM PUBLIC;
REVOKE ALL ON SCHEMA deposits FROM PUBLIC;
REVOKE ALL ON SCHEMA agent FROM PUBLIC;

CREATE TABLE desk.bankers (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO desk.bankers (id, username, password_hash, display_name)
VALUES (
  '6f1c2a40-7b3e-4d1a-9c55-2a8e0f4b6d11',
  'teller',
  'a1b2c3d4e5f67890a1b2c3d4e5f67890:99bbae8a883a675c7ded4b4b28168ba934baa2976bf878b9837124a490ede11e',
  'Dana Levi'
);

CREATE TABLE desk.sessions (
  token text PRIMARY KEY,
  banker_id uuid NOT NULL REFERENCES desk.bankers (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE desk.load_journal (
  load_id uuid PRIMARY KEY,
  banker_id uuid NOT NULL REFERENCES desk.bankers (id),
  file_name text NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decision text,
  decided_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}',
  preview jsonb,
  CHECK (decision IS NULL OR decision IN ('yes', 'no'))
);

CREATE INDEX load_journal_hash_idx ON desk.load_journal (content_hash, created_at DESC);
CREATE UNIQUE INDEX load_journal_one_open_hash ON desk.load_journal (content_hash) WHERE decision IS NULL;

CREATE TABLE desk.customers (
  customer_id text PRIMARY KEY,
  full_name text,
  national_id text,
  phone text,
  email text,
  city text,
  segment text,
  branch_code text,
  branch_name text,
  account_number text,
  status text,
  opened_date date,
  load_id uuid REFERENCES desk.load_journal (load_id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE desk.customer_rejections (
  load_id uuid NOT NULL REFERENCES desk.load_journal (load_id),
  row_number integer NOT NULL,
  customer_id text,
  reason text NOT NULL,
  PRIMARY KEY (load_id, row_number)
);

CREATE TABLE desk.processing_batches (
  batch_id uuid PRIMARY KEY,
  banker_id uuid NOT NULL REFERENCES desk.bankers (id),
  kind text NOT NULL CHECK (kind IN ('process', 'retry')),
  deposit_count integer NOT NULL,
  totals jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE desk.intake_deposits (
  intake_id uuid PRIMARY KEY,
  load_id uuid NOT NULL REFERENCES desk.load_journal (load_id),
  row_number integer NOT NULL,
  deposit_id text,
  customer_id text,
  account_number text,
  deposit_type text,
  amount numeric,
  currency text,
  deposit_date date,
  term_months integer,
  interest_rate numeric,
  maturity_date date,
  channel text,
  source_status text,
  notes text,
  failure_reason text,
  attempts integer NOT NULL DEFAULT 0,
  customer_status text,
  accepted boolean NOT NULL,
  canonical boolean NOT NULL,
  rejection_reason text,
  batch_id uuid REFERENCES desk.processing_batches (batch_id),
  submitted_at timestamptz,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (load_id, row_number)
);

CREATE UNIQUE INDEX intake_canonical_deposit
  ON desk.intake_deposits (deposit_id)
  WHERE canonical AND deposit_id IS NOT NULL;

CREATE INDEX intake_pending_idx
  ON desk.intake_deposits (deposit_id)
  WHERE canonical AND accepted AND submitted_at IS NULL;

CREATE TABLE deposits.exchange_rates (
  currency text PRIMARY KEY,
  ils_per_unit numeric NOT NULL
);

INSERT INTO deposits.exchange_rates (currency, ils_per_unit) VALUES
  ('ILS', 1),
  ('USD', 3.7),
  ('EUR', 4);

CREATE TABLE deposits.retry_policy (
  reason text PRIMARY KEY
);

INSERT INTO deposits.retry_policy (reason) VALUES
  ('Core banking timeout'),
  ('Kafka broker unavailable'),
  ('Database deadlock');

CREATE TABLE deposits.cases (
  deposit_id text PRIMARY KEY,
  load_id uuid NOT NULL,
  batch_id uuid,
  customer_id text,
  account_number text,
  customer_status text,
  deposit_type text,
  amount numeric,
  currency text,
  deposit_date date,
  term_months integer,
  interest_rate numeric,
  maturity_date date,
  channel text,
  source_status text,
  notes text,
  failure_reason text,
  attempts integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('Processing', 'Completed', 'Failed', 'PendingApproval')),
  decision_reason text,
  amount_ils numeric,
  intent text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deposits.status_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id text NOT NULL REFERENCES deposits.cases (deposit_id),
  status text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE deposits.movements (
  deposit_id text PRIMARY KEY REFERENCES deposits.cases (deposit_id),
  account_number text NOT NULL,
  currency text NOT NULL,
  amount numeric NOT NULL,
  available_for_withdrawal boolean NOT NULL,
  maturity_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deposits.balances (
  account_number text NOT NULL,
  currency text NOT NULL,
  available_amount numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_number, currency)
);

CREATE VIEW agent.customers WITH (security_invoker = false) AS
SELECT
  customer_id,
  full_name,
  email,
  city,
  segment,
  branch_code,
  branch_name,
  account_number,
  status,
  opened_date
FROM desk.customers;

CREATE VIEW agent.intake_deposits WITH (security_invoker = false) AS
SELECT
  i.deposit_id,
  i.load_id,
  i.customer_id,
  i.account_number,
  i.deposit_type,
  i.amount,
  i.currency,
  i.deposit_date,
  i.term_months,
  i.interest_rate,
  i.maturity_date,
  i.channel,
  i.source_status,
  i.notes,
  i.failure_reason,
  i.attempts,
  i.accepted,
  i.rejection_reason,
  i.customer_status,
  i.submitted_at,
  i.loaded_at,
  (p.reason IS NOT NULL) AS retryable
FROM desk.intake_deposits i
LEFT JOIN deposits.retry_policy p ON p.reason = i.failure_reason
WHERE i.canonical;

CREATE VIEW agent.cases WITH (security_invoker = false) AS
SELECT
  c.deposit_id,
  c.load_id,
  c.batch_id,
  c.customer_id,
  c.account_number,
  c.customer_status,
  c.deposit_type,
  c.amount,
  c.currency,
  c.deposit_date,
  c.term_months,
  c.interest_rate,
  c.maturity_date,
  c.channel,
  c.source_status,
  c.notes,
  c.failure_reason,
  c.attempts,
  c.status,
  c.decision_reason,
  c.amount_ils,
  c.intent,
  c.updated_at,
  (p.reason IS NOT NULL) AS retryable
FROM deposits.cases c
LEFT JOIN deposits.retry_policy p ON p.reason = COALESCE(c.decision_reason, c.failure_reason);

CREATE VIEW agent.status_events WITH (security_invoker = false) AS
SELECT event_id, deposit_id, status, reason, created_at
FROM deposits.status_events;

CREATE VIEW agent.movements WITH (security_invoker = false) AS
SELECT deposit_id, account_number, currency, amount, available_for_withdrawal, maturity_date, created_at
FROM deposits.movements;

CREATE VIEW agent.balances WITH (security_invoker = false) AS
SELECT account_number, currency, available_amount, updated_at
FROM deposits.balances;

CREATE VIEW agent.exchange_rates WITH (security_invoker = false) AS
SELECT currency, ils_per_unit
FROM deposits.exchange_rates;

CREATE VIEW agent.retry_policy WITH (security_invoker = false) AS
SELECT reason
FROM deposits.retry_policy;

CREATE VIEW agent.load_journal WITH (security_invoker = false) AS
SELECT load_id, banker_id, file_name, content_hash, created_at, decision, decided_at, summary
FROM desk.load_journal;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'desk_user') THEN
    CREATE ROLE desk_user LOGIN PASSWORD 'desk_user' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'deposits_user') THEN
    CREATE ROLE deposits_user LOGIN PASSWORD 'deposits_user' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_reader') THEN
    CREATE ROLE agent_reader LOGIN PASSWORD 'agent_reader' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE ofek TO desk_user, deposits_user, agent_reader;
GRANT USAGE ON SCHEMA desk TO desk_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA desk TO desk_user;
GRANT USAGE ON SCHEMA deposits TO deposits_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA deposits TO deposits_user;
GRANT USAGE ON SCHEMA agent TO agent_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA agent TO agent_reader;

ALTER ROLE desk_user SET search_path = desk;
ALTER ROLE deposits_user SET search_path = deposits;
ALTER ROLE agent_reader SET search_path = agent;
ALTER ROLE agent_reader SET default_transaction_read_only = on;
ALTER ROLE agent_reader SET statement_timeout = '5s';
