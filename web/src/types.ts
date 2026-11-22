export type Banker = {
  id: string;
  username: string;
  displayName: string;
};

export type Session = {
  token: string;
  expiresAt: string;
  banker: Banker;
};

export type DepositAction =
  | "will_load"
  | "already_exists"
  | "duplicate_in_file"
  | "will_not_load"
  | "failed_from_file";

export type DepositRow = {
  row: number;
  depositId: string | null;
  customerId: string | null;
  action: DepositAction | string;
  whatWillHappen: string;
  reason: string | null;
  amount?: number | null;
  currency?: string | null;
  sourceStatus?: string | null;
};

export type CustomerRejection = {
  row: number;
  customerId: string | null;
  reason: string;
};

export type LoadSummary = {
  read: number;
  willLoad: number;
  alreadyExists: number;
  duplicateInFile: number;
  willNotLoad: number;
  failedFromFile?: number;
  customersRejected?: number;
};

export type LoadPreview = {
  loadId: string;
  banker: Banker;
  fileName: string;
  contentHash: string;
  customersSaved: number;
  customersStored?: boolean;
  replay?: boolean;
  summary: LoadSummary;
  customerRejections?: CustomerRejection[];
  deposits: DepositRow[];
};

export type YesDecision = {
  loadId: string;
  decision: "yes";
  message: string;
  customersSaved: number;
  loaded: number;
  rejected: number;
  pending: number;
  failedFromFile: number;
};

export type NoDecision = {
  loadId: string;
  decision: "no";
  message: string;
  depositsDeleted: number;
  customersKept: boolean;
};

export type DecisionResult = YesDecision | NoDecision;

export type JournalEntry = {
  loadId: string;
  at: string;
  bankerName: string;
  fileName: string;
  contentHash: string;
  customersSaved: number;
  summary: LoadSummary;
  decision: "yes" | "no" | null;
  detail: string | null;
};

export type CurrencyTotal = {
  currency: string;
  count: number;
  amount: number;
};

export type PendingSummary = {
  count: number;
  totals: CurrencyTotal[];
};

export type ProcessResult = {
  batchId: string | null;
  published: number;
  topic: string;
  depositIds: string[];
  skipped?: string[];
  totals: CurrencyTotal[];
};

export type DepositCase = {
  depositId: string;
  customerId: string | null;
  depositType: string | null;
  amount: number | null;
  currency: string | null;
  status: string;
  decisionReason: string | null;
};

export type StatusEvent = {
  status: string;
  reason: string | null;
  at: string;
};

export type AgentAnswer = {
  html: string;
  react: string | null;
};
