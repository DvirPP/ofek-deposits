const { createHash } = require("crypto");
const XLSX = require("xlsx");

function readWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const customers = readSheet(workbook, "Customers");
  const deposits = readSheet(workbook, "Deposits");
  if (!customers || !deposits) {
    const error = new Error("Workbook must include Customers and Deposits sheets");
    error.status = 400;
    error.code = "bad_workbook";
    throw error;
  }
  return {
    customers: customers.map(normalizeCustomer).filter((row) => row.customerId),
    deposits: deposits.map(normalizeDeposit),
  };
}

function hashFile(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readSheet(workbook, name) {
  const sheetName = workbook.SheetNames.find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  if (!sheetName) return null;
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  if (matrix.length === 0) return [];
  const headers = matrix[0].map((cell) => text(cell).toLowerCase());
  const rows = [];
  for (let index = 1; index < matrix.length; index += 1) {
    const source = matrix[index];
    const values = {};
    let hasValue = false;
    headers.forEach((header, column) => {
      if (!header) return;
      const value = source[column] ?? null;
      values[header] = value;
      if (value !== null && value !== "") hasValue = true;
    });
    if (hasValue) rows.push({ rowNumber: index + 1, values });
  }
  return rows;
}

function normalizeCustomer(row) {
  return {
    customerId: text(row.values.customer_id),
    fullName: emptyToNull(text(row.values.full_name)),
    nationalId: emptyToNull(text(row.values.national_id)),
    phone: emptyToNull(text(row.values.phone)),
    email: emptyToNull(text(row.values.email)),
    city: emptyToNull(text(row.values.city)),
    segment: emptyToNull(text(row.values.segment)),
    branchCode: emptyToNull(text(row.values.branch_code)),
    branchName: emptyToNull(text(row.values.branch_name)),
    accountNumber: emptyToNull(text(row.values.account_number)),
    status: emptyToNull(text(row.values.status)),
    openedDate: dateOrNull(row.values.opened_date),
  };
}

function normalizeDeposit(row) {
  const rawDate = row.values.deposit_date;
  const hasDate = rawDate !== null && rawDate !== undefined && rawDate !== "";
  return {
    row: row.rowNumber,
    depositId: text(row.values.deposit_id),
    customerId: text(row.values.customer_id),
    accountNumber: emptyToNull(text(row.values.account_number)),
    depositType: emptyToNull(text(row.values.deposit_type)),
    amount: numberOrNull(row.values.amount),
    currency: emptyToNull(text(row.values.currency)),
    depositDate: dateOrNull(rawDate),
    depositDateInvalid: hasDate && !dateOrNull(rawDate),
    termMonths: numberOrNull(row.values.term_months),
    interestRate: numberOrNull(row.values.interest_rate),
    maturityDate: dateOrNull(row.values.maturity_date),
    channel: emptyToNull(text(row.values.channel)),
    status: emptyToNull(text(row.values.status)) ?? "Pending",
    notes: emptyToNull(text(row.values.notes)),
    failureReason: emptyToNull(text(row.values.failure_reason)),
    attempts: numberOrNull(row.values.attempts) ?? 0,
  };
}

function text(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const month = String(parsed.m).padStart(2, "0");
    const day = String(parsed.d).padStart(2, "0");
    return `${parsed.y}-${month}-${day}`;
  }
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

function emptyToNull(value) {
  return value ? value : null;
}

module.exports = { readWorkbook, hashFile };
