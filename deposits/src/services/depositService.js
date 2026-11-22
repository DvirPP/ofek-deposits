const db = require("../integration/db");

const ILS_RATES = { ILS: 1, USD: 3.7, EUR: 4 };
const APPROVAL_THRESHOLD_ILS = 1_000_000;
const RETRYABLE_FAILURES = new Set([
  "Core banking timeout",
  "Kafka broker unavailable",
  "Database deadlock",
]);

function parse(value) {
  let body;
  try {
    body = JSON.parse(value.toString());
  } catch {
    return { ok: false, reason: "Invalid JSON", payload: value?.toString() ?? null };
  }
  if (!body || !body.depositId || !body.loadId) {
    return { ok: false, reason: "Missing depositId or loadId", payload: body };
  }
  return { ok: true, deposit: body };
}

async function apply(deposit) {
  return db.transaction(async () => {
    const existing = await db.query(
      `SELECT deposit_id, load_id, decision, decision_reason, amount, currency, deposit_type
       FROM deposits WHERE deposit_id = $1`,
      [deposit.depositId],
    );
    if (existing.rowCount > 0) {
      return outcomeFromRow(existing.rows[0], true);
    }

    const customer = await findCustomer(deposit.customerId);
    const decision = classify(deposit, customer);
    await db.query(
      `INSERT INTO deposits (
         deposit_id, load_id, customer_id, account_number, deposit_type, amount, currency,
         deposit_date, term_months, interest_rate, maturity_date, channel, source_status,
         notes, failure_reason, attempts, decision, decision_reason
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        deposit.depositId,
        deposit.loadId,
        empty(deposit.customerId),
        empty(deposit.accountNumber),
        empty(deposit.depositType),
        numberOrNull(deposit.amount),
        empty(deposit.currency),
        empty(deposit.depositDate),
        numberOrNull(deposit.termMonths),
        numberOrNull(deposit.interestRate),
        empty(deposit.maturityDate),
        empty(deposit.channel),
        empty(deposit.status),
        empty(deposit.notes),
        empty(deposit.failureReason),
        numberOrNull(deposit.attempts) ?? 0,
        decision.decision,
        decision.reason,
      ],
    );

    if (decision.decision === "credited") {
      const available = deposit.depositType !== "Term Deposit";
      await db.query(
        `INSERT INTO movements (deposit_id, account_number, currency, amount, available_for_withdrawal, maturity_date)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          deposit.depositId,
          deposit.accountNumber,
          deposit.currency,
          deposit.amount,
          available,
          available ? null : empty(deposit.maturityDate),
        ],
      );
      if (available) {
        await db.query(
          `INSERT INTO balances (account_number, currency, available_amount)
           VALUES ($1, $2, $3)
           ON CONFLICT (account_number, currency)
           DO UPDATE SET available_amount = balances.available_amount + EXCLUDED.available_amount,
                         updated_at = now()`,
          [deposit.accountNumber, deposit.currency, deposit.amount],
        );
      }
    }

    return {
      replay: false,
      depositId: deposit.depositId,
      loadId: deposit.loadId,
      decision: decision.decision,
      reason: decision.reason,
      amount: numberOrNull(deposit.amount),
      currency: deposit.currency ?? null,
      amountIls: ilsValue(deposit),
      availableForWithdrawal: decision.decision === "credited" && deposit.depositType !== "Term Deposit",
    };
  });
}

function outcomeFromRow(row, replay) {
  return {
    replay,
    depositId: row.deposit_id,
    loadId: row.load_id,
    decision: row.decision,
    reason: row.decision_reason ?? null,
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency ?? null,
    amountIls: null,
    availableForWithdrawal: row.decision === "credited" && row.deposit_type !== "Term Deposit",
  };
}

async function findCustomer(customerId) {
  if (!customerId) return null;
  const found = await db.query(
    "SELECT customer_id, account_number, status FROM customers WHERE customer_id = $1",
    [String(customerId).trim()],
  );
  return found.rows[0] ?? null;
}

function classify(deposit, customer) {
  const amount = numberOrNull(deposit.amount);
  const currency = String(deposit.currency ?? "").trim();
  const structural = structuralReason(deposit, customer, amount, currency);
  if (structural) return { decision: "rejected", reason: structural };

  const prior = String(deposit.failureReason ?? "").trim();
  if (String(deposit.status ?? "").trim() === "Failed" && prior && !RETRYABLE_FAILURES.has(prior)) {
    return { decision: "rejected", reason: prior };
  }
  if (customer.status === "Frozen") return { decision: "rejected", reason: "Account is frozen" };
  if (ilsValue(deposit) > APPROVAL_THRESHOLD_ILS) {
    return { decision: "pending_approval", reason: "Amount exceeds 1000000 ILS" };
  }
  return { decision: "credited", reason: null };
}

function structuralReason(deposit, customer, amount, currency) {
  if (!String(deposit.customerId ?? "").trim() || !customer) return "Customer does not exist";
  if (customer.account_number && deposit.accountNumber && customer.account_number !== deposit.accountNumber) {
    return "Account number does not match customer";
  }
  if (amount === null || amount <= 0) return "Invalid deposit amount";
  if (!Object.prototype.hasOwnProperty.call(ILS_RATES, currency)) return "Unsupported currency";
  if (!isIsoDate(deposit.depositDate)) return "Invalid deposit date";
  if (deposit.depositType === "Term Deposit" && !isIsoDate(deposit.maturityDate)) {
    return "Term deposit is missing a maturity date";
  }
  return null;
}

function ilsValue(deposit) {
  const amount = numberOrNull(deposit.amount);
  const rate = ILS_RATES[String(deposit.currency ?? "").trim()];
  if (amount === null || rate === undefined) return 0;
  return amount * rate;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function empty(value) {
  if (value === null || value === undefined || value === "") return null;
  return value;
}

module.exports = { parse, apply, ILS_RATES };
