import type { DepositRow } from "./types";

export function sumsFor(deposits: DepositRow[], action: string) {
  const sums = new Map<string, number>();
  let rows = 0;
  for (const deposit of deposits) {
    if (deposit.action !== action) continue;
    rows += 1;
    if (deposit.amount === null || deposit.amount === undefined || !deposit.currency) continue;
    sums.set(deposit.currency, (sums.get(deposit.currency) ?? 0) + deposit.amount);
  }
  return {
    rows,
    sums: [...sums.entries()].sort(([left], [right]) => left.localeCompare(right)),
  };
}
