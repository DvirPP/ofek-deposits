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

export type DepositAction = "will_load" | "already_exists" | "duplicate_in_file" | "will_not_load";

export type DepositRow = {
  row: number;
  depositId: string | null;
  customerId: string | null;
  action: DepositAction | string;
  whatWillHappen: string;
  reason: string | null;
};

export type LoadSummary = {
  read: number;
  willLoad: number;
  alreadyExists: number;
  duplicateInFile: number;
  willNotLoad: number;
};

export type LoadPreview = {
  loadId: string;
  banker: Banker;
  fileName: string;
  contentHash: string;
  customersSaved: number;
  summary: LoadSummary;
  deposits: DepositRow[];
};

export type YesDecision = {
  loadId: string;
  decision: "yes";
  topic: string;
  message: string;
  published: number;
  depositIds: string[];
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

export type AgentAnswer = {
  html: string;
  react: string | null;
};

export type FileAmount = {
  amount: number | null;
  currency: string | null;
};
