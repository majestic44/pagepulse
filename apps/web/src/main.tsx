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
      'Owner bootstrap, password sign-in, authenticator-app MFA, sessions, member lifecycle, recoverable deletion and retained audit history.',
    label: 'Phase 2',
    status: 'Complete',
    title: 'Identity and administration',
  },
  {
    detail:
      'Members can create, revise, pause, resume and delete public monitors, choose schedules, and configure whole-page, CSS-selector, or repeated-list extraction.',
    label: 'Phase 3',
    status: 'In progress',
    title: 'Monitor configuration',
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

type AccountDeletionRecovery = Readonly<{
  deletionDeadline: string;
  recoveryToken: string;
}>;

type ManagedMember = Readonly<{
  createdAt: string;
  email: string;
  emailVerified: boolean;
  id: string;
  monitorLimit: number;
  status: 'active' | 'deleting' | 'invited' | 'suspended';
}>;

type OwnerMembersState =
  | Readonly<{ kind: 'forbidden' | 'loading' | 'signed-out' }>
  | Readonly<{ kind: 'ready'; members: ReadonlyArray<ManagedMember> }>;

type AuditEventSummary = Readonly<{
  action: string;
  actorUserId: string | null;
  createdAt: string;
  id: string;
  targetId: string | null;
  targetType: 'account' | 'member' | 'session' | 'system';
}>;

type OwnerAuditState =
  | Readonly<{ kind: 'forbidden' | 'loading' | 'signed-out' }>
  | Readonly<{ events: ReadonlyArray<AuditEventSummary>; kind: 'ready' }>;

type MonitorSummary = Readonly<{
  createdAt: string;
  id: string;
  name: string;
  revision: number;
  state: 'active' | 'authentication_required' | 'blocked' | 'paused';
  url: string;
}>;

type MonitorScheduleType = 'custom' | 'daily' | 'hourly';

type MonitorScheduleSummary = Readonly<{
  customIntervalMinutes: number | null;
  dailyTime: string | null;
  hourlyMinute: number | null;
  scheduleType: MonitorScheduleType;
  timeZone: string;
}>;

type MonitorScheduleResponse = Readonly<{
  monitor: MonitorSummary;
  schedule: MonitorScheduleSummary | null;
}>;

type MonitorTargetType = 'css_selector' | 'whole_page';

type MonitorRepeatedListConfiguration = Readonly<{
  identitySelector: string;
  ignoreSelectors: ReadonlyArray<string>;
  itemSelector: string;
}>;

type MonitorTargetSummary = Readonly<{
  repeatedList: MonitorRepeatedListConfiguration | null;
  selector: string | null;
  targetType: MonitorTargetType;
}>;

type MonitorTargetResponse = Readonly<{
  monitor: MonitorSummary;
  target: MonitorTargetSummary;
}>;

type MonitorTargetPreview = Readonly<{
  matchCount: number;
  repeatedList: Readonly<{
    itemCount: number;
    items: ReadonlyArray<Readonly<{ identity: string; text: string }>>;
    truncated: boolean;
  }> | null;
  repeatedListCandidates: ReadonlyArray<
    Readonly<{
      identitySelectorSuggestions: ReadonlyArray<string>;
      itemCount: number;
      itemSelector: string;
      sampleTexts: ReadonlyArray<string>;
    }>
  >;
  text: string;
  truncated: boolean;
}>;

type MonitorManagementState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'signed-out' }>
  | Readonly<{ kind: 'ready'; monitors: ReadonlyArray<MonitorSummary> }>;

const pagePath = window.location.pathname;
const defaultTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const oneTimeToken =
  pagePath === '/setup/owner' || pagePath === '/verify-email'
    ? (new URLSearchParams(window.location.search).get('token') ?? '')
    : '';

