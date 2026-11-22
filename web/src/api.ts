import type { AgentAnswer, DecisionResult, LoadPreview, Session } from "./types";

const SESSION_KEY = "ofek.session";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function readSession(): Session | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    if (!session.token || !session.expiresAt || !session.banker?.displayName) return null;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function writeSession(session: Session | null) {
  if (!session) {
    sessionStorage.removeItem(SESSION_KEY);
    return;
  }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function ping(path: string): Promise<boolean> {
  try {
    const response = await fetch(path);
    return response.ok;
  } catch {
    return false;
  }
}

export async function login(username: string, password: string): Promise<Session> {
  const session = await request<Session>("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  }, false);
  writeSession(session);
  return session;
}

export function logout() {
  writeSession(null);
}

export function uploadWorkbook(file: File): Promise<LoadPreview> {
  const body = new FormData();
  body.set("file", file);
  return request<LoadPreview>("/api/loads", { method: "POST", body });
}

export function decide(loadId: string, decision: "yes" | "no"): Promise<DecisionResult> {
  return request<DecisionResult>(`/api/loads/${encodeURIComponent(loadId)}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

export function ask(question: string): Promise<AgentAnswer> {
  return request<AgentAnswer>("/agent/ask", {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

async function request<T>(path: string, init: RequestInit, withAuth = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (withAuth) {
    const token = readSession()?.token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, "unavailable", "The service is unavailable");
  }

  const payload = await readPayload(response);
  if (!response.ok) {
    const record = payload as { error?: string; code?: string };
    throw new ApiError(response.status, record.code ?? "internal", record.error ?? "Request failed");
  }
  return payload as T;
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text, code: "bad_response" };
  }
}
