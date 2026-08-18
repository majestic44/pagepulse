import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Theme = 'light' | 'dark';
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
      <section>
        <p className="eyebrow">ARCHITECTURE STARTER</p>
        <h1>Know when the page changes.</h1>
        <p>
          PagePulse is ready for incremental development. Begin with Phase 0 in the implementation
          plan, then build monitoring behavior behind tested service boundaries.
        </p>
        <div className="status">
          <strong>Starter status</strong>
          <span>Documentation complete</span>
          <span>Service packages scaffolded</span>
          <span>Docker Compose helpers included</span>
        </div>
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
