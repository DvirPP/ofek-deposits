CREATE TABLE bankers (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO bankers (id, username, password_hash, display_name)
VALUES (
  '6f1c2a40-7b3e-4d1a-9c55-2a8e0f4b6d11',
  'teller',
  'a1b2c3d4e5f67890a1b2c3d4e5f67890:99bbae8a883a675c7ded4b4b28168ba934baa2976bf878b9837124a490ede11e',
  'Dana Levi'
);

CREATE TABLE sessions (
  token text PRIMARY KEY,
  banker_id uuid NOT NULL REFERENCES bankers (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE load_journal (
  load_id uuid PRIMARY KEY,
  banker_id uuid NOT NULL REFERENCES bankers (id),
  file_name text NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decision text,
  decided_at timestamptz,
  summary jsonb NOT NULL
);

CREATE TABLE customers (
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
  load_id uuid REFERENCES load_journal (load_id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deposits (
  deposit_id text PRIMARY KEY,
  load_id uuid NOT NULL,
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
  decision text NOT NULL,
  decision_reason text,
  loaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE movements (
  deposit_id text PRIMARY KEY REFERENCES deposits (deposit_id),
  account_number text NOT NULL,
  currency text NOT NULL,
  amount numeric NOT NULL,
  available_for_withdrawal boolean NOT NULL,
  maturity_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE balances (
  account_number text NOT NULL,
  currency text NOT NULL,
  available_amount numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_number, currency)
);