if (oneTimeToken) {
  window.history.replaceState(
    window.history.state,
    document.title,
    `${pagePath}${window.location.hash}`,
  );
}

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
  const [deletionPassword, setDeletionPassword] = useState('');
  const [deletionProof, setDeletionProof] = useState('');
  const [useRecoveryDeletionProof, setUseRecoveryDeletionProof] = useState(false);
  const [deletionRecovery, setDeletionRecovery] = useState<AccountDeletionRecovery>();

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

  async function requestAccountDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !window.confirm(
        'Schedule this account for permanent deletion? You will be signed out immediately and have seven days to recover it with a one-time token.',
      )
    ) {
      return;
    }
    setSubmitting(true);
    setMessage(undefined);
    try {
      const response = await fetch('/api/v1/account/deletion', {
        body: JSON.stringify({
          password: deletionPassword,
          ...(state.kind === 'ready' && state.totpEnabled
            ? useRecoveryDeletionProof
              ? { recoveryCode: deletionProof }
              : { code: deletionProof }
            : {}),
        }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (response.status === 401) {
        setMessage('Your deletion confirmation was not accepted.');
        return;
      }
      if (response.status === 409) {
        setMessage('This account cannot be scheduled for deletion.');
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to schedule account deletion');
      }
      setDeletionRecovery((await response.json()) as AccountDeletionRecovery);
      setDeletionPassword('');
      setDeletionProof('');
    } catch {
      setMessage('Account deletion is temporarily unavailable. Please try again.');
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
      <section className="deletion-panel" aria-labelledby="deletion-title">
        <p className="eyebrow">ACCOUNT DELETION</p>
        <h2 id="deletion-title">Schedule account deletion</h2>
        {deletionRecovery ? (
          <div className="recovery-code-panel">
            <h3>Save this deletion recovery token now</h3>
            <p>
              Your account will be permanently deleted after{' '}
              {formatDate(deletionRecovery.deletionDeadline)}. This token is shown once and is the
              only way to cancel before then.
            </p>
            <p className="manual-key">
              Recovery token: <code>{deletionRecovery.recoveryToken}</code>
            </p>
            <a className="account-link inline-link" href="/account/deletion/recover">
              Recover a scheduled account deletion
            </a>
          </div>
        ) : (
          <form className="sign-in-form" onSubmit={(event) => void requestAccountDeletion(event)}>
            <p>
              This is available for member accounts only. It ends every active session now, then
              permanently removes the account and its data after seven days unless you recover it.
            </p>
            <label>
              Current password
              <input
                autoComplete="current-password"
                disabled={submitting}
                minLength={12}
                onChange={(event) => setDeletionPassword(event.target.value)}
                required
                type="password"
                value={deletionPassword}
              />
            </label>
            {state.totpEnabled ? (
              <>
                <label>
                  {useRecoveryDeletionProof ? 'Recovery code' : 'Authenticator code'}
                  <input
                    autoComplete="one-time-code"
                    disabled={submitting}
                    inputMode={useRecoveryDeletionProof ? 'text' : 'numeric'}
                    onChange={(event) => setDeletionProof(event.target.value)}
                    pattern={useRecoveryDeletionProof ? '[A-Za-z0-9 -]+' : '\\d{6}'}
                    required
                    value={deletionProof}
                  />
                </label>
                <button
                  className="text-button"
                  disabled={submitting}
                  onClick={() => {
                    setDeletionProof('');
                    setUseRecoveryDeletionProof((value) => !value);
                  }}
                  type="button"
                >
                  {useRecoveryDeletionProof
                    ? 'Use authenticator code instead'
                    : 'Use a recovery code instead'}
                </button>
              </>
            ) : null}
            <button className="danger-button" disabled={submitting} type="submit">
              {submitting ? 'Scheduling deletion…' : 'Schedule account deletion'}
            </button>
          </form>
        )}
      </section>
      <p aria-live="polite" className="form-message" role="status">
        {message}
      </p>
    </main>
  );
}

function MonitorManagement() {
  const [state, setState] = useState<MonitorManagementState>({ kind: 'loading' });
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState<MonitorSummary>();
  const [scheduleTarget, setScheduleTarget] = useState<MonitorSummary>();
  const [schedule, setSchedule] = useState<MonitorScheduleSummary | null>();
  const [scheduleType, setScheduleType] = useState<MonitorScheduleType>('daily');
  const [scheduleTimeZone, setScheduleTimeZone] = useState(defaultTimeZone);
  const [hourlyMinute, setHourlyMinute] = useState('0');
  const [dailyTime, setDailyTime] = useState('09:00');
  const [customIntervalMinutes, setCustomIntervalMinutes] = useState('60');
  const [targetMonitor, setTargetMonitor] = useState<MonitorSummary>();
  const [targetType, setTargetType] = useState<MonitorTargetType>('whole_page');
  const [targetSelector, setTargetSelector] = useState('');
  const [repeatedListItemSelector, setRepeatedListItemSelector] = useState('');
  const [repeatedListIdentitySelector, setRepeatedListIdentitySelector] = useState('');
  const [repeatedListIgnoreSelectors, setRepeatedListIgnoreSelectors] = useState('');
  const [targetPreview, setTargetPreview] = useState<MonitorTargetPreview>();
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState<string>();

  const loadMonitors = useCallback(async () => {
    setMessage(undefined);
    try {
      const response = await fetch('/api/v1/monitors', { credentials: 'same-origin' });
      if (response.status === 401) {
        setState({ kind: 'signed-out' });
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to load monitors');
      }
      const payload = (await response.json()) as { monitors: ReadonlyArray<MonitorSummary> };
      setState({ kind: 'ready', monitors: payload.monitors });
    } catch {
      setMessage('Monitor configuration is temporarily unavailable. Please try again.');
    }
  }, []);

  useEffect(() => {
    void loadMonitors();
  }, [loadMonitors]);

  function replaceMonitor(updated: MonitorSummary) {
    setState((current) =>
      current.kind === 'ready'
        ? {
            kind: 'ready',
            monitors: current.monitors.map((monitor) =>
              monitor.id === updated.id ? updated : monitor,
            ),
          }
        : current,
    );
  }

  function loadScheduleForm(value: MonitorScheduleSummary | null) {
    setSchedule(value);
    setScheduleType(value?.scheduleType ?? 'daily');
    setScheduleTimeZone(value?.timeZone ?? defaultTimeZone);
    setHourlyMinute(String(value?.hourlyMinute ?? 0));
    setDailyTime(value?.dailyTime ?? '09:00');
    setCustomIntervalMinutes(String(value?.customIntervalMinutes ?? 60));
  }

  function scheduleDescription(value: MonitorScheduleSummary) {
    if (value.scheduleType === 'hourly') {
      return `Hourly at :${String(value.hourlyMinute).padStart(2, '0')} (${value.timeZone})`;
    }
    if (value.scheduleType === 'daily') {
      return `Daily at ${value.dailyTime} (${value.timeZone})`;
    }
    return `Every ${value.customIntervalMinutes} minutes`;
  }

  function targetPayload() {
    const ignoreSelectors = repeatedListIgnoreSelectors
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const repeatedList =
      repeatedListItemSelector.trim().length > 0 ||
      repeatedListIdentitySelector.trim().length > 0 ||
      ignoreSelectors.length > 0
        ? {
            identitySelector: repeatedListIdentitySelector,
            ignoreSelectors,
            itemSelector: repeatedListItemSelector,
          }
        : undefined;
    const target =
      targetType === 'css_selector' ? { selector: targetSelector, targetType } : { targetType };
    return repeatedList ? { ...target, repeatedList } : target;
  }

  function loadTargetForm(value: MonitorTargetSummary) {
    setTargetType(value.targetType);
    setTargetSelector(value.selector ?? '');
    setRepeatedListItemSelector(value.repeatedList?.itemSelector ?? '');
    setRepeatedListIdentitySelector(value.repeatedList?.identitySelector ?? '');
    setRepeatedListIgnoreSelectors(value.repeatedList?.ignoreSelectors.join('\n') ?? '');
    setTargetPreview(undefined);
  }

  function useRepeatedListCandidate(
    candidate: MonitorTargetPreview['repeatedListCandidates'][number],
  ) {
    setRepeatedListItemSelector(candidate.itemSelector);
    setRepeatedListIdentitySelector(candidate.identitySelectorSuggestions[0] ?? '');
    setRepeatedListIgnoreSelectors('');
  }

  function clearRepeatedList() {
    setRepeatedListItemSelector('');
    setRepeatedListIdentitySelector('');
    setRepeatedListIgnoreSelectors('');
    setTargetPreview(undefined);
  }

  async function createMonitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting('create');
    setMessage(undefined);
    try {
      const response = await fetch('/api/v1/monitors', {
        body: JSON.stringify({ name, url }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (response.status === 409) {
        setMessage('Your monitor limit has been reached.');
        return;
      }
      if (response.status === 400) {
        setMessage('Enter a name and a plain HTTP or HTTPS URL without embedded credentials.');
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to create monitor');
      }
      const monitor = (await response.json()) as MonitorSummary;
      setState((current) =>
        current.kind === 'ready'
          ? { kind: 'ready', monitors: [...current.monitors, monitor] }
          : current,
      );
      setName('');
      setUrl('');
      setMessage(
        'Monitor configuration created. Configure its target and schedule when you are ready.',
      );
    } catch {
      setMessage('Monitor configuration is temporarily unavailable. Please try again.');
    } finally {
      setSubmitting(undefined);
    }
  }

  async function saveMonitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) {
      return;
    }
    setSubmitting(editing.id);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/v1/monitors/${encodeURIComponent(editing.id)}`, {
        body: JSON.stringify({ name, url }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'If-Match': `"${editing.revision}"` },
        method: 'PUT',
      });
      if (response.status === 409) {
        await loadMonitors();
        setEditing(undefined);
        setMessage('This monitor changed elsewhere. The latest configuration has been loaded.');
        return;
      }
      if (response.status === 400) {
        setMessage('Enter a name and a plain HTTP or HTTPS URL without embedded credentials.');
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to update monitor');
      }
      const monitor = (await response.json()) as MonitorSummary;
      replaceMonitor(monitor);
      setEditing(undefined);
      setName('');
      setUrl('');
      setMessage('Monitor configuration updated.');
    } catch {
      setMessage('Monitor configuration is temporarily unavailable. Please try again.');
    } finally {
      setSubmitting(undefined);
    }
  }

  async function changeMonitorState(monitor: MonitorSummary, action: 'pause' | 'resume') {
    setSubmitting(monitor.id);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/v1/monitors/${encodeURIComponent(monitor.id)}/${action}`, {
        credentials: 'same-origin',
        headers: { 'If-Match': `"${monitor.revision}"` },
        method: 'POST',
      });
      if (response.status === 409) {
        await loadMonitors();
        setMessage('This monitor changed elsewhere. The latest configuration has been loaded.');
        return;
      }
      if (!response.ok) {
        throw new Error(`Unable to ${action} monitor`);
      }
      replaceMonitor((await response.json()) as MonitorSummary);
      setMessage(action === 'pause' ? 'Monitor paused.' : 'Monitor resumed.');
    } catch {
      setMessage('Monitor configuration is temporarily unavailable. Please try again.');
    } finally {
      setSubmitting(undefined);
    }
  }

  async function deleteCurrentMonitor(monitor: MonitorSummary) {
    if (!window.confirm(`Delete “${monitor.name}”? This removes only its monitor configuration.`)) {
      return;
    }
    setSubmitting(monitor.id);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/v1/monitors/${encodeURIComponent(monitor.id)}`, {
        credentials: 'same-origin',
        headers: { 'If-Match': `"${monitor.revision}"` },
        method: 'DELETE',
      });
      if (response.status === 409) {
        await loadMonitors();
        setMessage('This monitor changed elsewhere. The latest configuration has been loaded.');
        return;
      }
      if (!response.ok && response.status !== 204) {
        throw new Error('Unable to delete monitor');
      }
      setState((current) =>
        current.kind === 'ready'
          ? { kind: 'ready', monitors: current.monitors.filter((item) => item.id !== monitor.id) }
          : current,
      );
      if (editing?.id === monitor.id) {
        setEditing(undefined);
        setName('');
        setUrl('');
      }
      setMessage('Monitor configuration deleted.');
    } catch {
      setMessage('Monitor configuration is temporarily unavailable. Please try again.');
    } finally {
      setSubmitting(undefined);
    }
  }

  async function openSchedule(monitor: MonitorSummary) {
    setSubmitting(monitor.id);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/v1/monitors/${encodeURIComponent(monitor.id)}/schedule`, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        throw new Error('Unable to load monitor schedule');
      }
      const payload = (await response.json()) as MonitorScheduleResponse;
      replaceMonitor(payload.monitor);
      setScheduleTarget(payload.monitor);
      loadScheduleForm(payload.schedule);
    } catch {
      setMessage('Monitor scheduling is temporarily unavailable. Please try again.');
    } finally {
      setSubmitting(undefined);
    }
  }

  async function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scheduleTarget) {
      return;
    }
    setSubmitting(scheduleTarget.id);
    setMessage(undefined);
    const payload: {
      customIntervalMinutes?: number;
      dailyTime?: string;
      hourlyMinute?: number;
      scheduleType: MonitorScheduleType;
      timeZone: string;
    } = { scheduleType, timeZone: scheduleTimeZone };
    if (scheduleType === 'custom') {
      payload.customIntervalMinutes = Number(customIntervalMinutes);
    } else if (scheduleType === 'daily') {
      payload.dailyTime = dailyTime;
    } else {
      payload.hourlyMinute = Number(hourlyMinute);
    }
    try {
      const response = await fetch(
        `/api/v1/monitors/${encodeURIComponent(scheduleTarget.id)}/schedule`,
        {
          body: JSON.stringify(payload),
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': `"${scheduleTarget.revision}"`,
          },
          method: 'PUT',
        },
      );
      if (response.status === 409) {
        await loadMonitors();
        setScheduleTarget(undefined);
        setSchedule(undefined);
        setMessage('This monitor changed elsewhere. The latest configuration has been loaded.');
        return;
      }
      if (response.status === 400) {
        setMessage('Choose a valid time zone and a schedule of at least one hour.');
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to save monitor schedule');
      }
      const result = (await response.json()) as MonitorScheduleResponse;
      replaceMonitor(result.monitor);
      setScheduleTarget(result.monitor);
      loadScheduleForm(result.schedule);
      setMessage(`Schedule saved: ${scheduleDescription(result.schedule!)}.`);
    } catch {
      setMessage('Monitor scheduling is temporarily unavailable. Please try again.');
    } finally {
      setSubmitting(undefined);
    }
  }

  async function deleteSchedule() {
    if (!scheduleTarget || !schedule) {
      return;
    }
    if (!window.confirm(`Remove the schedule for “${scheduleTarget.name}”?`)) {
      return;
    }
    setSubmitting(scheduleTarget.id);
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/v1/monitors/${encodeURIComponent(scheduleTarget.id)}/schedule`,
        {
          credentials: 'same-origin',
          headers: { 'If-Match': `"${scheduleTarget.revision}"` },
          method: 'DELETE',
        },
      );
      if (response.status === 409) {
        await loadMonitors();
        setScheduleTarget(undefined);
        setSchedule(undefined);
        setMessage('This monitor changed elsewhere. The latest configuration has been loaded.');
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to remove monitor schedule');
      }
      const result = (await response.json()) as MonitorScheduleResponse;
      replaceMonitor(result.monitor);
      setScheduleTarget(result.monitor);
      loadScheduleForm(null);
      setMessage('Monitor schedule removed. The monitor will not receive new scheduled checks.');
    } catch {
      setMessage('Monitor scheduling is temporarily unavailable. Please try again.');
    } finally {
      setSubmitting(undefined);
    }
  }

  async function openTarget(monitor: MonitorSummary) {
    setSubmitting(monitor.id);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/v1/monitors/${encodeURIComponent(monitor.id)}/target`, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        throw new Error('Unable to load monitor target');
      }
      const payload = (await response.json()) as MonitorTargetResponse;
      replaceMonitor(payload.monitor);
      setTargetMonitor(payload.monitor);
      loadTargetForm(payload.target);
    } catch {
      setMessage('Extraction configuration is temporarily unavailable. Please try again.');
    } finally {
      setSubmitting(undefined);
    }
  }

  async function saveTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetMonitor) {
      return;
    }
    setSubmitting(targetMonitor.id);
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/v1/monitors/${encodeURIComponent(targetMonitor.id)}/target`,
        {
          body: JSON.stringify(targetPayload()),
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': `"${targetMonitor.revision}"`,
          },
          method: 'PUT',
        },
      );
      if (response.status === 409) {
        await loadMonitors();
        setTargetMonitor(undefined);
        setTargetPreview(undefined);
        setMessage('This monitor changed elsewhere. The latest configuration has been loaded.');
        return;
      }
      if (response.status === 400) {
        setMessage(
          'Choose a valid target and, when configured, complete each repeated-list selector.',
        );
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to save monitor target');
      }
      const result = (await response.json()) as MonitorTargetResponse;
      replaceMonitor(result.monitor);
      setTargetMonitor(result.monitor);
      loadTargetForm(result.target);
      setMessage(
        result.target.repeatedList
          ? 'Repeated-list extraction saved.'
          : result.target.targetType === 'whole_page'
            ? 'Whole-page extraction saved.'
            : 'CSS selector extraction saved.',
      );
    } catch {
      setMessage('Extraction configuration is temporarily unavailable. Please try again.');
    } finally {
      setSubmitting(undefined);
    }
  }

  async function previewTarget() {
    if (!targetMonitor) {
      return;
    }
    setSubmitting(targetMonitor.id);
    setMessage(undefined);
    setTargetPreview(undefined);
    try {
      const response = await fetch(
        `/api/v1/monitors/${encodeURIComponent(targetMonitor.id)}/target/preview`,
        {
          body: JSON.stringify(targetPayload()),
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
      );
      if (response.status === 400) {
        setMessage(
          'Choose a valid target and, when configured, complete each repeated-list selector before previewing.',
        );
        return;
      }
      if (response.status === 422) {
        const payload = (await response.json()) as { error?: string };
        setMessage(
          payload.error === 'Preview target is not allowed'
            ? 'This monitor URL cannot be previewed safely.'
            : 'The page could not provide a safe HTML preview. Check its availability and try again.',
        );
        return;
      }
      if (response.status === 429) {
        setMessage('Too many preview attempts. Please wait a moment and try again.');
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to preview monitor target');
      }
      const payload = (await response.json()) as { preview: MonitorTargetPreview };
      setTargetPreview(payload.preview);
      setMessage('Extraction preview loaded. Review the selected text before saving.');
    } catch {
      setMessage('Extraction preview is temporarily unavailable. Please try again.');
    } finally {
      setSubmitting(undefined);
    }
  }

  if (state.kind === 'loading') {
    return (
      <main className="shell account-shell" aria-live="polite">
        <p className="eyebrow">MONITORS</p>
        <h1>Loading monitor configuration…</h1>
      </main>
    );
  }

  if (state.kind === 'signed-out') {
    return (
      <main className="shell account-shell">
        <a className="back-link" href="/">
          ← Project status
        </a>
        <p className="eyebrow">MONITORS</p>
        <h1>Sign in to manage monitors.</h1>
        <p className="account-intro">
          Use Account security to create a browser session, then return here to manage your own
          monitor configurations.
        </p>
        <a className="account-link inline-link" href="/account/sessions">
          Go to Account security
        </a>
      </main>
    );
  }

  return (
    <main className="shell account-shell">
      <a className="back-link" href="/">
        ← Project status
      </a>
      <p className="eyebrow">MONITORS</p>
      <h1>Monitor configuration</h1>
      <p className="account-intro">
        Create public HTTP or HTTPS monitors without embedded credentials. Your account limit is
        enforced by the server; new accounts start with up to 50 monitors. Set an hourly, daily, or
        custom schedule in your IANA time zone, then select whole-page or CSS-selector extraction.
      </p>

      <form className="sign-in-form" onSubmit={(event) => void createMonitor(event)}>
        <h2>Create monitor</h2>
        <label>
          Name
          <input
            autoComplete="off"
            maxLength={160}
            onChange={(event) => setName(event.target.value)}
            required
            type="text"
            value={name}
          />
        </label>
        <label>
          Public URL
          <input
            autoComplete="url"
            maxLength={2048}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/announcements"
            required
            type="url"
            value={url}
          />
        </label>
        <button disabled={submitting !== undefined} type="submit">
          Create monitor
        </button>
      </form>

      {editing ? (
        <form className="sign-in-form totp-panel" onSubmit={(event) => void saveMonitor(event)}>
          <h2>Edit {editing.name}</h2>
          <label>
            Name
            <input
              autoComplete="off"
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
              required
              type="text"
              value={name}
            />
          </label>
          <label>
            Public URL
            <input
              autoComplete="url"
              maxLength={2048}
              onChange={(event) => setUrl(event.target.value)}
              required
              type="url"
              value={url}
            />
          </label>
          <div className="member-actions">
            <button disabled={submitting !== undefined} type="submit">
              Save changes
            </button>
            <button
              disabled={submitting !== undefined}
              onClick={() => {
                setEditing(undefined);
                setName('');
                setUrl('');
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {scheduleTarget ? (
        <form className="sign-in-form totp-panel" onSubmit={(event) => void saveSchedule(event)}>
          <h2>Schedule {scheduleTarget.name}</h2>
          <p className="account-intro">
            Daily and hourly schedules follow the selected IANA time zone through daylight-saving
            transitions. Custom schedules use a fixed interval of at least one hour.
          </p>
          <label>
            Schedule type
            <select
              onChange={(event) => setScheduleType(event.target.value as MonitorScheduleType)}
              value={scheduleType}
            >
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="custom">Custom interval</option>
            </select>
          </label>
          <label>
            Time zone
            <input
              autoComplete="off"
              list="monitor-time-zones"
              maxLength={64}
              onChange={(event) => setScheduleTimeZone(event.target.value)}
              required
              type="text"
              value={scheduleTimeZone}
            />
          </label>
          <datalist id="monitor-time-zones">
            <option value="UTC" />
            <option value="America/New_York" />
            <option value="America/Chicago" />
            <option value="America/Denver" />
            <option value="America/Los_Angeles" />
            <option value="Europe/London" />
            <option value="Europe/Berlin" />
            <option value="Asia/Tokyo" />
          </datalist>
          {scheduleType === 'hourly' ? (
            <label>
              Minute past the hour
              <input
                max="59"
                min="0"
                onChange={(event) => setHourlyMinute(event.target.value)}
                required
                step="1"
                type="number"
                value={hourlyMinute}
              />
            </label>
          ) : null}
          {scheduleType === 'daily' ? (
            <label>
              Local time
              <input
                onChange={(event) => setDailyTime(event.target.value)}
                required
                type="time"
                value={dailyTime}
              />
            </label>
          ) : null}
          {scheduleType === 'custom' ? (
            <label>
              Minutes between checks
              <input
                max="35791"
                min="60"
                onChange={(event) => setCustomIntervalMinutes(event.target.value)}
                required
                step="1"
                type="number"
                value={customIntervalMinutes}
              />
            </label>
          ) : null}
          {schedule ? (
            <p className="account-intro">Current: {scheduleDescription(schedule)}.</p>
          ) : null}
          <div className="member-actions">
            <button disabled={submitting !== undefined} type="submit">
              Save schedule
            </button>
            {schedule ? (
              <button
                className="danger-button"
                disabled={submitting !== undefined}
                onClick={() => void deleteSchedule()}
                type="button"
              >
                Remove schedule
              </button>
            ) : null}
            <button
              disabled={submitting !== undefined}
              onClick={() => {
                setScheduleTarget(undefined);
                setSchedule(undefined);
              }}
              type="button"
            >
              Close
            </button>
          </div>
        </form>
      ) : null}

      {targetMonitor ? (
        <form className="sign-in-form totp-panel" onSubmit={(event) => void saveTarget(event)}>
          <h2>Extraction target for {targetMonitor.name}</h2>
          <p className="account-intro">
            Preview requests fetch only this monitor's public URL, use bounded text-only output, and
            reject private or redirected internal destinations.
          </p>
          <label>
            Target type
            <select
              onChange={(event) => setTargetType(event.target.value as MonitorTargetType)}
              value={targetType}
            >
              <option value="whole_page">Whole page</option>
              <option value="css_selector">CSS selector</option>
            </select>
          </label>
          {targetType === 'css_selector' ? (
            <label>
              CSS selector
              <input
                autoComplete="off"
                maxLength={512}
                onChange={(event) => setTargetSelector(event.target.value)}
                placeholder="main > article.job"
                required
                type="text"
                value={targetSelector}
              />
            </label>
          ) : null}
          <section className="extraction-settings">
            <h3>Repeated list (optional)</h3>
            <p className="account-intro">
              Preview the target to detect likely repeating items, then choose the list and the
              region that identifies each item. Ignore selectors are applied only within an item.
            </p>
            <label>
              List item selector
              <input
                autoComplete="off"
                maxLength={512}
                onChange={(event) => setRepeatedListItemSelector(event.target.value)}
                placeholder="ul.openings > li.job"
                type="text"
                value={repeatedListItemSelector}
              />
            </label>
            <label>
              Identity selector within each item
              <input
                autoComplete="off"
                maxLength={512}
                onChange={(event) => setRepeatedListIdentitySelector(event.target.value)}
                placeholder="a[href]"
                type="text"
                value={repeatedListIdentitySelector}
              />
            </label>
            <label>
              Ignore regions within each item
              <textarea
                maxLength={5_120}
                onChange={(event) => setRepeatedListIgnoreSelectors(event.target.value)}
                placeholder={'span.posted-at\nspan.location'}
                rows={3}
                value={repeatedListIgnoreSelectors}
              />
            </label>
            {repeatedListItemSelector ||
            repeatedListIdentitySelector ||
            repeatedListIgnoreSelectors ? (
              <button disabled={submitting !== undefined} onClick={clearRepeatedList} type="button">
                Clear repeated-list settings
              </button>
            ) : null}
          </section>
          {targetPreview ? (
            <>
              <section className="extraction-preview" aria-live="polite">
                <p className="eyebrow">PREVIEW</p>
                <p>
                  {targetPreview.matchCount} matching{' '}
                  {targetPreview.matchCount === 1 ? 'element' : 'elements'}
                  {targetPreview.truncated ? ' · text truncated' : ''}
                </p>
                <pre>{targetPreview.text || 'The selected region contains no readable text.'}</pre>
              </section>
              {targetPreview.repeatedListCandidates.length > 0 ? (
                <section className="extraction-preview repeated-list-preview" aria-live="polite">
                  <p className="eyebrow">REPEATED-LIST CANDIDATES</p>
                  <p>
                    These candidates are derived from the selected target. Choose one, review its
                    suggested identity region, and preview again before saving.
                  </p>
                  <ol className="repeated-list-candidates">
                    {targetPreview.repeatedListCandidates.map((candidate) => (
                      <li key={candidate.itemSelector}>
                        <div>
                          <code>{candidate.itemSelector}</code>
                          <p>
                            {candidate.itemCount} matching{' '}
                            {candidate.itemCount === 1 ? 'item' : 'items'}
                          </p>
                          {candidate.identitySelectorSuggestions.length > 0 ? (
                            <p>
                              Identity suggestions:{' '}
                              {candidate.identitySelectorSuggestions.join(', ')}
                            </p>
                          ) : null}
                          {candidate.sampleTexts.length > 0 ? (
                            <ul>
                              {candidate.sampleTexts.map((sample) => (
                                <li key={sample}>{sample}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                        <button
                          disabled={submitting !== undefined}
                          onClick={() => useRepeatedListCandidate(candidate)}
                          type="button"
                        >
                          Use candidate
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}
              {targetPreview.repeatedList ? (
                <section className="extraction-preview repeated-list-preview" aria-live="polite">
                  <p className="eyebrow">REPEATED-LIST PREVIEW</p>
                  <p>
                    {targetPreview.repeatedList.itemCount} matching list{' '}
                    {targetPreview.repeatedList.itemCount === 1 ? 'item' : 'items'}
                    {targetPreview.repeatedList.truncated ? ' · samples truncated' : ''}
                  </p>
                  <ol className="repeated-list-candidates">
                    {targetPreview.repeatedList.items.map((item, index) => (
                      <li key={`${item.identity}-${index}`}>
                        <strong>{item.identity}</strong>
                        <span>{item.text || 'No readable text remains after ignores.'}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}
            </>
          ) : null}
          <div className="member-actions">
            <button
              disabled={submitting !== undefined}
              onClick={() => void previewTarget()}
              type="button"
            >
              Preview extraction
            </button>
            <button disabled={submitting !== undefined} type="submit">
              Save target
            </button>
            <button
              disabled={submitting !== undefined}
              onClick={() => {
                setTargetMonitor(undefined);
                setTargetPreview(undefined);
              }}
              type="button"
            >
              Close
            </button>
          </div>
        </form>
      ) : null}

      <h2 className="totp-panel">Your monitors</h2>
      {state.monitors.length === 0 ? (
        <p className="account-intro">No monitor configurations yet.</p>
      ) : (
        <ol className="member-list" aria-live="polite">
          {state.monitors.map((monitor) => (
            <li key={monitor.id}>
              <div>
                <div className="session-heading">
                  <h2>{monitor.name}</h2>
                  <strong>{monitor.state.replaceAll('_', ' ')}</strong>
                </div>
                <p>{monitor.url}</p>
                <p>Created {formatDate(monitor.createdAt)}</p>
              </div>
              <div className="member-actions">
                <button
                  disabled={submitting !== undefined}
                  onClick={() => void openTarget(monitor)}
                  type="button"
                >
                  Extraction
                </button>
                <button
                  disabled={submitting !== undefined}
                  onClick={() => void openSchedule(monitor)}
                  type="button"
                >
                  Schedule
                </button>
                <button
                  disabled={submitting !== undefined}
                  onClick={() => {
                    setEditing(monitor);
                    setName(monitor.name);
                    setUrl(monitor.url);
                  }}
                  type="button"
                >
                  Edit
                </button>
                {monitor.state === 'active' ? (
                  <button
                    disabled={submitting !== undefined}
                    onClick={() => void changeMonitorState(monitor, 'pause')}
                    type="button"
                  >
                    Pause
                  </button>
                ) : null}
                {monitor.state === 'paused' ? (
                  <button
                    disabled={submitting !== undefined}
                    onClick={() => void changeMonitorState(monitor, 'resume')}
                    type="button"
                  >
                    Resume
                  </button>
                ) : null}
                <button
                  className="danger-button"
                  disabled={submitting !== undefined}
                  onClick={() => void deleteCurrentMonitor(monitor)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p aria-live="polite" className="form-message" role="status">
        {message}
      </p>
    </main>
  );
}

function OwnerMembers() {
  const [state, setState] = useState<OwnerMembersState>({ kind: 'loading' });
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState<string>();

  const loadMembers = useCallback(async () => {
    setMessage(undefined);
    try {
      const response = await fetch('/api/v1/owner/members', { credentials: 'same-origin' });
      if (response.status === 401) {
        setState({ kind: 'signed-out' });
        return;
      }
      if (response.status === 403) {
        setState({ kind: 'forbidden' });
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to load members');
      }
      const payload = (await response.json()) as { members: ReadonlyArray<ManagedMember> };
      setState({ kind: 'ready', members: payload.members });
    } catch {
      setMessage('Member administration is temporarily unavailable. Please try again.');
    }
  }, []);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  async function manageMember(member: ManagedMember, action: 'reactivate' | 'remove' | 'suspend') {
    if (
      action === 'remove' &&
      !window.confirm(
        `Permanently remove ${member.email}? Their current sessions will end and this cannot be undone.`,
      )
    ) {
      return;
    }
    setSubmitting(`${action}:${member.id}`);
    setMessage(undefined);
    try {
      const response = await fetch(
        action === 'remove'
          ? `/api/v1/owner/members/${encodeURIComponent(member.id)}`
          : `/api/v1/owner/members/${encodeURIComponent(member.id)}/${action}`,
        {
          credentials: 'same-origin',
          method: action === 'remove' ? 'DELETE' : 'POST',
        },
      );
      if (response.status === 409) {
        setMessage(
          'That member changed state before this action could finish. Refresh and try again.',
        );
        await loadMembers();
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to update member');
      }
      setMessage(
        action === 'suspend'
          ? 'Member suspended and active sessions ended.'
          : action === 'reactivate'
            ? 'Member reactivated.'
            : 'Member permanently removed.',
      );
      await loadMembers();
    } catch {
      setMessage('The member action could not be completed. Please try again.');
    } finally {
      setSubmitting(undefined);
    }
  }

  if (state.kind === 'loading') {
    return (
      <main className="shell account-shell" aria-live="polite">
        <p className="eyebrow">OWNER ADMINISTRATION</p>
        <h1>Checking member access…</h1>
      </main>
    );
  }

  if (state.kind !== 'ready') {
    const signedOut = state.kind === 'signed-out';
    return (
      <main className="shell account-shell">
        <a className="back-link" href="/">
          ← Project status
        </a>
        <p className="eyebrow">OWNER ADMINISTRATION</p>
        <h1>
          {signedOut ? 'Sign in as an owner to manage members.' : 'Owner access is required.'}
        </h1>
        <p className="account-intro">
          {signedOut
            ? 'Use Account security to create a browser session, then return here.'
            : 'Member accounts cannot view or change other member accounts.'}
        </p>
        {signedOut ? (
          <a className="account-link inline-link" href="/account/sessions">
            Go to Account security
          </a>
        ) : null}
      </main>
    );
  }

  return (
    <main className="shell account-shell">
      <a className="back-link" href="/">
        ← Project status
      </a>
      <p className="eyebrow">OWNER ADMINISTRATION</p>
      <h1>Members</h1>
      <p className="account-intro">
        Suspend an active member to end every current browser session. Reactivation restores access;
        removal permanently deletes the member and their account data.
      </p>
      <ol className="member-list" aria-live="polite">
        {state.members.map((member) => (
          <li key={member.id}>
            <div>
              <div className="session-heading">
                <h2>{member.email}</h2>
                <strong>{member.status}</strong>
              </div>
              <p>{member.emailVerified ? 'Email verified' : 'Email verification pending'}</p>
              <p>Joined {formatDate(member.createdAt)}</p>
              <p>{member.monitorLimit} monitor limit</p>
            </div>
            <div className="member-actions">
              {member.status === 'active' ? (
                <button
                  disabled={submitting !== undefined}
                  onClick={() => void manageMember(member, 'suspend')}
                  type="button"
                >
                  Suspend
                </button>
              ) : member.status === 'suspended' ? (
                <button
                  disabled={submitting !== undefined}
                  onClick={() => void manageMember(member, 'reactivate')}
                  type="button"
                >
                  Reactivate
                </button>
              ) : null}
              <button
                className="danger-button"
                disabled={submitting !== undefined}
                onClick={() => void manageMember(member, 'remove')}
                type="button"
              >
                Remove member
              </button>
            </div>
          </li>
        ))}
      </ol>
      {state.members.length === 0 ? (
        <p className="account-intro">No redeemed member accounts are available yet.</p>
      ) : null}
      <p aria-live="polite" className="form-message" role="status">
        {message}
      </p>
    </main>
  );
}

function OwnerAuditEvents() {
  const [state, setState] = useState<OwnerAuditState>({ kind: 'loading' });
  const [message, setMessage] = useState<string>();

  const loadAuditEvents = useCallback(async () => {
    setMessage(undefined);
    try {
      const response = await fetch('/api/v1/owner/audit-events', { credentials: 'same-origin' });
      if (response.status === 401) {
        setState({ kind: 'signed-out' });
        return;
      }
      if (response.status === 403) {
        setState({ kind: 'forbidden' });
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to load audit events');
      }
      const payload = (await response.json()) as { events: ReadonlyArray<AuditEventSummary> };
      setState({ events: payload.events, kind: 'ready' });
    } catch {
      setMessage('Audit history is temporarily unavailable. Please try again.');
    }
  }, []);

  useEffect(() => {
    void loadAuditEvents();
  }, [loadAuditEvents]);

  if (state.kind === 'loading') {
    return (
      <main className="shell account-shell" aria-live="polite">
        <p className="eyebrow">OWNER ADMINISTRATION</p>
        <h1>Loading audit history…</h1>
      </main>
    );
  }

  if (state.kind !== 'ready') {
    const signedOut = state.kind === 'signed-out';
    return (
      <main className="shell account-shell">
        <a className="back-link" href="/">
          ← Project status
        </a>
        <p className="eyebrow">OWNER ADMINISTRATION</p>
        <h1>
          {signedOut ? 'Sign in as an owner to view audit history.' : 'Owner access is required.'}
        </h1>
        <p className="account-intro">
          {signedOut
            ? 'Use Account security to create a browser session, then return here.'
            : 'Audit history is visible only to owner accounts.'}
        </p>
        {signedOut ? (
          <a className="account-link inline-link" href="/account/sessions">
            Go to Account security
          </a>
        ) : null}
      </main>
    );
  }

  return (
    <main className="shell account-shell">
      <a className="back-link" href="/">
        ← Project status
      </a>
      <p className="eyebrow">OWNER ADMINISTRATION</p>
      <h1>Security audit history</h1>
      <p className="account-intro">
        The newest 100 security and administrative events are retained for 90 days. This view omits
        email addresses, requester network details, tokens and request bodies.
      </p>
      {state.events.length === 0 ? (
        <p className="account-intro">No audit events have been recorded yet.</p>
      ) : (
        <ol className="member-list" aria-live="polite">
          {state.events.map((event) => (
            <li key={event.id}>
              <div>
                <div className="session-heading">
                  <h2>{event.action.replaceAll('.', ' · ')}</h2>
                  <strong>{event.targetType}</strong>
                </div>
                <p>Recorded {formatDate(event.createdAt)}</p>
                <p>Actor ID: {event.actorUserId ?? 'System or unauthenticated flow'}</p>
                <p>Target ID: {event.targetId ?? 'Not applicable'}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p aria-live="polite" className="form-message" role="status">
        {message}
      </p>
    </main>
  );
}

function AccountDeletionRecovery() {
  const [token, setToken] = useState('');
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function recoverAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(undefined);
    try {
      const response = await fetch('/api/v1/account/deletion/recover', {
        body: JSON.stringify({ token }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (response.status === 401) {
        setMessage('That deletion recovery token is invalid, expired, or has already been used.');
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to recover account deletion');
      }
      setToken('');
      setMessage('Your account deletion was cancelled. You can now sign in again.');
    } catch {
      setMessage('Account recovery is temporarily unavailable. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell account-shell">
      <a className="back-link" href="/">
        ← Project status
      </a>
      <p className="eyebrow">ACCOUNT DELETION RECOVERY</p>
      <h1>Cancel a scheduled account deletion</h1>
      <p className="account-intro">
        Enter the one-time recovery token shown when deletion was scheduled. A successful recovery
        restores the account, but you will need to sign in again.
      </p>
      <form className="sign-in-form" onSubmit={(event) => void recoverAccount(event)}>
        <label>
          Deletion recovery token
          <input
            autoComplete="off"
            disabled={submitting}
            maxLength={43}
            minLength={43}
            onChange={(event) => setToken(event.target.value)}
            pattern="[A-Za-z0-9_-]{43}"
            required
            value={token}
          />
        </label>
        <button disabled={submitting} type="submit">
          {submitting ? 'Recovering…' : 'Cancel account deletion'}
        </button>
      </form>
      <p aria-live="polite" className="form-message" role="status">
        {message}
      </p>
      <a className="account-link inline-link" href="/account/sessions">
        Go to Account security
      </a>
    </main>
  );
}

function VerificationResendForm() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function resendVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(undefined);
    try {
      const response = await fetch('/api/v1/auth/email-verifications/resend', {
        body: JSON.stringify({ email }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (response.status === 202) {
        setMessage('If that address is eligible, a fresh verification link has been sent.');
        return;
      }
      setMessage('Verification delivery is temporarily unavailable. Please try again later.');
    } catch {
      setMessage('Verification delivery is temporarily unavailable. Please try again later.');
    } finally {
      setSubmitting(false);
    }
  }

  const localMailpit = ['127.0.0.1', 'localhost'].includes(window.location.hostname);

  return (
    <section className="recovery-code-panel" aria-labelledby="resend-verification-title">
      <h2 id="resend-verification-title">Need another verification link?</h2>
      <p>
        Enter the account email address. This form gives the same response whether or not an account
        is eligible for verification.
      </p>
      <form className="sign-in-form" onSubmit={(event) => void resendVerification(event)}>
        <label>
          Email address
          <input
            autoComplete="email"
            disabled={submitting}
            maxLength={320}
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        <button disabled={submitting} type="submit">
          {submitting ? 'Sending…' : 'Send a new verification link'}
        </button>
      </form>
      {localMailpit ? (
        <p>
          Local Docker development delivers mail to{' '}
          <a href="http://127.0.0.1:8025" rel="noreferrer" target="_blank">
            Mailpit
          </a>
          .
        </p>
      ) : null}
      <p aria-live="polite" className="form-message" role="status">
        {message}
      </p>
    </section>
  );
}

function OwnerSetup({ initialToken }: Readonly<{ initialToken: string }>) {
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [message, setMessage] = useState<string>();
  const [setupComplete, setSetupComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function completeOwnerSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== passwordConfirmation) {
      setMessage('The password confirmation does not match.');
      return;
    }
    if (!token) {
      setMessage('This setup link is invalid, expired, or has already been used.');
      return;
    }
    setSubmitting(true);
    setMessage(undefined);
    try {
      const response = await fetch('/api/v1/auth/owner-setup', {
        body: JSON.stringify({ password, token }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (response.status === 202) {
        setPassword('');
        setPasswordConfirmation('');
        setSetupComplete(true);
        setToken('');
        setMessage('Your password is set. Check your email for a one-time verification link.');
        return;
      }
      if (response.status === 400) {
        setToken('');
        setMessage('This setup link is invalid, expired, or has already been used.');
        return;
      }
      setMessage(
        'Owner setup is temporarily unavailable. If you already received a verification email, use that link; otherwise request a new verification link below.',
      );
    } catch {
      setMessage(
        'Owner setup is temporarily unavailable. If you already received a verification email, use that link; otherwise request a new verification link below.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell account-shell">
      <a className="back-link" href="/">
        ← Project status
      </a>
      <p className="eyebrow">OWNER SETUP</p>
      <h1>Secure the first owner account</h1>
      <p className="account-intro">
        Choose a password for the one-time owner setup link. The link has already been removed from
        this browser address bar and is never stored by PagePulse.
      </p>
      {!setupComplete ? (
        <form className="sign-in-form" onSubmit={(event) => void completeOwnerSetup(event)}>
          <label>
            Password
            <input
              autoComplete="new-password"
              disabled={submitting || !token}
              minLength={12}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <label>
            Confirm password
            <input
              autoComplete="new-password"
              disabled={submitting || !token}
              minLength={12}
              onChange={(event) => setPasswordConfirmation(event.target.value)}
              required
              type="password"
              value={passwordConfirmation}
            />
          </label>
          <button disabled={submitting || !token} type="submit">
            {submitting ? 'Setting password…' : 'Set password and send verification'}
          </button>
        </form>
      ) : null}
      <p aria-live="polite" className="form-message" role="status">
        {message}
      </p>
      <VerificationResendForm />
    </main>
  );
}

function EmailVerification({ initialToken }: Readonly<{ initialToken: string }>) {
  const [token, setToken] = useState(initialToken);
  const [message, setMessage] = useState<string>();
  const [verified, setVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function verifyEmail() {
    if (!token) {
      setMessage('This verification link is invalid, expired, or has already been used.');
      return;
    }
    setSubmitting(true);
    setMessage(undefined);
    try {
      const response = await fetch('/api/v1/auth/email-verifications/confirm', {
        body: JSON.stringify({ token }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (response.status === 204) {
        setToken('');
        setVerified(true);
        setMessage('Your email is verified. You can now sign in to PagePulse.');
        return;
      }
      if (response.status === 400) {
        setToken('');
        setMessage('This verification link is invalid, expired, or has already been used.');
        return;
      }
      setMessage('Email verification is temporarily unavailable. Please try again.');
    } catch {
      setMessage('Email verification is temporarily unavailable. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell account-shell">
      <a className="back-link" href="/">
        ← Project status
      </a>
      <p className="eyebrow">EMAIL VERIFICATION</p>
      <h1>Verify your email address</h1>
      <p className="account-intro">
        This one-time verification link has been removed from the browser address bar before this
        page displayed it.
      </p>
      {!verified ? (
        <button disabled={submitting || !token} onClick={() => void verifyEmail()} type="button">
          {submitting ? 'Verifying…' : 'Verify email'}
        </button>
      ) : null}
      <p aria-live="polite" className="form-message" role="status">
        {message ??
          (!token
            ? 'This verification link is invalid, expired, or has already been used.'
            : undefined)}
      </p>
      {verified ? (
        <a className="account-link inline-link" href="/account/sessions">
          Go to Account security
        </a>
      ) : null}
      {!verified ? <VerificationResendForm /> : null}
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
        <a className="account-link" href="/monitors">
          Monitors
        </a>
        <a className="account-link" href="/owner/members">
          Member administration
        </a>
        <a className="account-link" href="/owner/audit-events">
          Audit history
        </a>
        <a className="account-link" href="/account/deletion/recover">
          Recover deletion
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
          Local owner onboarding now sends one-time verification links to development-only Mailpit.
          Production verification and password-reset provider delivery remain deferred.
          Authenticator-app MFA, session, member lifecycle and recoverable deletion controls are now
          available. Monitor configuration, scheduling, safe extraction previews, and repeated-list
          selection are ready; rule configuration follows next.
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
        <h2 id="next-title">Monitor scheduling is ready.</h2>
        <p>
          Public monitor CRUD, revisions, pause/resume controls, member limits and timezone-aware
          schedules are ready. Target extraction and change rules follow before page-change
          detection begins.
        </p>
      </section>
    </main>
  );
}

const Page =
  pagePath === '/setup/owner'
    ? () => <OwnerSetup initialToken={oneTimeToken} />
    : pagePath === '/verify-email'
      ? () => <EmailVerification initialToken={oneTimeToken} />
      : pagePath === '/account/sessions'
        ? AccountSessions
        : pagePath === '/monitors'
          ? MonitorManagement
          : pagePath === '/account/deletion/recover'
            ? AccountDeletionRecovery
            : pagePath === '/owner/members'
              ? OwnerMembers
              : pagePath === '/owner/audit-events'
                ? OwnerAuditEvents
                : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
