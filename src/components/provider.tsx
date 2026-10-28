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
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Snapshot } from "@/lib/types";
import { getSupabase, isLocal } from "@/lib/supabase";
import { loadSnapshot } from "@/lib/data";
import Link from "next/link";
import { ArrowUpRight, Leaf, LockKeyhole, Mail } from "lucide-react";

type AppContext = {
  db: SupabaseClient<Database>;
  data: Snapshot;
  session: Session;
  refresh: () => Promise<void>;
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
  const [db] = useState(getSupabase),
    [session, setSession] = useState<Session | null>(null),
    [authReady, setAuthReady] = useState(false),
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
  useEffect(() => {
    if (!db) return;
    let mounted = true;
    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((_event, next) => {
      if (mounted) {
        setSession(next);
        setAuthReady(true);
      }
    });
    db.auth.getSession().then(({ data, error }) => {
      if (mounted) {
        setSession(data.session);
        if (error) setError(error.message);
        setAuthReady(true);
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [db]);
  const userId = session?.user.id;
  const refresh = useCallback(async () => {
    if (!db || !userId) return;
    const id = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const snapshot = await loadSnapshot(db);
      if (generation.current === id) {
        setData(snapshot);
        setLoadedFor(userId);
        setLoaded(true);
      }
    } catch (e) {
      if (generation.current === id)
        setError(
          e instanceof Error ? e.message : "Could not load your records.",
        );
    } finally {
      if (generation.current === id) setBusy(false);
    }
  }, [db, userId]);
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
  if (!db)
    return (
      <Welcome>
        <h1>
          A little setup,
          <br />a lot to keep.
        </h1>
        <p>
          Perkkeep needs its own Supabase connection before you can sign in. The
          setup guide in this project explains how to connect it.
        </p>
        <div className="notice">
          No financial records are loaded. Your existing projects have not been
          connected.
        </div>
      </Welcome>
    );
  if (!authReady)
    return (
      <div className="loading-screen" role="status">
        Opening Perkkeep…
      </div>
    );
  if (!session) return <Login db={db} />;
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
        <button className="text-button" onClick={() => void db.auth.signOut()}>
          Sign out
        </button>
      </div>
    );
  return (
    <Context.Provider
      value={{ db, data, session, refresh, busy, offline, notice: setToast }}
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
function Login({ db }: { db: SupabaseClient<Database> }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [create, setCreate] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = create
        ? await db.auth.signUp({ email, password })
        : await db.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (!result.data.session)
        setMessage("Check your email to finish signing in.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  }
  async function magicLink() {
    if (!email) {
      setError("Enter your email address first.");
      return;
    }
    setLoading(true);
    const { error } = await db.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin,
      },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setMessage("Check your email for a secure sign-in link.");
  }
  return (
    <Welcome>
      <span className="eyebrow">YOUR BENEFITS, TOGETHER</span>
      <h1>{create ? "Make yourself at home." : "Welcome back."}</h1>
      <p>Sign in to your personal benefits ledger.</p>
      {isLocal() && (
        <div className="local-label">
          Local workspace · data stays on this computer
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
            : create
              ? "Create local account"
              : "Sign in"}
          <ArrowUpRight size={17} />
        </button>
      </form>
      <button
        className="secondary full-width"
        disabled={loading}
        onClick={() => void magicLink()}
      >
        <Mail size={16} /> Email me a sign-in link
      </button>
      {isLocal() && (
        <button
          className="text-button"
          onClick={() => {
            setCreate(!create);
            setError("");
          }}
        >
          {create
            ? "Already have an account? Sign in"
            : "First visit? Create a local account"}
        </button>
      )}
      <p className="fine-print">
        <LockKeyhole size={14} /> Your ledger is private. Only you can access
        your records.
      </p>
    </Welcome>
  );
}
