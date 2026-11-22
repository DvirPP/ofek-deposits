import type { DepositAction } from "./types";
import { ApiError } from "./api";

const ACTIONS: Record<DepositAction, string> = {
  will_load: "תישמר כממתינה",
  already_exists: "כבר קיימת",
  duplicate_in_file: "כפילות בקובץ",
  will_not_load: "לא תישמר לעיבוד",
  failed_from_file: "תישמר ככושלת",
};

const REASONS: Record<string, string> = {
  "Missing deposit id": "חסר מזהה הפקדה",
  "Duplicate deposit id in file": "מזהה הפקדה כפול בקובץ",
  "Deposit id already exists": "מזהה ההפקדה כבר קיים",
  "Customer does not exist": "הלקוח לא קיים",
  "Invalid deposit amount": "סכום הפקדה לא תקין",
  "Unsupported currency": "מטבע לא נתמך",
  "Invalid deposit date": "תאריך הפקדה לא תקין",
  "Invalid deposit type": "סוג הפקדה לא מוכר",
  "Invalid channel": "ערוץ לא מוכר",
  "Account number does not match customer": "מספר החשבון לא תואם ללקוח",
  "Missing account number": "חסר מספר חשבון",
  "Term deposit is missing a term": "לפיקדון חסרה תקופה",
  "Term deposit is missing an interest rate": "לפיקדון חסרה ריבית",
  "Term deposit is missing a maturity date": "לפיקדון חסר תאריך פדיון",
  "Maturity date is before the deposit date": "תאריך הפדיון לפני תאריך ההפקדה",
  "Missing account status": "חסר מצב חשבון",
  "Invalid account status": "מצב חשבון לא מוכר",
  "Duplicate customer id in file": "מזהה לקוח כפול בקובץ",
  "Missing customer id": "חסר מזהה לקוח",
  "Unsupported deposit status": "סטטוס הפקדה לא מוכר",
  "Invalid attempt count": "מספר ניסיונות לא תקין",
  "Account is frozen": "החשבון מוקפא",
  "Amount exceeds 1000000 ILS": "הסכום מעל מיליון שקלים",
  "Rejected by a banker": "נדחתה על ידי בנקאי",
  "Failure cannot be retried": "אי אפשר לנסות שוב את הסיבה הזו",
};

const STATUSES: Record<string, string> = {
  Processing: "בעיבוד",
  Completed: "הושלם",
  Failed: "נכשל",
  PendingApproval: "ממתין לאישור",
};

const ERRORS: Record<string, string> = {
  invalid_credentials: "שם המשתמש או הסיסמה שגויים",
  unauthenticated: "נדרשת כניסה מחדש",
  file_required: "חסר קובץ אקסל",
  bad_workbook: "הקובץ חייב לכלול גיליונות Customers ו-Deposits",
  bad_decision: "ההחלטה לא מוכרת",
  load_not_found: "הטעינה לא נמצאה",
  already_decided: "כבר התקבלה החלטה על הטעינה הזו",
  preview_missing: "תצוגת הקובץ כבר לא זמינה",
  deposit_exists: "מזהה הפקדה כבר נשמר",
  deposit_ids_required: "צריך לבחור הפקדות לניסיון חוזר",
  publish_failed: "הפרסום לקפקא נכשל. השורות חזרו לתור",
  case_not_found: "אין תיק עיבוד להפקדה הזו",
  not_pending_approval: "ההפקדה לא ממתינה לאישור",
  bad_status: "סטטוס לא מוכר",
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

export function statusLabel(status: string): string {
  return STATUSES[status] ?? status;
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
