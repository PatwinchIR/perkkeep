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
import type { Snapshot } from "@/lib/types";
import { createBackend, type AuthState, type Backend } from "@/lib/backend";
import Link from "next/link";
import { ArrowUpRight, Leaf, LockKeyhole, Mail } from "lucide-react";

type User = { id: string; email: string };
type AppContext = {
  ledger: Backend;
  data: Snapshot;
  user: User;
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
  cards: [],
  benefits: [],
  periods: [],
  evidence: [],
  runs: [],
  audit: [],
  periodErrors: [],
};
export function AppProvider({ children }: { children: ReactNode }) {
  const [ledger] = useState<Backend>(createBackend),
    [auth, setAuth] = useState<AuthState | null>(null),
    [data, setData] = useState<Snapshot>(EMPTY),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [loadedFor, setLoadedFor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [offline, setOffline] = useState(false);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const checkAuth = useCallback(async () => {
    try {
      setAuth(await ledger.current());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to check sign-in.");
      setAuth((previous) => previous ?? { status: "signed_out" });
    }
  }, [ledger]);
  useEffect(() => {
    const timer = setTimeout(() => void checkAuth(), 0);
    const unsubscribe = ledger.subscribe(() => void checkAuth());
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [ledger, checkAuth]);
  const user = auth?.status === "signed_in" ? auth.user : null;
  const userId = user?.id;
  const refresh = useCallback(async () => {
    if (!userId) return;
    const id = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const snapshot = await ledger.load();
      if (generation.current === id) {
        setData(snapshot);
        setLoadedFor(userId);
        setLoaded(true);
      }
    } catch (e) {
      if (generation.current === id) {
        const status = (e as { status?: number }).status;
        // An expired or revoked session returns the app to the sign-in screen.
        if (status === 401 || status === 403) void checkAuth();
        setError(
          e instanceof Error ? e.message : "Could not load your records.",
        );
      }
    } finally {
      if (generation.current === id) setBusy(false);
    }
  }, [ledger, userId, checkAuth]);
  const signOut = useCallback(async () => {
    invalidate();
    await ledger.signOut();
    setData(EMPTY);
    setLoaded(false);
    setLoadedFor(null);
    await checkAuth();
  }, [ledger, checkAuth, invalidate]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setData(EMPTY);
      setLoaded(false);
      if (userId) void refresh();
    }, 0);
    return () => {
      clearTimeout(timer);
      invalidate();
    };
  }, [userId, refresh, invalidate]);
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
    if (!userId) return;
    const onFocus = () => {
      if (navigator.onLine) void refresh();
    };
    window.addEventListener("focus", onFocus);
    const timer = setInterval(onFocus, 60000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [refresh, userId]);
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
  if (!auth)
    return (
      <div className="loading-screen" role="status">
        Opening Perkkeep…
      </div>
    );
  if (!user) return <Login ledger={ledger} auth={auth} onChange={checkAuth} />;
  if (!loaded || loadedFor !== userId)
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
        ledger,
        data,
        user,
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
function Login({
  ledger,
  auth,
  onChange,
}: {
  ledger: Backend;
  auth: AuthState;
  onChange: () => Promise<void>;
}) {
  const [email, setEmail] = useState(
      auth.status === "unverified" || auth.status === "not_allowed"
        ? auth.email
        : "",
    ),
    [password, setPassword] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [create, setCreate] = useState(false),
    [resetToken] = useState(() =>
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("token"),
    );
  async function run(action: () => Promise<string | null>) {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const text = await action();
      if (text) setMessage(text);
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (resetToken) {
      void run(async () => {
        const text = await ledger.resetPassword(resetToken, password);
        window.history.replaceState(null, "", "/");
        return text;
      });
      return;
    }
    void run(() =>
      create ? ledger.signUp(email, password) : ledger.signIn(email, password),
    );
  }
  function passwordReset() {
    if (!email) {
      setError("Enter your email address first.");
      return;
    }
    void run(() => ledger.requestPasswordReset(email));
  }
  return (
    <Welcome>
      <span className="eyebrow">YOUR BENEFITS, TOGETHER</span>
      <h1>
        {resetToken
          ? "Choose a new password."
          : create
            ? "Make yourself at home."
            : "Welcome back."}
      </h1>
      <p>Sign in to your personal benefits ledger.</p>
      {auth.status === "unverified" && (
        <div className="notice" role="status">
          {auth.email} is signed in but not verified yet. Open the link in your
          email, then sign in again.
          <button
            className="text-button"
            disabled={loading}
            onClick={() =>
              void run(() => ledger.resendVerification(auth.email))
            }
          >
            Send a new verification link
          </button>
        </div>
      )}
      {auth.status === "not_allowed" && (
        <div className="notice" role="status">
          {auth.email} does not have access to this private ledger.
          <button
            className="text-button"
            disabled={loading}
            onClick={() => void run(async () => (await ledger.signOut(), null))}
          >
            Sign out
          </button>
        </div>
      )}
      <form onSubmit={submit} className="form-stack">
        {!resetToken && (
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
        )}
        <label>
          {resetToken ? "New password" : "Password"}
          <input
            type="password"
            autoComplete={
              create || resetToken ? "new-password" : "current-password"
            }
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
          {loading
            ? "One moment…"
            : resetToken
              ? "Save new password"
              : create
                ? "Create owner account"
                : "Sign in"}
          <ArrowUpRight size={17} />
        </button>
      </form>
      {!resetToken && (
        <button
          className="secondary full-width"
          disabled={loading}
          onClick={passwordReset}
        >
          <Mail size={16} /> Email me a password reset link
        </button>
      )}
      {!resetToken && (
        <button
          className="text-button"
          onClick={() => {
            setCreate(!create);
            setError("");
          }}
        >
          {create
            ? "Already have an account? Sign in"
            : "First visit? Create the owner account"}
        </button>
      )}
      <p className="fine-print">
        <LockKeyhole size={14} /> Your ledger is private. Only you can access
        your records.
      </p>
    </Welcome>
  );
}
