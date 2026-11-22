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
    customers: customers.map(normalizeCustomer),
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
    row: row.rowNumber,
    customerId: text(row.values.customer_id),
    fullName: emptyToNull(text(row.values.full_name)),
    nationalId: emptyToNull(text(row.values.national_id)),
    phone: emptyToNull(text(row.values.phone)),
    email: emptyToNull(text(row.values.email)),
    city: emptyToNull(text(row.values.city)),
    segment: canonicalEnum(row.values.segment, ["Retail", "Premium", "Business", "Private"]),
    branchCode: emptyToNull(text(row.values.branch_code)),
    branchName: emptyToNull(text(row.values.branch_name)),
    accountNumber: emptyToNull(text(row.values.account_number)),
    status: canonicalEnum(row.values.status, ["Active", "Frozen"]),
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
    depositType: canonicalEnum(row.values.deposit_type, [
      "Term Deposit",
      "Savings",
      "Cash Deposit",
      "Check Deposit",
      "Wire Transfer In",
    ]),
    amount: numberOrNull(row.values.amount),
    currency: canonicalEnum(row.values.currency, ["ILS", "USD", "EUR"]),
    depositDate: dateOrNull(rawDate),
    depositDateInvalid: hasDate && !dateOrNull(rawDate),
    termMonths: numberOrNull(row.values.term_months),
    interestRate: numberOrNull(row.values.interest_rate),
    maturityDate: dateOrNull(row.values.maturity_date),
    channel: canonicalEnum(row.values.channel, ["Branch", "Online", "Mobile", "ATM"]),
    status: canonicalEnum(row.values.status, ["Pending", "Failed"]) ?? "Pending",
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

function canonicalEnum(value, options) {
  const raw = text(value);
  if (!raw) return null;
  return options.find((option) => option.toLowerCase() === raw.toLowerCase()) ?? raw;
}

function rejectionWorkbook(customerRows, depositRows) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(customerRows), "Customers");
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(depositRows), "Deposits");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

module.exports = { readWorkbook, hashFile, rejectionWorkbook };
