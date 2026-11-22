const drafts = require("../integration/redis");

async function plan(deposits, customerIds, loadId) {
  const ids = deposits.map((deposit) => deposit.depositId).filter(Boolean);
  const taken = await drafts.heldByOtherLoad(ids, loadId);
  const seenInFile = new Set();
  return deposits.map((deposit) => classify(deposit, customerIds, taken, seenInFile));
}

async function saveDrafts(loadId, plans) {
  await drafts.save(loadId, plans);
}

async function deleteDrafts(loadId) {
  return drafts.remove(loadId, true);
}

async function approved(loadId) {
  const plans = await drafts.read(loadId);
  if (!plans) return null;
  return plans
    .filter((plan) => plan.action === "will_load" && plan.depositId)
    .map((plan) => ({ depositId: plan.depositId, payload: plan.payload }));
}

function classify(deposit, customerIds, taken, seenInFile) {
  const payload = {
    depositId: deposit.depositId,
    customerId: deposit.customerId,
    accountNumber: deposit.accountNumber,
    depositType: deposit.depositType,
    amount: deposit.amount,
    currency: deposit.currency,
    depositDate: deposit.depositDate,
    termMonths: deposit.termMonths,
    interestRate: deposit.interestRate,
    maturityDate: deposit.maturityDate,
    channel: deposit.channel,
    status: deposit.status,
    notes: deposit.notes,
    failureReason: deposit.failureReason,
    attempts: deposit.attempts,
  };
  const base = {
    row: deposit.row,
    depositId: deposit.depositId || null,
    customerId: deposit.customerId || null,
    payload,
  };
  if (!deposit.depositId) return withAction(base, "will_not_load", "Missing deposit id");
  if (seenInFile.has(deposit.depositId)) return withAction(base, "duplicate_in_file", "Duplicate deposit id in file");
  seenInFile.add(deposit.depositId);
  if (taken.has(deposit.depositId)) return withAction(base, "already_exists", "Deposit id already exists");
  if (!deposit.customerId || !customerIds.has(deposit.customerId)) {
    return withAction(base, "will_not_load", "Customer does not exist");
  }
  if (deposit.amount === null || deposit.amount <= 0) return withAction(base, "will_not_load", "Invalid deposit amount");
  if (!["ILS", "USD", "EUR"].includes(deposit.currency)) return withAction(base, "will_not_load", "Unsupported currency");
  if (deposit.depositDateInvalid) return withAction(base, "will_not_load", "Invalid deposit date");
  return withAction(base, "will_load", null);
}

function withAction(base, action, reason) {
  const whatWillHappen =
    action === "will_load"
      ? "Will be published to the waiting topic after approval"
      : action === "already_exists"
        ? "Will not load: deposit id already exists"
        : action === "duplicate_in_file"
          ? "Will not load: duplicate deposit id in file"
          : `Will not load: ${reason}`;
  return { ...base, action, reason, whatWillHappen };
}

function publicPlan(plan) {
  return {
    row: plan.row,
    depositId: plan.depositId,
    customerId: plan.customerId,
    action: plan.action,
    whatWillHappen: plan.whatWillHappen,
    reason: plan.reason,
  };
}

module.exports = { plan, saveDrafts, deleteDrafts, approved, publicPlan };
