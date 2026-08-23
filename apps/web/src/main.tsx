import { StrictMode, useEffect, useState } from 'react';
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
      'Owner bootstrap and secure account primitives are in place; session management and access policies follow.',
    label: 'Phase 2',
    status: 'In progress',
    title: 'Identity and administration',
  },
] as const;

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
          platform is ready. No customer monitoring or account screens are available yet.
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
          Session rotation, account recovery and authorization policies are the next identity work.
          Monitor creation and page-change detection begin in Phase 3 once those access controls are
          complete.
        </p>
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
