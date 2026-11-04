import { useState, type FormEvent } from 'react';
import { Button, TextField } from '../ui/index.js';
import { logIn } from '../api/auth.js';
import styles from './Login.module.css';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const failure = await logIn(username, password);
    setBusy(false);
    if (failure === null) onLoggedIn();
    else setError(failure);
  }

  return (
    <div className={styles.screen}>
      <form className={styles.card} onSubmit={(e) => void submit(e)}>
        <h1 className={styles.title}>Sign in</h1>
        <TextField label="Username" name="username" autoComplete="username" value={username} onChange={setUsername} />
        <TextField label="Password" name="password" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
        {error !== null && <p className={styles.error}>{error}</p>}
        <Button type="submit" variant="primary" disabled={busy || username === '' || password === ''}>
          Sign in
        </Button>
      </form>
    </div>
  );
}
