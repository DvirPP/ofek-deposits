const { randomUUID } = require("crypto");
const { config } = require("../config");
const db = require("../integration/db");
const { publishDeposits } = require("../integration/kafka");
const authService = require("../services/authService");
const intakeService = require("../services/intakeService");
const batchService = require("../services/batchService");

async function pending(req, res) {
  const banker = await authService.bankerFromRequest(req);
  if (!banker) {
    res.status(401).json({ error: "Authentication required", code: "unauthenticated" });
    return;
  }
  res.json(await intakeService.pendingTotals());
}

async function processPending(req, res) {
  const banker = await authService.bankerFromRequest(req);
  if (!banker) {
    res.status(401).json({ error: "Authentication required", code: "unauthenticated" });
    return;
  }
  const claimed = await claim(banker.id, "process", () => intakeService.lockPending());
  if (!claimed) {
    res.json({ batchId: null, published: 0, topic: config.kafkaTopic, depositIds: [], totals: [] });
    return;
  }
  await publishClaimed(claimed, "process");
  res.json({
    batchId: claimed.batchId,
    published: claimed.rows.length,
    topic: config.kafkaTopic,
    depositIds: claimed.rows.map((row) => row.deposit_id),
    totals: claimed.totals,
  });
}

async function retry(req, res) {
  const banker = await authService.bankerFromRequest(req);
  if (!banker) {
    res.status(401).json({ error: "Authentication required", code: "unauthenticated" });
    return;
  }
  const depositIds = Array.isArray(req.body?.depositIds)
    ? [...new Set(req.body.depositIds.map((id) => String(id).trim()).filter(Boolean))]
    : [];
  if (depositIds.length === 0) {
    res.status(400).json({ error: "depositIds is required", code: "deposit_ids_required" });
    return;
  }
  const claimed = await claim(banker.id, "retry", () => intakeService.lockRetries(depositIds));
  const sent = new Set((claimed?.rows ?? []).map((row) => row.deposit_id));
  if (claimed) await publishClaimed(claimed, "retry");
  res.json({
    batchId: claimed?.batchId ?? null,
    published: sent.size,
    topic: config.kafkaTopic,
    depositIds: [...sent],
    skipped: depositIds.filter((id) => !sent.has(id)),
    totals: claimed?.totals ?? [],
  });
}

async function claim(bankerId, kind, lock) {
  return db.transaction(async () => {
    const rows = await lock();
    if (rows.length === 0) return null;
    const batchId = randomUUID();
    const totals = totalsByCurrency(rows);
    await batchService.create({
      batchId,
      bankerId,
      kind,
      depositCount: rows.length,
      totals,
    });
    await intakeService.markSubmitted(batchId, rows.map((row) => row.intake_id));
    return { batchId, rows, totals };
  });
}

async function publishClaimed(claimed, intent) {
  try {
    await publishDeposits(claimed.rows.map((row) => messageFromRow(row, claimed.batchId, intent)));
  } catch (error) {
    await db.transaction(async () => {
      await intakeService.releaseBatch(claimed.batchId);
      await batchService.remove(claimed.batchId);
    });
    error.status = 502;
    error.code = "publish_failed";
    throw error;
  }
}

function messageFromRow(row, batchId, intent) {
  return {
    intent,
    loadId: row.load_id,
    batchId,
    depositId: row.deposit_id,
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
  };
}

function totalsByCurrency(rows) {
  const totals = new Map();
  for (const row of rows) {
    const currency = row.currency ?? "UNKNOWN";
    const current = totals.get(currency) ?? { currency, count: 0, amount: 0 };
    current.count += 1;
    current.amount += Number(row.amount ?? 0);
    totals.set(currency, current);
  }
  return [...totals.values()];
}

module.exports = { pending, processPending, retry };
