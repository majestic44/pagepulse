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
      'Owner bootstrap, password sign-in, authenticator-app MFA, sessions, member lifecycle and recoverable deletion are in place.',
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

const pagePath = window.location.pathname;
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
        <a className="account-link" href="/owner/members">
          Member administration
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
          available; monitoring screens follow.
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
          Security and admin audit history is the remaining identity work. Monitor creation and
          page-change detection begin in Phase 3 once those access controls are complete.
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
        : pagePath === '/account/deletion/recover'
          ? AccountDeletionRecovery
          : pagePath === '/owner/members'
            ? OwnerMembers
            : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
