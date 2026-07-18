import { useEffect } from 'react';
import type { GlobalProvider } from '@ladle/react';
import '../src/theme/tokens.css';

// Loads the design tokens and mirrors Ladle's light/dark toggle onto our [data-theme] so widgets re-skin like they do in the app.
export const Provider: GlobalProvider = ({ children, globalState }) => {
  useEffect(() => {
    document.documentElement.dataset.theme = globalState.theme === 'dark' ? 'dark' : 'light';
  }, [globalState.theme]);

  return (
    <div style={{ background: 'var(--bg)', color: 'var(--text)', padding: 24, minHeight: '100vh' }}>
      <div style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 20 }}>{children}</div>
    </div>
  );
};
