import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from '../../layouts/AuthLayout.jsx';
import { useAuth, homePathFor } from '../../context/AuthContext.jsx';
import { Field, fieldErrors } from '../../components/ui.jsx';
import { label } from '../../utils/format.js';

const BUSINESS_TYPES = ['RESTAURANT', 'CAFE', 'HOTEL', 'CATERER', 'RETAILER', 'WET_MARKET', 'WHOLESALER'];
const REGIONS = ['CENTRAL', 'NORTH', 'NORTH_EAST', 'EAST', 'WEST'];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    role: 'consumer', fullName: '', email: '', password: '', phone: '', organisationName: '', buyerType: 'RESTAURANT', region: '',
    preferredCollectionMethod: 'FARM_PICKUP', whatsappOptIn: false,
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const errs = fieldErrors(error);
  const isBusiness = form.role === 'business_buyer';

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = { ...form, region: form.region || undefined, phone: form.phone || undefined };
    if (!isBusiness) {
      delete payload.organisationName;
      delete payload.buyerType;
    }
    try {
      const user = await register(payload);
      navigate(homePathFor(user), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h1>Create a buyer account</h1>
      <p className="muted mt-8">Restaurants, cafés, hotels, caterers, retailers and households buying local produce.</p>
      <form className="form mt-24" onSubmit={submit}>
        {error && <div className="form-error">{error.message}</div>}
        <div className="filters">
          {[['consumer', 'Household / consumer'], ['business_buyer', 'Business buyer']].map(([v, l]) => (
            <button type="button" key={v} className={`chip ${form.role === v ? 'active' : ''}`} onClick={() => setForm((f) => ({ ...f, role: v }))}>
              {l}
            </button>
          ))}
        </div>
        <Field label="Full name" error={errs.fullName}><input className="input" value={form.fullName} onChange={set('fullName')} required /></Field>
        {isBusiness && (
          <div className="form-grid">
            <Field label="Organisation" error={errs.organisationName}><input className="input" value={form.organisationName} onChange={set('organisationName')} required /></Field>
            <Field label="Business type">
              <select className="input" value={form.buyerType} onChange={set('buyerType')}>
                {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
              </select>
            </Field>
          </div>
        )}
        <Field label="Email" error={errs.email}><input className="input" type="email" value={form.email} onChange={set('email')} required /></Field>
        <Field label="Password" hint="At least 8 characters" error={errs.password}>
          <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={8} />
        </Field>
        <div className="form-grid">
          <Field label="Region">
            <select className="input" value={form.region} onChange={set('region')}>
              <option value="">Prefer not to say</option>
              {REGIONS.map((r) => <option key={r} value={r}>{label(r)}</option>)}
            </select>
          </Field>
          <Field label="Mobile (optional)"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={form.whatsappOptIn} onChange={set('whatsappOptIn')} />
          <span>Send me harvest and Rescue updates on WhatsApp (you can change this later)</span>
        </label>
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
      <p className="small muted mt-16">
        Already have an account? <Link to="/login">Sign in</Link>. Farm accounts are set up by the Tyllage team.
      </p>
    </AuthLayout>
  );
}
