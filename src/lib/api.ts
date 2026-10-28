import type { Operation, OperationInput } from "@/server/ledger";
import type {
  SourceOperation,
  SourceOperationInput,
} from "@/server/sources/operations";
import type { Snapshot } from "./types";

export type SessionState = {
  state:
    | "owner"
    | "signed_out"
    | "expired"
    | "email_unverified"
    | "not_owner"
    | "unconfigured";
  provider?: "neon" | "test";
  email: string | null;
  name: string | null;
  message: string | null;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      body?.error?.message ?? "Request failed.",
      body?.error?.code ?? "error",
      response.status,
    );
  return body.data as T;
}

export const getSessionState = () => request<SessionState>("/api/session");
export const getSnapshot = () => request<Snapshot>("/api/ledger");
export function run<O extends Operation>(
  op: O,
  input: OperationInput<O>,
): Promise<unknown> {
  return request("/api/ledger", {
    method: "POST",
    body: JSON.stringify({ op, input }),
  });
}
export function runSource<O extends SourceOperation>(
  op: O,
  input: Partial<SourceOperationInput<O>>,
): Promise<unknown> {
  return request("/api/sources", {
    method: "POST",
    body: JSON.stringify({ op, input }),
  });
}
export const testSignIn = (email: string) =>
  request("/api/test-auth", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
export const testSignOut = () => fetch("/api/test-auth", { method: "DELETE" });
