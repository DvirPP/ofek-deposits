import { useEffect, useState, type FormEvent } from "react";
import { login, logout, ping, readSession } from "./api";
import { AgentPanel } from "./AgentPanel";
import { DeskScreen } from "./DeskScreen";
import { hebrewError } from "./labels";
import type { Session } from "./types";

export function App() {
  const [session, setSession] = useState<Session | null>(() => readSession());
  const [health, setHealth] = useState({ desk: false, agent: false });

  useEffect(() => {
    let live = true;
    const tick = async () => {
      const [desk, agent] = await Promise.all([ping("/api/health"), ping("/agent/health")]);
      if (live) setHealth({ desk, agent });
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 15000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!session) return <Login onSuccess={setSession} />;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <em>אופק</em>
          <span>דלפק הפקדות</span>
        </div>
        <div className="health">
          <Service name="דלפק" up={health.desk} />
          <Service name="סוכן" up={health.agent} />
        </div>
        <div className="who">
          <span>{session.banker.displayName}</span>
          <button
            type="button"
            className="button ghost"
            onClick={() => {
              logout();
              setSession(null);
            }}
          >
            יציאה
          </button>
        </div>
      </header>
      <main className="main">
        <DeskScreen
          onUnauthorized={() => {
            logout();
            setSession(null);
          }}
        />
        <AgentPanel
          onUnauthorized={() => {
            logout();
            setSession(null);
          }}
        />
      </main>
    </div>
  );
}

function Service({ name, up }: { name: string; up: boolean }) {
  return (
    <span className="service">
      <i className={up ? "dot up" : "dot"} />
      {name}
    </span>
  );
}

function Login({ onSuccess }: { onSuccess: (session: Session) => void }) {
  const [username, setUsername] = useState("teller");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSuccess(await login(username.trim(), password));
    } catch (caught) {
      setError(hebrewError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <p className="eyebrow">בנק אופק</p>
        <h1>דלפק הפקדות</h1>
        <p className="quiet">הכניסה נבדקת בדלפק. הדפדפן לא מתחבר למסד.</p>
        {error ? <p className="error">{error}</p> : null}
        <label className="field">
          שם משתמש
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
        </label>
        <label className="field">
          סיסמה
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? "נכנס…" : "כניסה"}
        </button>
        <p className="quiet">בנקאי לדוגמה: teller / teller</p>
      </form>
    </div>
  );
}
