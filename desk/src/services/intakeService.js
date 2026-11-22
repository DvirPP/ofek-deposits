const { randomUUID } = require("crypto");
const db = require("../integration/db");

async function canonicalDepositIds() {
  const found = await db.query(
    "SELECT deposit_id FROM intake_deposits WHERE canonical AND deposit_id IS NOT NULL",
  );
  return found.rows.map((row) => row.deposit_id);
}

async function saveDeposits(loadId, plans) {
  for (const plan of plans) {
    await db.query(
      `INSERT INTO intake_deposits (
         intake_id, load_id, row_number, deposit_id, customer_id, account_number, deposit_type,
         amount, currency, deposit_date, term_months, interest_rate, maturity_date, channel,
         source_status, notes, failure_reason, attempts, customer_status, accepted, canonical,
         rejection_reason
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        randomUUID(),
        loadId,
        plan.row,
        plan.depositId,
        empty(plan.customerId),
        empty(plan.accountNumber),
        empty(plan.depositType),
        plan.amount,
        empty(plan.currency),
        empty(plan.depositDate),
        plan.termMonths,
        plan.interestRate,
        empty(plan.maturityDate),
        empty(plan.channel),
        empty(plan.sourceStatus),
        empty(plan.notes),
        empty(plan.failureReason),
        plan.attempts ?? 0,
        empty(plan.customerStatus),
        plan.accepted,
        plan.canonical,
        plan.reason,
      ],
    );
  }
}

async function saveCustomerRejections(loadId, rejections) {
  for (const rejection of rejections) {
    await db.query(
      `INSERT INTO customer_rejections (load_id, row_number, customer_id, reason)
       VALUES ($1, $2, $3, $4)`,
      [loadId, rejection.row, rejection.customerId, rejection.reason],
    );
  }
}

async function customerRejections(loadId) {
  const found = await db.query(
    `SELECT row_number, customer_id, reason
     FROM customer_rejections WHERE load_id = $1 ORDER BY row_number`,
    [loadId],
  );
  return found.rows;
}

async function depositRejections(loadId) {
  const found = await db.query(
    `SELECT row_number, deposit_id, customer_id, rejection_reason, source_status
     FROM intake_deposits
     WHERE load_id = $1 AND accepted = false
     ORDER BY row_number`,
    [loadId],
  );
  return found.rows;
}

async function pendingTotals() {
  const found = await db.query(
    `SELECT currency, COUNT(*)::int AS count, COALESCE(SUM(amount), 0) AS amount
     FROM intake_deposits
     WHERE canonical AND accepted AND source_status = 'Pending' AND submitted_at IS NULL
     GROUP BY currency
     ORDER BY currency`,
  );
  const totals = found.rows.map(moneyRow);
  return { count: totals.reduce((sum, row) => sum + row.count, 0), totals };
}

async function lockPending() {
  const found = await db.query(
    `SELECT intake_id, load_id, deposit_id, customer_id, account_number, customer_status,
            deposit_type, amount, currency, deposit_date, term_months, interest_rate,
            maturity_date, channel, source_status, notes, failure_reason, attempts
     FROM intake_deposits
     WHERE canonical AND accepted AND source_status = 'Pending' AND submitted_at IS NULL
     ORDER BY deposit_id
     FOR UPDATE SKIP LOCKED`,
  );
  return found.rows;
}

async function lockRetries(depositIds) {
  const found = await db.query(
    `SELECT intake_id, load_id, deposit_id, customer_id, account_number, customer_status,
            deposit_type, amount, currency, deposit_date, term_months, interest_rate,
            maturity_date, channel, source_status, notes, failure_reason, attempts
     FROM intake_deposits
     WHERE canonical AND accepted AND source_status = 'Failed' AND submitted_at IS NULL
       AND deposit_id = ANY($1::text[])
     ORDER BY deposit_id
     FOR UPDATE SKIP LOCKED`,
    [depositIds],
  );
  return found.rows;
}

async function markSubmitted(batchId, intakeIds) {
  if (intakeIds.length === 0) return;
  await db.query(
    `UPDATE intake_deposits SET batch_id = $1, submitted_at = now()
     WHERE intake_id = ANY($2::uuid[])`,
    [batchId, intakeIds],
  );
}

async function releaseBatch(batchId) {
  await db.query(
    "UPDATE intake_deposits SET batch_id = NULL, submitted_at = NULL WHERE batch_id = $1",
    [batchId],
  );
}

function moneyRow(row) {
  return { currency: row.currency, count: row.count, amount: Number(row.amount) };
}

function empty(value) {
  if (value === null || value === undefined || value === "") return null;
  return value;
}

module.exports = {
  canonicalDepositIds,
  saveDeposits,
  saveCustomerRejections,
  customerRejections,
  depositRejections,
  pendingTotals,
  lockPending,
  lockRetries,
  markSubmitted,
  releaseBatch,
};
