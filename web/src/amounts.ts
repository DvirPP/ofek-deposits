import type { DepositRow, FileAmount, LoadPreview } from "./types";

export async function readDepositAmounts(file: File): Promise<Map<string, FileAmount>> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase() === "deposits");
  const amounts = new Map<string, FileAmount>();
  if (!sheetName) return amounts;

  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null)[]>(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  if (matrix.length === 0) return amounts;

  const headers = matrix[0].map((cell) => String(cell ?? "").trim().toLowerCase());
  const idColumn = headers.indexOf("deposit_id");
  const amountColumn = headers.indexOf("amount");
  const currencyColumn = headers.indexOf("currency");
  if (idColumn < 0) return amounts;

  for (let index = 1; index < matrix.length; index += 1) {
    const row = matrix[index];
    const depositId = String(row[idColumn] ?? "").trim();
    if (!depositId || amounts.has(depositId)) continue;
    const rawAmount = amountColumn >= 0 ? row[amountColumn] : null;
    const rawCurrency = currencyColumn >= 0 ? row[currencyColumn] : null;
    amounts.set(depositId, {
      amount: typeof rawAmount === "number" && Number.isFinite(rawAmount) ? rawAmount : null,
      currency: rawCurrency === null || rawCurrency === undefined || rawCurrency === "" ? null : String(rawCurrency).trim(),
    });
  }
  return amounts;
}

export function publishableCount(deposits: DepositRow[]): number {
  return deposits.filter((deposit) => deposit.depositId).length;
}

export function currencySums(deposits: DepositRow[], amounts: Map<string, FileAmount>, action: string) {
  const sums = new Map<string, number>();
  let rows = 0;
  let missing = 0;
  for (const deposit of deposits) {
    if (deposit.action !== action || !deposit.depositId) continue;
    rows += 1;
    const file = amounts.get(deposit.depositId);
    if (!file || file.amount === null || !file.currency) {
      missing += 1;
      continue;
    }
    sums.set(file.currency, (sums.get(file.currency) ?? 0) + file.amount);
  }
  return {
    rows,
    missing,
    sums: [...sums.entries()].sort(([left], [right]) => left.localeCompare(right)),
  };
}

export function downloadRejections(preview: LoadPreview) {
  const rejected = preview.deposits.filter((deposit) => deposit.action !== "will_load");
  const lines = [["row", "deposit_id", "customer_id", "action", "reason", "what_will_happen"].join(",")];
  for (const deposit of rejected) {
    lines.push(
      [deposit.row, deposit.depositId, deposit.customerId, deposit.action, deposit.reason, deposit.whatWillHappen]
        .map(csvCell)
        .join(","),
    );
  }
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `rejections-${preview.loadId}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | number | null): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
