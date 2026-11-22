import type { DecisionResult, JournalEntry, LoadPreview } from "./types";

const DESK_KEY = "ofek.desk";
const JOURNAL_KEY = "ofek.journal";

export type StoredDesk = {
  preview: LoadPreview;
  decision: DecisionResult | null;
};

export function readDesk(): StoredDesk | null {
  return readJson(DESK_KEY, isDesk);
}

export function writeDesk(desk: StoredDesk | null) {
  writeJson(DESK_KEY, desk);
}

export function readJournal(): JournalEntry[] {
  return readJson(JOURNAL_KEY, Array.isArray) ?? [];
}

export function writeJournal(entries: JournalEntry[]) {
  writeJson(JOURNAL_KEY, entries);
}

function readJson<T>(key: string, check: (value: unknown) => value is T): T | null {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return check(value) ? value : null;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  if (value === null) {
    sessionStorage.removeItem(key);
    return;
  }
  sessionStorage.setItem(key, JSON.stringify(value));
}

function isDesk(value: unknown): value is StoredDesk {
  if (!value || typeof value !== "object") return false;
  const desk = value as StoredDesk;
  return Boolean(desk.preview?.loadId && desk.preview.summary && Array.isArray(desk.preview.deposits));
}
