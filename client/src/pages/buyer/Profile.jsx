import { useState } from 'react';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Card, AsyncBoundary, Field, Badge, fieldErrors } from '../../components/ui.jsx';
import { label } from '../../utils/format.js';

const REGIONS = ['CENTRAL', 'NORTH', 'NORTH_EAST', 'EAST', 'WEST'];
const COLLECTION_METHODS = ['FARM_PICKUP', 'DELIVERY', 'COMMUNITY_DROP'];
const TEXT_FIELDS = ['organisationName', 'contactName', 'contactEmail', 'contactPhone', 'address'];

function ProfileForm({ profile, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, profile[k] || ''])),
    region: profile.region || '',
    preferredCollectionMethod: profile.preferredCollectionMethod || 'FARM_PICKUP',
    whatsappOptIn: Boolean(profile.whatsappOptIn),
  }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const errs = fieldErrors(error);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = { ...form, region: form.region || null };
    for (const k of TEXT_FIELDS) if (k !== 'organisationName') payload[k] = form[k].trim() || null;
    try {
      onSaved(await api.patch('/buyers/me', payload));
      toast('Profile saved');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      {error && <div className="form-error">{error.message}</div>}
      <div className="form-grid">
        <Field label="Organisation" full error={errs.organisationName}>
          <input className="input" value={form.organisationName} onChange={set('organisationName')} required minLength={2} />
        </Field>
        <Field label="Contact name" error={errs.contactName}><input className="input" value={form.contactName} onChange={set('contactName')} /></Field>
        <Field label="Contact email" error={errs.contactEmail}><input className="input" type="email" value={form.contactEmail} onChange={set('contactEmail')} /></Field>
        <Field label="Contact phone" error={errs.contactPhone}><input className="input" value={form.contactPhone} onChange={set('contactPhone')} /></Field>
        <Field label="Region" error={errs.region}>
          <select className="input" value={form.region} onChange={set('region')}>
            <option value="">Not specified</option>
            {REGIONS.map((r) => <option key={r} value={r}>{label(r)}</option>)}
          </select>
        </Field>
        <Field label="Address" full error={errs.address}><input className="input" value={form.address} onChange={set('address')} /></Field>
        <Field label="Preferred collection" error={errs.preferredCollectionMethod}>
          <select className="input" value={form.preferredCollectionMethod} onChange={set('preferredCollectionMethod')}>
            {COLLECTION_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </select>
        </Field>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={form.whatsappOptIn} onChange={set('whatsappOptIn')} />
        <span>Receive harvest availability and order updates on WhatsApp</span>
      </label>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
      </div>
    </form>
  );
}

export default function Profile() {
  const state = useApi(() => api.get('/buyers/me'), []);
  return (
    <>
      <PageHeader title="Profile" description="Business details farms use when matching your demand and arranging collection." />
      <AsyncBoundary state={state}>
        {(profile) => (
          <Card title="Business profile" actions={profile.buyerType && <Badge tone="outline">{label(profile.buyerType)}</Badge>}>
            <ProfileForm profile={profile} onSaved={state.setData} />
          </Card>
        )}
      </AsyncBoundary>
    </>
  );
}
