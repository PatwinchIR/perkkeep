// Browser client for the Perkkeep server. The browser holds no database credential:
// it calls same-origin /api routes, which verify the Neon Auth session on the
// server and run each ledger operation under the owner's row-level security.
import type { Snapshot } from "./types";
import type { OperationInput, OperationName } from "./ledger-ops";

export type AuthState =
  | { status: "signed_out" }
  | { status: "unverified"; email: string }
  | { status: "not_allowed"; email: string }
  | { status: "signed_in"; user: { id: string; email: string } };

export type AuthStep = { verify?: string; message?: string };

export interface Backend {
  current(): Promise<AuthState>;
  subscribe(onChange: () => void): () => void;
  /** Resolves once signed in, or asks for the emailed verification code. */
  signIn(email: string, password: string): Promise<AuthStep>;
  signUp(email: string, password: string): Promise<AuthStep>;
  verifyEmail(email: string, code: string): Promise<void>;
  requestPasswordReset(email: string): Promise<string>;
  resendVerification(email: string): Promise<string>;
  resetPassword(token: string, password: string): Promise<string>;
  signOut(): Promise<void>;
  load(): Promise<Snapshot>;
  run<K extends OperationName>(
    op: K,
    input: OperationInput<K>,
  ): Promise<unknown>;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  });
  const body = (await response.json().catch(() => null)) as {
    data?: T;
    error?: string;
    message?: string;
    code?: string;
  } | null;
  if (!response.ok) {
    const error = new Error(
      body?.error ??
        body?.message ??
        `Request failed (${response.status}). Please try again.`,
    ) as Error & { code?: string; status?: number };
    error.code = body?.code;
    error.status = response.status;
    throw error;
  }
  return (body && "data" in body ? body.data : body) as T;
}
const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: "POST", body: JSON.stringify(body) });

export function createBackend(): Backend {
  const origin = () => window.location.origin;
  return {
    async current(): Promise<AuthState> {
      const s = await call<{ state: string; email?: string }>("/api/session");
      if (s.state === "owner")
        return { status: "signed_in", user: { id: s.email!, email: s.email! } };
      if (s.state === "unverified")
        return { status: "unverified", email: s.email! };
      if (s.state === "not_allowed")
        return { status: "not_allowed", email: s.email! };
      return { status: "signed_out" };
    },
    subscribe(onChange) {
      // Session cookies are HttpOnly; re-check when the app regains focus.
      const handler = () => onChange();
      window.addEventListener("focus", handler);
      return () => window.removeEventListener("focus", handler);
    },
    async signIn(email, password) {
      try {
        await post("/api/auth/sign-in/email", { email, password });
        return {};
      } catch (e) {
        if ((e as { code?: string }).code !== "EMAIL_NOT_VERIFIED") throw e;
        return {
          verify: email,
          message: "Enter the verification code we emailed you.",
        };
      }
    },
    async signUp(email, password) {
      await post("/api/auth/sign-up/email", {
        email,
        password,
        name: email.split("@")[0],
      });
      return {
        verify: email,
        message: "We emailed you a verification code. Enter it to finish.",
      };
    },
    async verifyEmail(email, code) {
      await post("/api/auth/email-otp/verify-email", { email, otp: code });
    },
    async requestPasswordReset(email) {
      await post("/api/auth/request-password-reset", {
        email,
        redirectTo: `${origin()}/?reset=1`,
      });
      return "If that address has an account, a password reset link is on its way.";
    },
    async resendVerification(email) {
      await post("/api/auth/email-otp/send-verification-otp", {
        email,
        type: "email-verification",
      });
      return "A new verification code is on its way.";
    },
    async resetPassword(token, password) {
      await post("/api/auth/reset-password", { token, newPassword: password });
      return "Password updated. Sign in with your new password.";
    },
    async signOut() {
      await post("/api/auth/sign-out", {});
    },
    load: () => call<Snapshot>("/api/ledger"),
    run: (op, input) => post("/api/ledger", { op, input }),
  };
}
