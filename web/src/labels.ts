import type { DepositAction } from "./types";
import { ApiError } from "./api";

const ACTIONS: Record<DepositAction, string> = {
  will_load: "תיטען",
  already_exists: "כבר קיימת",
  duplicate_in_file: "כפילות בקובץ",
  will_not_load: "לא תיטען",
};

const REASONS: Record<string, string> = {
  "Missing deposit id": "חסר מזהה הפקדה",
  "Duplicate deposit id in file": "מזהה הפקדה כפול בקובץ",
  "Deposit id already exists": "מזהה ההפקדה כבר קיים",
  "Customer does not exist": "הלקוח לא קיים",
  "Invalid deposit amount": "סכום הפקדה לא תקין",
  "Unsupported currency": "מטבע לא נתמך",
  "Invalid deposit date": "תאריך הפקדה לא תקין",
};

const ERRORS: Record<string, string> = {
  invalid_credentials: "שם המשתמש או הסיסמה שגויים",
  unauthenticated: "נדרשת כניסה מחדש",
  file_required: "חסר קובץ אקסל",
  bad_workbook: "הקובץ חייב לכלול גיליונות Customers ו-Deposits",
  bad_decision: "ההחלטה חייבת להיות כן או לא",
  load_not_found: "הטעינה לא נמצאה",
  already_decided: "כבר התקבלה החלטה על הטעינה הזו",
  draft_expired: "הטיוטה פגה. יש להעלות את הקובץ שוב",
  question_required: "חסרה שאלה",
  question_too_long: "השאלה ארוכה מדי",
  missing_api_key: "חסר מפתח למודל. הסוכן לא יכול לענות",
  bad_agent_response: "הסוכן לא החזיר תשובה תקינה",
  unavailable: "השירות לא זמין",
  bad_response: "התשובה מהשירות לא קריאה",
};

export function actionLabel(action: string): string {
  return ACTIONS[action as DepositAction] ?? action;
}

export function reasonLabel(reason: string | null): string {
  if (!reason) return "";
  return REASONS[reason] ?? reason;
}

export function hebrewError(error: unknown): string {
  if (error instanceof ApiError) return ERRORS[error.code] ?? error.message;
  return "הבקשה נכשלה";
}

export function formatAmount(value: number): string {
  return new Intl.NumberFormat("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function shortHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}
