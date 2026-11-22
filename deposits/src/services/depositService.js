const db = require("../integration/db");

const APPROVAL_THRESHOLD_ILS = 1_000_000;

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
  return { ok: true, deposit: { ...body, intent: body.intent === "retry" ? "retry" : "process" } };
}

async function apply(deposit) {
  try {
    return await db.transaction(() => applyOnce(deposit));
  } catch (error) {
    if (error.code !== "23505") throw error;
    const existing = await db.query("SELECT * FROM cases WHERE deposit_id = $1", [deposit.depositId]);
    if (existing.rowCount === 0) throw error;
    return outcomeFromRow(existing.rows[0], true);
  }
}

async function applyOnce(deposit) {
  const existing = await db.query("SELECT * FROM cases WHERE deposit_id = $1 FOR UPDATE", [deposit.depositId]);
  const rates = await loadRates();
  const retryable = await loadRetryable();
  if (existing.rowCount > 0) {
    const row = existing.rows[0];
    if (row.status === "Completed" || row.status === "PendingApproval") return outcomeFromRow(row, true);
    if (row.status === "Failed" && deposit.intent !== "retry") return outcomeFromRow(row, true);
    await addEvent(row.deposit_id, "Processing", null);
    const decision = classify(deposit, rates, retryable);
    await storeDecision(row.deposit_id, deposit, decision, rates);
    return freshOutcome(deposit, decision, rates, false);
  }

  await db.query(
    `INSERT INTO cases (
       deposit_id, load_id, batch_id, customer_id, account_number, customer_status, deposit_type,
       amount, currency, deposit_date, term_months, interest_rate, maturity_date, channel,
       source_status, notes, failure_reason, attempts, status, decision_reason, amount_ils, intent
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'Processing',NULL,$19,$20)`,
    caseValues(deposit, rates),
  );
  await addEvent(deposit.depositId, "Processing", null);
  const decision = classify(deposit, rates, retryable);
  await storeDecision(deposit.depositId, deposit, decision, rates);
  return freshOutcome(deposit, decision, rates, false);
}

async function read(depositId) {
  const found = await db.query("SELECT * FROM cases WHERE deposit_id = $1", [depositId]);
  return found.rows[0] ? publicCase(found.rows[0]) : null;
}

async function history(depositId) {
  const found = await db.query(
    `SELECT status, reason, created_at FROM status_events WHERE deposit_id = $1 ORDER BY created_at`,
    [depositId],
  );
  return found.rows.map((row) => ({
    status: row.status,
    reason: row.reason,
    at: row.created_at,
  }));
}

async function list(status) {
  const found = status
    ? await db.query("SELECT * FROM cases WHERE status = $1 ORDER BY deposit_id LIMIT 500", [status])
    : await db.query("SELECT * FROM cases ORDER BY deposit_id LIMIT 500");
  return found.rows.map(publicCase);
}

async function decideApproval(depositId, decision) {
  return db.transaction(async () => {
    const found = await db.query("SELECT * FROM cases WHERE deposit_id = $1 FOR UPDATE", [depositId]);
    if (found.rowCount === 0) return { error: "not_found" };
    const row = found.rows[0];
    if (row.status !== "PendingApproval") return { error: "not_pending", status: row.status };
    if (decision === "reject") {
      await db.query(
        `UPDATE cases SET status = 'Failed', decision_reason = $2, updated_at = now() WHERE deposit_id = $1`,
        [depositId, "Rejected by a banker"],
      );
      await addEvent(depositId, "Failed", "Rejected by a banker");
      return { case: { ...publicCase(row), status: "Failed", decisionReason: "Rejected by a banker" } };
    }
    await db.query(
      `UPDATE cases SET status = 'Completed', decision_reason = NULL, updated_at = now() WHERE deposit_id = $1`,
      [depositId],
    );
    await addEvent(depositId, "Completed", null);
    await postMovement(row);
    return { case: { ...publicCase(row), status: "Completed", decisionReason: null } };
  });
}

async function storeDecision(depositId, deposit, decision, rates) {
  await db.query(
    `UPDATE cases
     SET status = $2, decision_reason = $3, amount_ils = $4, intent = $5, updated_at = now()
     WHERE deposit_id = $1`,
    [depositId, decision.status, decision.reason, ilsValue(deposit, rates), deposit.intent],
  );
  await addEvent(depositId, decision.status, decision.reason);
  if (decision.status === "Completed") await postMovement(deposit);
}

async function postMovement(source) {
  const depositType = source.depositType ?? source.deposit_type;
  const available = depositType !== "Term Deposit";
  const depositId = source.depositId ?? source.deposit_id;
  const accountNumber = source.accountNumber ?? source.account_number;
  const currency = source.currency;
  const amount = numberOrNull(source.amount);
  const maturityDate = available ? null : (source.maturityDate ?? source.maturity_date ?? null);
  const inserted = await db.query(
    `INSERT INTO movements (deposit_id, account_number, currency, amount, available_for_withdrawal, maturity_date)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (deposit_id) DO NOTHING
     RETURNING deposit_id`,
    [depositId, accountNumber, currency, amount, available, maturityDate],
  );
  if (!available || inserted.rowCount === 0) return;
  await db.query(
    `INSERT INTO balances (account_number, currency, available_amount)
     VALUES ($1, $2, $3)
     ON CONFLICT (account_number, currency)
     DO UPDATE SET available_amount = balances.available_amount + EXCLUDED.available_amount,
                   updated_at = now()`,
    [accountNumber, currency, amount],
  );
}

