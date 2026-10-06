import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from '../../layouts/AuthLayout.jsx';
import { useAuth, homePathFor } from '../../context/AuthContext.jsx';
import { Field } from '../../components/ui.jsx';
import { label } from '../../utils/format.js';

// Seeded demo accounts (see server/src/seed/seed.js). Shown only in development builds.
const DEMO_ACCOUNTS = [
  ['farmadmin@comcrop.demo', 'farm_admin'],
  ['staff@comcrop.demo', 'farm_staff'],
  ['restaurant@tyllage.demo', 'business_buyer'],
  ['consumer@tyllage.demo', 'consumer'],
  ['admin@tyllage.demo', 'platform_admin'],
];
const SHOW_DEMO = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email, password);
      navigate(homePathFor(user), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h1>Sign in</h1>
      <p className="muted mt-8">Welcome back to Tyllage.</p>
      <form className="form mt-24" onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        <Field label="Email">
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="small muted mt-16">
        New buyer? <Link to="/register">Create a buyer account</Link>
      </p>
      {SHOW_DEMO && (
        <div className="demo-accounts">
          <div className="small strong">Demo accounts</div>
          <div className="small muted" style={{ marginBottom: 6 }}>Fills the email — the shared demo password is in the README.</div>
          {DEMO_ACCOUNTS.map(([em, role]) => (
            <button key={em} type="button" onClick={() => setEmail(em)}>
              <span>{em}</span>
              <span className="muted">{label(role)}</span>
            </button>
          ))}
        </div>
      )}
    </AuthLayout>
  );
}
