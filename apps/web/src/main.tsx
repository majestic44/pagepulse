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
      'Owner bootstrap, password sign-in, authenticator-app MFA and active-session controls are in place; access policies follow.',
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
  | Readonly<{
      kind: 'ready';
      sessions: ReadonlyArray<SessionSummary>;
      totpEnabled: boolean;
    }>;

type TotpEnrollment = Readonly<{
  manualEntryKey: string;
  otpauthUri: string;
}>;

type FactorAction = 'disable' | 'replace-recovery-codes' | undefined;

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
  const [totpLoginRequired, setTotpLoginRequired] = useState(false);
  const [useRecoveryLogin, setUseRecoveryLogin] = useState(false);
  const [loginProof, setLoginProof] = useState('');
  const [enrollment, setEnrollment] = useState<TotpEnrollment>();
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<ReadonlyArray<string>>();
  const [factorAction, setFactorAction] = useState<FactorAction>();
  const [useRecoveryProof, setUseRecoveryProof] = useState(false);
  const [factorProof, setFactorProof] = useState('');

  const loadSessions = useCallback(async () => {
    setMessage(undefined);
    try {
      const sessionResponse = await fetch('/api/v1/account/sessions', {
        credentials: 'same-origin',
      });
      if (sessionResponse.status === 401) {
        setState({ kind: 'signed-out' });
        return;
      }
      if (!sessionResponse.ok) {
        throw new Error('Unable to load active sessions');
      }
      const [sessionPayload, totpResponse] = await Promise.all([
        sessionResponse.json() as Promise<{ sessions: ReadonlyArray<SessionSummary> }>,
        fetch('/api/v1/account/totp', { credentials: 'same-origin' }),
      ]);
      if (!totpResponse.ok) {
        throw new Error('Unable to load account factor status');
      }
      const totpPayload = (await totpResponse.json()) as { enabled: boolean };
      setState({
        kind: 'ready',
        sessions: sessionPayload.sessions,
        totpEnabled: totpPayload.enabled,
      });
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
      if (response.status === 202) {
        setPassword('');
        setTotpLoginRequired(true);
        return;
      }
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

  async function completeTotpLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(undefined);
    try {
      const response = await fetch('/api/v1/auth/totp/login', {
        body: JSON.stringify(
          useRecoveryLogin ? { recoveryCode: loginProof } : { code: loginProof },
        ),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (response.status !== 204) {
        setMessage('The authenticator code or recovery code was not accepted.');
        return;
      }
      setLoginProof('');
      setTotpLoginRequired(false);
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

  async function startTotpEnrollment() {
    setSubmitting(true);
    setMessage(undefined);
    try {
      const response = await fetch('/api/v1/account/totp/enrollments', {
        credentials: 'same-origin',
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Unable to start authenticator enrollment');
      }
      setEnrollment((await response.json()) as TotpEnrollment);
      setEnrollmentCode('');
    } catch {
      setMessage('Authenticator enrollment is temporarily unavailable. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmTotpEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(undefined);
    try {
      const response = await fetch('/api/v1/account/totp/enrollments/confirm', {
        body: JSON.stringify({ code: enrollmentCode }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) {
        setMessage('The authenticator code was not accepted.');
        return;
      }
      const payload = (await response.json()) as { recoveryCodes: ReadonlyArray<string> };
      setRecoveryCodes(payload.recoveryCodes);
      setEnrollment(undefined);
      setEnrollmentCode('');
      await loadSessions();
    } catch {
      setMessage('Authenticator enrollment is temporarily unavailable. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitFactorAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorAction) {
      return;
    }
    setSubmitting(true);
    setMessage(undefined);
    try {
      const endpoint =
        factorAction === 'disable' ? '/api/v1/account/totp' : '/api/v1/account/totp/recovery-codes';
      const response = await fetch(endpoint, {
        body: JSON.stringify(
          useRecoveryProof ? { recoveryCode: factorProof } : { code: factorProof },
        ),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: factorAction === 'disable' ? 'DELETE' : 'POST',
      });
      if (!response.ok) {
        setMessage('The authenticator proof was not accepted.');
        return;
      }
      if (factorAction === 'replace-recovery-codes') {
        const payload = (await response.json()) as { recoveryCodes: ReadonlyArray<string> };
        setRecoveryCodes(payload.recoveryCodes);
      } else {
        setMessage('Authenticator app sign-in has been disabled.');
      }
      setFactorAction(undefined);
      setFactorProof('');
      await loadSessions();
    } catch {
      setMessage('Authenticator settings are temporarily unavailable. Please try again.');
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
        <h1>
          {totpLoginRequired
            ? 'Enter your authenticator code.'
            : 'Sign in to manage your active sessions.'}
        </h1>
        <p className="account-intro">
          {totpLoginRequired
            ? 'Your password was accepted. Complete the second factor to create a secure browser session.'
            : 'This page lists active browser sessions for your account. Signing in creates a new secure session and replaces the session in this browser.'}
        </p>
        {totpLoginRequired ? (
          <form className="sign-in-form" onSubmit={(event) => void completeTotpLogin(event)}>
            <label>
              {useRecoveryLogin ? 'Recovery code' : 'Authenticator code'}
              <input
                autoComplete="one-time-code"
                disabled={submitting}
                inputMode={useRecoveryLogin ? 'text' : 'numeric'}
                onChange={(event) => setLoginProof(event.target.value)}
                pattern={useRecoveryLogin ? '[A-Za-z0-9 -]+' : '\\d{6}'}
                required
                value={loginProof}
              />
            </label>
            <button disabled={submitting} type="submit">
              {submitting ? 'Verifying…' : 'Verify and sign in'}
            </button>
            <button
              className="text-button"
              disabled={submitting}
              onClick={() => {
                setLoginProof('');
                setUseRecoveryLogin((value) => !value);
              }}
              type="button"
            >
              {useRecoveryLogin ? 'Use authenticator code instead' : 'Use a recovery code instead'}
            </button>
            <button
              className="text-button"
              disabled={submitting}
              onClick={() => setTotpLoginRequired(false)}
              type="button"
            >
              Use a different account
            </button>
          </form>
        ) : (
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
        )}
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
      <section className="totp-panel" aria-labelledby="totp-title">
        <p className="eyebrow">AUTHENTICATOR APP</p>
        <h2 id="totp-title">
          {state.totpEnabled ? 'Two-step sign-in is enabled' : 'Add an authenticator app'}
        </h2>
        {recoveryCodes ? (
          <div className="recovery-code-panel">
            <h3>Save these recovery codes now</h3>
            <p>Each code works once. They will not be shown again after you leave this panel.</p>
            <ul className="recovery-code-list">
              {recoveryCodes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
            <button disabled={submitting} onClick={() => setRecoveryCodes(undefined)} type="button">
              I have saved my recovery codes
            </button>
          </div>
        ) : null}
        {enrollment ? (
          <div className="totp-enrollment">
            <p>
              Add this account to an RFC 6238-compatible authenticator, then enter its six-digit
              code.
            </p>
            <p className="manual-key">
              Manual key: <code>{enrollment.manualEntryKey}</code>
            </p>
            <a className="account-link inline-link" href={enrollment.otpauthUri}>
              Open authenticator app
            </a>
            <form className="sign-in-form" onSubmit={(event) => void confirmTotpEnrollment(event)}>
              <label>
                Authenticator code
                <input
                  autoComplete="one-time-code"
                  disabled={submitting}
                  inputMode="numeric"
                  onChange={(event) => setEnrollmentCode(event.target.value)}
                  pattern="\\d{6}"
                  required
                  value={enrollmentCode}
                />
              </label>
              <button disabled={submitting} type="submit">
                {submitting ? 'Verifying…' : 'Enable authenticator app'}
              </button>
              <button
                className="text-button"
                disabled={submitting}
                onClick={() => setEnrollment(undefined)}
                type="button"
              >
                Cancel enrollment
              </button>
            </form>
          </div>
        ) : factorAction ? (
          <form className="sign-in-form" onSubmit={(event) => void submitFactorAction(event)}>
            <p>
              {factorAction === 'disable'
                ? 'Confirm with your authenticator or a recovery code before disabling it.'
                : 'Confirm with your authenticator or a recovery code to replace every existing recovery code.'}
            </p>
            <label>
              {useRecoveryProof ? 'Recovery code' : 'Authenticator code'}
              <input
                autoComplete="one-time-code"
                disabled={submitting}
                inputMode={useRecoveryProof ? 'text' : 'numeric'}
                onChange={(event) => setFactorProof(event.target.value)}
                pattern={useRecoveryProof ? '[A-Za-z0-9 -]+' : '\\d{6}'}
                required
                value={factorProof}
              />
            </label>
            <button disabled={submitting} type="submit">
              {factorAction === 'disable' ? 'Disable authenticator app' : 'Replace recovery codes'}
            </button>
            <button
              className="text-button"
              disabled={submitting}
              onClick={() => {
                setFactorProof('');
                setUseRecoveryProof((value) => !value);
              }}
              type="button"
            >
              {useRecoveryProof ? 'Use authenticator code instead' : 'Use a recovery code instead'}
            </button>
            <button
              className="text-button"
              disabled={submitting}
              onClick={() => setFactorAction(undefined)}
              type="button"
            >
              Cancel
            </button>
          </form>
        ) : state.totpEnabled ? (
          <div className="session-actions">
            <p className="account-intro">
              A verified code is required whenever a new browser session is created.
            </p>
            <button
              disabled={submitting}
              onClick={() => setFactorAction('replace-recovery-codes')}
              type="button"
            >
              Generate new recovery codes
            </button>
            <button
              className="danger-button"
              disabled={submitting}
              onClick={() => setFactorAction('disable')}
              type="button"
            >
              Disable authenticator app
            </button>
          </div>
        ) : (
          <div className="session-actions">
            <p className="account-intro">
              Use a separate authenticator app for a six-digit sign-in code.
            </p>
            <button disabled={submitting} onClick={() => void startTotpEnrollment()} type="button">
              Set up authenticator app
            </button>
          </div>
        )}
      </section>
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
          platform is ready. Authenticator-app MFA and active-session controls are now available;
          monitoring screens follow.
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