function caseValues(deposit, rates) {
  return [
    deposit.depositId,
    deposit.loadId,
    empty(deposit.batchId),
    empty(deposit.customerId),
    empty(deposit.accountNumber),
    empty(deposit.customerStatus),
    empty(deposit.depositType),
    numberOrNull(deposit.amount),
    empty(deposit.currency),
    empty(deposit.depositDate),
    numberOrNull(deposit.termMonths),
    numberOrNull(deposit.interestRate),
    empty(deposit.maturityDate),
    empty(deposit.channel),
    empty(deposit.sourceStatus),
    empty(deposit.notes),
    empty(deposit.failureReason),
    numberOrNull(deposit.attempts) ?? 0,
    ilsValue(deposit, rates),
    deposit.intent,
  ];
}

function classify(deposit, rates, retryable) {
  if (deposit.intent !== "retry" && deposit.sourceStatus === "Failed") {
    return { status: "Failed", reason: deposit.failureReason || "Failed deposits stay off the main button" };
  }
  const structural = structuralReason(deposit, rates);
  if (structural) return { status: "Failed", reason: structural };
  const prior = String(deposit.failureReason ?? "").trim();
  if (deposit.intent === "retry" && !retryable.has(prior)) {
    return { status: "Failed", reason: prior || "Failure cannot be retried" };
  }
  if (deposit.customerStatus === "Frozen") return { status: "Failed", reason: "Account is frozen" };
  if (ilsValue(deposit, rates) > APPROVAL_THRESHOLD_ILS) {
    return { status: "PendingApproval", reason: "Amount exceeds 1000000 ILS" };
  }
  return { status: "Completed", reason: null };
}

function structuralReason(deposit, rates) {
  if (!String(deposit.customerId ?? "").trim() || !deposit.customerStatus) return "Customer does not exist";
  if (!String(deposit.accountNumber ?? "").trim()) return "Missing account number";
  const amount = numberOrNull(deposit.amount);
  const currency = String(deposit.currency ?? "").trim();
  if (amount === null || amount <= 0) return "Invalid deposit amount";
  if (!Object.prototype.hasOwnProperty.call(rates, currency)) return "Unsupported currency";
  if (!isIsoDate(deposit.depositDate)) return "Invalid deposit date";
  if (deposit.depositType === "Term Deposit" && !isIsoDate(deposit.maturityDate)) {
    return "Term deposit is missing a maturity date";
  }
  return null;
}

async function loadRates() {
  const found = await db.query("SELECT currency, ils_per_unit FROM exchange_rates");
  const rates = {};
  for (const row of found.rows) rates[row.currency] = Number(row.ils_per_unit);
  return rates;
}

async function loadRetryable() {
  const found = await db.query("SELECT reason FROM retry_policy");
  return new Set(found.rows.map((row) => row.reason));
}

async function addEvent(depositId, status, reason) {
  await db.query("INSERT INTO status_events (deposit_id, status, reason) VALUES ($1, $2, $3)", [
    depositId,
    status,
    reason,
  ]);
}

function freshOutcome(deposit, decision, rates, replay) {
  return {
    replay,
    depositId: deposit.depositId,
    loadId: deposit.loadId,
    status: decision.status,
    reason: decision.reason,
    amount: numberOrNull(deposit.amount),
    currency: deposit.currency ?? null,
    amountIls: ilsValue(deposit, rates),
    availableForWithdrawal: decision.status === "Completed" && deposit.depositType !== "Term Deposit",
  };
}

function outcomeFromRow(row, replay) {
  return {
    replay,
    depositId: row.deposit_id,
    loadId: row.load_id,
    status: row.status,
    reason: row.decision_reason ?? null,
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency ?? null,
    amountIls: row.amount_ils === null ? null : Number(row.amount_ils),
    availableForWithdrawal: row.status === "Completed" && row.deposit_type !== "Term Deposit",
  };
}

function publicCase(row) {
  return {
    depositId: row.deposit_id,
    loadId: row.load_id,
    batchId: row.batch_id,
    customerId: row.customer_id,
    accountNumber: row.account_number,
    customerStatus: row.customer_status,
    depositType: row.deposit_type,
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency,
    depositDate: row.deposit_date,
    termMonths: row.term_months,
    interestRate: row.interest_rate === null ? null : Number(row.interest_rate),
    maturityDate: row.maturity_date,
    channel: row.channel,
    sourceStatus: row.source_status,
    notes: row.notes,
    failureReason: row.failure_reason,
    attempts: row.attempts,
    status: row.status,
    decisionReason: row.decision_reason,
    amountIls: row.amount_ils === null ? null : Number(row.amount_ils),
    intent: row.intent,
    updatedAt: row.updated_at,
  };
}

function ilsValue(deposit, rates) {
  const amount = numberOrNull(deposit.amount ?? deposit.amount);
  const currency = String(deposit.currency ?? "").trim();
  const rate = rates[currency];
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

module.exports = { parse, apply, read, history, list, decideApproval };
