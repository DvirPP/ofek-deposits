const DEPOSIT_TYPES = ["Term Deposit", "Savings", "Cash Deposit", "Check Deposit", "Wire Transfer In"];
const CHANNELS = ["Branch", "Online", "Mobile", "ATM"];
const CURRENCIES = new Set(["ILS", "USD", "EUR"]);

function plan({ customers, deposits, knownCustomers, takenDepositIds }) {
  const customerById = new Map(knownCustomers.map((customer) => [customer.customerId, customer]));
  const seenCustomers = new Set();
  const validCustomers = [];
  const customerRejections = [];

  for (const customer of customers) {
    if (!customer.customerId) {
      customerRejections.push({ row: customer.row, customerId: null, reason: "Missing customer id" });
      continue;
    }
    if (seenCustomers.has(customer.customerId)) {
      customerRejections.push({
        row: customer.row,
        customerId: customer.customerId,
        reason: "Duplicate customer id in file",
      });
      continue;
    }
    seenCustomers.add(customer.customerId);
    if (customer.status !== "Active" && customer.status !== "Frozen") {
      customerRejections.push({
        row: customer.row,
        customerId: customer.customerId,
        reason: customer.status ? "Invalid account status" : "Missing account status",
      });
      continue;
    }
    validCustomers.push(customer);
    customerById.set(customer.customerId, {
      customerId: customer.customerId,
      accountNumber: customer.accountNumber,
      status: customer.status,
    });
  }

  const seenDeposits = new Set();
  const taken = new Set(takenDepositIds);
  return {
    validCustomers,
    customerRejections,
    deposits: deposits.map((deposit) => classify(deposit, customerById, taken, seenDeposits)),
  };
}

function classify(deposit, customerById, taken, seenDeposits) {
  const customer = deposit.customerId ? customerById.get(deposit.customerId) : null;
  const base = {
    row: deposit.row,
    depositId: deposit.depositId || null,
    customerId: deposit.customerId || null,
    accountNumber: deposit.accountNumber,
    depositType: deposit.depositType,
    amount: deposit.amount,
    currency: deposit.currency,
    depositDate: deposit.depositDate,
    termMonths: deposit.termMonths,
    interestRate: deposit.interestRate,
    maturityDate: deposit.maturityDate,
    channel: deposit.channel,
    sourceStatus: deposit.status,
    notes: deposit.notes,
    failureReason: deposit.failureReason,
    attempts: deposit.attempts,
    customerStatus: customer?.status ?? null,
  };
  if (!deposit.depositId) return finish(base, "will_not_load", "Missing deposit id", false, false);
  if (seenDeposits.has(deposit.depositId)) {
    return finish(base, "duplicate_in_file", "Duplicate deposit id in file", false, false);
  }
  seenDeposits.add(deposit.depositId);
  if (taken.has(deposit.depositId)) return finish(base, "already_exists", "Deposit id already exists", false, false);

  const reason = invalidReason(deposit, customer);
  if (reason) return finish(base, "will_not_load", reason, false, false);
  if (deposit.status === "Failed") {
    return finish(base, "failed_from_file", null, true, true);
  }
  if (deposit.status === "Pending") return finish(base, "will_load", null, true, true);
  return finish(base, "will_not_load", "Unsupported deposit status", false, false);
}

function invalidReason(deposit, customer) {
  if (!deposit.customerId || !customer) return "Customer does not exist";
  if (!deposit.accountNumber) return "Missing account number";
  if (customer.accountNumber && customer.accountNumber !== deposit.accountNumber) {
    return "Account number does not match customer";
  }
  if (deposit.amount === null || deposit.amount <= 0) return "Invalid deposit amount";
  if (!CURRENCIES.has(deposit.currency)) return "Unsupported currency";
  if (deposit.depositDateInvalid || !deposit.depositDate) return "Invalid deposit date";
  if (!DEPOSIT_TYPES.includes(deposit.depositType)) return "Invalid deposit type";
  if (!CHANNELS.includes(deposit.channel)) return "Invalid channel";
  if (!Number.isInteger(deposit.attempts) || deposit.attempts < 0) return "Invalid attempt count";
  if (deposit.depositType === "Term Deposit") {
    if (!Number.isInteger(deposit.termMonths) || deposit.termMonths <= 0) return "Term deposit is missing a term";
    if (deposit.interestRate === null || deposit.interestRate < 0) return "Term deposit is missing an interest rate";
    if (!deposit.maturityDate) return "Term deposit is missing a maturity date";
    if (deposit.maturityDate < deposit.depositDate) return "Maturity date is before the deposit date";
  }
  return null;
}

function finish(base, action, reason, accepted, canonical) {
  const whatWillHappen =
    action === "will_load"
      ? "Will be saved as Pending and sent only when a banker processes the queue"
      : action === "failed_from_file"
        ? "Will be saved as Failed. The process button will not send it"
        : action === "already_exists"
          ? "Will not load: deposit id already exists"
          : action === "duplicate_in_file"
            ? "Will not load: duplicate deposit id in file"
            : `Will not load: ${reason}`;
  return { ...base, action, reason, whatWillHappen, accepted, canonical };
}

function publicPlan(plan) {
  return {
    row: plan.row,
    depositId: plan.depositId,
    customerId: plan.customerId,
    action: plan.action,
    whatWillHappen: plan.whatWillHappen,
    reason: plan.reason,
    amount: plan.amount,
    currency: plan.currency,
    sourceStatus: plan.sourceStatus,
  };
}

function summarize(plans, customerRejections, customersRead, customersAccepted) {
  return {
    read: plans.length,
    willLoad: plans.filter((plan) => plan.action === "will_load").length,
    alreadyExists: plans.filter((plan) => plan.action === "already_exists").length,
    duplicateInFile: plans.filter((plan) => plan.action === "duplicate_in_file").length,
    willNotLoad: plans.filter((plan) => plan.action === "will_not_load").length,
    failedFromFile: plans.filter((plan) => plan.action === "failed_from_file").length,
    customersRead,
    customersAccepted,
    customersRejected: customerRejections.length,
  };
}

module.exports = { plan, publicPlan, summarize };
