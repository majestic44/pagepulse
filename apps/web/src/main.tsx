import { StrictMode, useCallback, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Theme = 'light' | 'dark';

const milestones = [
  {
    detail:
      'Workspace, CI, release automation, multi-architecture images and local Compose deployment.',
    label: 'Phase 0',
    status: 'Complete',
    title: 'Repository foundation',
  },
  {
    detail:
      'Validated configuration, MariaDB migrations, queues, transactional outbox and truthful health checks.',
    label: 'Phase 1',
    status: 'Complete',
    title: 'Service foundation',
  },
  {
    detail:
      'Owner bootstrap, secure credentials and active-session controls are in place; access policies follow.',
    label: 'Phase 2',
    status: 'In progress',
    title: 'Identity and administration',
  },
] as const;

type SessionSummary = Readonly<{
  absoluteExpiresAt: string;
  createdAt: string;
  current: boolean;
  deviceLabel: string;
  id: string;
  idleExpiresAt: string;
  lastUsedAt: string;
}>;

type SessionState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'signed-out' }>
  | Readonly<{ kind: 'ready'; sessions: ReadonlyArray<SessionSummary> }>;

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function AccountSessions() {
  const [state, setState] = useState<SessionState>({ kind: 'loading' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const loadSessions = useCallback(async () => {
    setMessage(undefined);
    try {
      const response = await fetch('/api/v1/account/sessions', { credentials: 'same-origin' });
      if (response.status === 401) {
        setState({ kind: 'signed-out' });
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to load active sessions');
      }
      const payload = (await response.json()) as { sessions: ReadonlyArray<SessionSummary> };
      setState({ kind: 'ready', sessions: payload.sessions });
    } catch {
      setState({ kind: 'signed-out' });
      setMessage('Account security is temporarily unavailable. Please try again.');
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(undefined);
    try {
      const response = await fetch('/api/v1/auth/login', {
        body: JSON.stringify({ email, password }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (response.status !== 204) {
        setMessage('Sign-in failed. Check your email and password, then try again.');
        return;
      }
      setPassword('');
      await loadSessions();
    } catch {
      setMessage('Account security is temporarily unavailable. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeSession(sessionId: string) {
    setSubmitting(true);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/v1/account/sessions/${encodeURIComponent(sessionId)}`, {
        credentials: 'same-origin',
        method: 'DELETE',
      });
      if (!response.ok && response.status !== 204) {
        throw new Error('Unable to revoke the session');
      }
      await loadSessions();
    } catch {
      setMessage('The session could not be revoked. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeOtherSessions() {
    setSubmitting(true);
    setMessage(undefined);
    try {
      const response = await fetch('/api/v1/account/sessions/revoke-others', {
        credentials: 'same-origin',
        method: 'POST',
      });
      if (!response.ok && response.status !== 204) {
        throw new Error('Unable to revoke other sessions');
      }
      await loadSessions();
      setMessage('All other active sessions have been revoked.');
    } catch {
      setMessage('Other sessions could not be revoked. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (state.kind === 'loading') {
    return (
      <main className="shell account-shell" aria-live="polite">
        <p className="eyebrow">ACCOUNT SECURITY</p>
        <h1>Checking your active sessions…</h1>
      </main>
    );
  }

  if (state.kind === 'signed-out') {
    return (
      <main className="shell account-shell">
        <a className="back-link" href="/">
          ← Project status
        </a>
        <p className="eyebrow">ACCOUNT SECURITY</p>
        <h1>Sign in to manage your active sessions.</h1>
        <p className="account-intro">
          This page lists active browser sessions for your account. Signing in creates a new secure
          session and replaces the session in this browser.
        </p>
        <form className="sign-in-form" onSubmit={(event) => void signIn(event)}>
          <label>
            Email
            <input
              autoComplete="email"
              disabled={submitting}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              disabled={submitting}
              minLength={12}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <button disabled={submitting} type="submit">
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p aria-live="polite" className="form-message" role="status">
          {message}
        </p>
        <p className="status-note">
          Verification and password-reset delivery remain deferred until the notification platform
          is available.
        </p>
      </main>
    );
  }

  return (
    <main className="shell account-shell">
      <a className="back-link" href="/">
        ← Project status
      </a>
      <p className="eyebrow">ACCOUNT SECURITY</p>
      <h1>Active sessions</h1>
      <p className="account-intro">
        Sessions expire after eight hours of inactivity and always expire within 30 days. You can
        end any session immediately.
      </p>
      <div className="session-actions">
        <button disabled={submitting} onClick={() => void revokeOtherSessions()} type="button">
          Sign out all other sessions
        </button>
      </div>
      <ol className="session-list" aria-live="polite">
        {state.sessions.map((session) => (
          <li key={session.id}>
            <div>
              <div className="session-heading">
                <h2>{session.deviceLabel}</h2>
                {session.current ? <strong>This device</strong> : null}
              </div>
              <p>Last used {formatDate(session.lastUsedAt)}</p>
              <p>Expires {formatDate(session.absoluteExpiresAt)}</p>
            </div>
            <button
              disabled={submitting}
              onClick={() => void revokeSession(session.id)}
              type="button"
            >
              {session.current ? 'Sign out' : 'Revoke session'}
            </button>
          </li>
        ))}
      </ol>
      <p aria-live="polite" className="form-message" role="status">
        {message}
      </p>
    </main>
  );
}

function App() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('pagepulse-theme') as Theme | null) ?? 'light',
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('pagepulse-theme', theme);
  }, [theme]);
  return (
    <main className="shell">
      <header>
        <div className="brand">
          <span aria-hidden="true">∿</span>PagePulse
        </div>
        <a className="account-link" href="/account/sessions">
          Account security
        </a>
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
          Use {theme === 'light' ? 'dark' : 'light'} theme
        </button>
      </header>
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">PROJECT STATUS · AUGUST 2026</p>
        <h1 id="page-title">The foundation is running. Monitoring is next.</h1>
        <p>
          PagePulse is a self-hosted webpage-change monitoring platform. Its deployment, data and
          service-health foundations are complete, and the invitation-only identity foundation is
          underway.
        </p>
        <p className="status-note">
          Verification and password-reset delivery are deliberately deferred until the notification
          platform is ready. Active-session controls are now available; monitoring screens follow.
        </p>
      </section>

      <section className="progress" aria-labelledby="progress-title">
        <div className="section-heading">
          <p className="eyebrow">IMPLEMENTATION PLAN</p>
          <h2 id="progress-title">Current progress</h2>
        </div>
        <ol className="milestones">
          {milestones.map((milestone) => (
            <li key={milestone.label} className={milestone.status === 'Complete' ? 'complete' : ''}>
              <div className="milestone-meta">
                <span>{milestone.label}</span>
                <strong>{milestone.status}</strong>
              </div>
              <h3>{milestone.title}</h3>
              <p>{milestone.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="next" aria-labelledby="next-title">
        <p className="eyebrow">UP NEXT</p>
        <h2 id="next-title">Finish identity, then begin monitor configuration.</h2>
        <p>
          Authorization policies and account recovery are the next identity work. Monitor creation
          and page-change detection begin in Phase 3 once those access controls are complete.
        </p>
      </section>
    </main>
  );
}

const Page = window.location.pathname === '/account/sessions' ? AccountSessions : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
