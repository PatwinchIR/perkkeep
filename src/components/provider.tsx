"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_SETTINGS, type Snapshot } from "@/lib/types";
import {
  ApiError,
  getSessionState,
  getSnapshot,
  testSignIn,
  testSignOut,
  type SessionState,
} from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { ArrowUpRight, Leaf, LockKeyhole, Mail } from "lucide-react";

type AppContext = {
  data: Snapshot;
  session: { email: string; name: string | null; provider: "neon" | "test" };
  reloadSession: () => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  busy: boolean;
  offline: boolean;
  notice: (text: string) => void;
};
const Context = createContext<AppContext | null>(null);
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error("App context unavailable");
  return value;
}
const EMPTY: Snapshot = {
  cardArt: [],
  accounts: [],
  connections: [],
  syncs: [],
  imports: [],
  cards: [],
  benefits: [],
  periods: [],
  evidence: [],
  runs: [],
  audit: [],
  acknowledgements: [],
  settings: DEFAULT_SETTINGS,
  periodErrors: [],
};
const errorText = (e: unknown, fallback: string) =>
  e instanceof Error ? e.message : fallback;
export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null),
    [data, setData] = useState<Snapshot>(EMPTY),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [offline, setOffline] = useState(false);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const checkSession = useCallback(async () => {
    try {
      setSession(await getSessionState());
    } catch (e) {
      setError(errorText(e, "Could not reach PerkKeep."));
      setSession({
        state: "signed_out",
        email: null,
        name: null,
        message: null,
      });
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void checkSession(), 0);
    return () => clearTimeout(timer);
  }, [checkSession]);
  const owner = session?.state === "owner" ? session.email : null;
  const refresh = useCallback(async () => {
    if (!owner) return;
    const id = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const snapshot = await getSnapshot();
      if (generation.current === id) {
        setData(snapshot);
        setLoaded(true);
      }
    } catch (e) {
      if (generation.current !== id) return;
      // A revoked or expired session sends the person back to sign-in.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403))
        await checkSession();
      else setError(errorText(e, "Could not load your records."));
    } finally {
      if (generation.current === id) setBusy(false);
    }
  }, [owner, checkSession]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setData(EMPTY);
      setLoaded(false);
      if (owner) void refresh();
    }, 0);
    return () => {
      clearTimeout(timer);
      invalidate();
    };
  }, [owner, refresh, invalidate]);
  const signOut = useCallback(async () => {
    invalidate();
    if (session?.provider === "test") await testSignOut();
    else await authClient().signOut();
    setData(EMPTY);
    setLoaded(false);
    await checkSession();
  }, [session?.provider, checkSession, invalidate]);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (!owner) return;
    const onFocus = () => {
      if (navigator.onLine) void refresh();
    };
    window.addEventListener("focus", onFocus);
    const timer = setInterval(onFocus, 60000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [refresh, owner]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* Installation is optional; online records still work. */
      });
  }, []);
  if (!session)
    return (
      <div className="loading-screen" role="status">
        Opening Perkkeep…
      </div>
    );
  if (session.state === "unconfigured")
    return (
      <Welcome>
        <h1>
          A little setup,
          <br />a lot to keep.
        </h1>
        <p>
          Perkkeep needs its database and sign-in settings before you can sign
          in. The deployment guide in this project explains how to connect them.
        </p>
        <div className="notice">No financial records are loaded.</div>
      </Welcome>
    );
  if (session.state === "email_unverified" && session.email)
    return (
      <VerifyEmail
        email={session.email}
        onDone={checkSession}
        onSignOut={signOut}
      />
    );
  if (session.state === "not_owner")
    return (
      <Welcome>
        <h1>This workspace is private.</h1>
        <p>{session.message}</p>
        <button className="secondary full-width" onClick={() => void signOut()}>
          Sign out
        </button>
      </Welcome>
    );
  if (session.state !== "owner" || !session.email)
    return (
      <Login
        provider={session.provider ?? "neon"}
        expired={session.state === "expired"}
        onSignedIn={checkSession}
      />
    );
  if (!loaded)
    return (
      <div className="loading-screen">
        <Leaf size={32} />
        <h1>Getting your cards together</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="primary" onClick={() => void refresh()}>
              Try again
            </button>
          </>
        ) : (
          <p role="status">Loading your private ledger…</p>
        )}
        <button className="text-button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  return (
    <Context.Provider
      value={{
        data,
        session: {
          email: session.email,
          name: session.name,
          provider: session.provider ?? "neon",
        },
        reloadSession: checkSession,
        refresh,
        signOut,
        busy,
        offline,
        notice: setToast,
      }}
    >
      {offline && (
        <div className="global-banner" role="status">
          You’re offline. This is the last view loaded on this device. Reconnect
          to make changes.
        </div>
      )}
      {error && (
        <div className="global-banner error" role="alert">
          {error} <button onClick={() => void refresh()}>Retry loading</button>
        </div>
      )}
      {children}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </Context.Provider>
  );
}
function Welcome({ children }: { children: ReactNode }) {
  return (
    <main className="welcome">
      <div className="welcome-art">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <Leaf size={23} />
          </span>
          perkkeep<span className="brand-dot">.</span>
        </Link>
        <div className="welcome-copy">
          <span className="eyebrow">A LITTLE MORE FROM EVERY CARD</span>
          <h2>
            Good things.
            <br />
            Worth keeping.
          </h2>
          <p>
            Know what you’ve used. See what’s still there.
            <br />
            Keep the whole story.
          </p>
          <div className="illustrated-cards" aria-hidden="true">
            <div className="illustrated-card back">Every benefit</div>
            <div className="illustrated-card front">
              <Leaf size={28} />
              <span>All in one place.</span>
              <span className="chip" />
            </div>
          </div>
        </div>
        <div className="welcome-foot">
          <LockKeyhole size={15} /> A private home for your card benefits
        </div>
      </div>
      <div className="welcome-form">{children}</div>
    </main>
  );
}
type AuthResult = { error?: { message?: string; code?: string } | null };
function authError(result: AuthResult) {
  if (result.error)
    throw Object.assign(new Error(result.error.message ?? "Sign-in failed."), {
      code: result.error.code,
    });
}
function Login({
  provider,
  expired,
  onSignedIn,
}: {
  provider: "neon" | "test";
  expired: boolean;
  onSignedIn: () => Promise<void>;
}) {
  const [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [create, setCreate] = useState(false),
    [verifying, setVerifying] = useState(false);
  const local = provider === "test";
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (local) await testSignIn(email);
      else if (create) {
        authError(
          await authClient().signUp.email({
            email,
            password,
            name: name.trim(),
          }),
        );
        // Neon Auth issues no session until the email is verified, so ask for the code now.
        setVerifying(true);
        return;
      } else authError(await authClient().signIn.email({ email, password }));
      await onSignedIn();
    } catch (e) {
      if ((e as { code?: string }).code === "EMAIL_NOT_VERIFIED") {
        setVerifying(true);
        return;
      }
      setError(errorText(e, "Sign-in failed."));
    } finally {
      setLoading(false);
    }
  }
  if (verifying)
    return (
      <VerifyEmail
        email={email}
        backLabel="Back to sign in"
        onDone={async () => {
          if (password)
            authError(await authClient().signIn.email({ email, password }));
          await onSignedIn();
        }}
        onSignOut={async () => setVerifying(false)}
      />
    );
  async function emailCode() {
    if (!email) {
      setError("Enter your email address first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      authError(
        await authClient().emailOtp.sendVerificationOtp({
          email,
          type: "sign-in",
        }),
      );
      setMessage("Check your email for a one-time sign-in code.");
    } catch (e) {
      setError(errorText(e, "Could not send a code."));
    } finally {
      setLoading(false);
    }
  }
  return (
    <Welcome>
      <span className="eyebrow">YOUR BENEFITS, TOGETHER</span>
      <h1>{create ? "Make yourself at home." : "Welcome back."}</h1>
      <p>Sign in to your personal benefits ledger.</p>
      {expired && (
        <p className="notice" role="status">
          Your session ended. Sign in again to continue.
        </p>
      )}
      {local && (
        <div className="local-label">
          Local synthetic sign-in · no password, local database only
        </div>
      )}
      <form onSubmit={submit} className="form-stack">
        <label>
          Email address
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        {!local && create && (
          <label>
            Your name, as printed on your cards
            <input
              autoComplete="name"
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        {!local && (
          <label>
            Password
            <input
              type="password"
              autoComplete={create ? "new-password" : "current-password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <button className="primary" disabled={loading}>
          {loading ? "One moment…" : create ? "Create account" : "Sign in"}
          <ArrowUpRight size={17} />
        </button>
      </form>
      {!local && (
        <>
          <button
            className="secondary full-width"
            disabled={loading}
            onClick={() => void emailCode()}
          >
            <Mail size={16} /> Email me a sign-in code
          </button>
          <button
            className="text-button"
            onClick={() => {
              setCreate(!create);
              setError("");
            }}
          >
            {create
              ? "Already have an account? Sign in"
              : "First visit? Create your account"}
          </button>
        </>
      )}
      <p className="fine-print">
        <LockKeyhole size={14} /> Your ledger is private. Only the owner can
        access its records.
      </p>
    </Welcome>
  );
}
function VerifyEmail({
  email,
  onDone,
  onSignOut,
  backLabel = "Sign out",
}: {
  email: string;
  onDone: () => Promise<void>;
  onSignOut: () => Promise<void>;
  backLabel?: string;
}) {
  const [otp, setOtp] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function send() {
    setLoading(true);
    setError("");
    try {
      authError(
        await authClient().emailOtp.sendVerificationOtp({
          email,
          type: "email-verification",
        }),
      );
      setMessage("A verification code is on its way.");
    } catch (e) {
      setError(errorText(e, "Could not send a code."));
    } finally {
      setLoading(false);
    }
  }
  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      authError(await authClient().emailOtp.verifyEmail({ email, otp }));
      await onDone();
    } catch (e) {
      setError(errorText(e, "That code did not work."));
    } finally {
      setLoading(false);
    }
  }
  return (
    <Welcome>
      <span className="eyebrow">ONE MORE STEP</span>
      <h1>Verify your email.</h1>
      <p>
        PerkKeep opens only for a verified email address. Enter the code sent to{" "}
        {email}, or follow the link in that email and then reload this page.
      </p>
      <form onSubmit={verify} className="form-stack">
        <label>
          Verification code
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={otp}
            onChange={(e) => setOtp(e.target.value.trim())}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <button className="primary" disabled={loading}>
          Verify and continue
        </button>
      </form>
      <button
        className="secondary full-width"
        disabled={loading}
        onClick={() => void send()}
      >
        <Mail size={16} /> Send a new code
      </button>
      <button className="text-button" onClick={() => void onSignOut()}>
        {backLabel}
      </button>
    </Welcome>
  );
}
