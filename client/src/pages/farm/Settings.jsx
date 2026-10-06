import { useState } from 'react';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useFarm } from '../../context/FarmContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { AsyncBoundary, Badge, Card, EmptyState, Field, Modal, PageHeader, Tabs } from '../../components/ui.jsx';
import { Icons } from '../../components/Icons.jsx';
import { dateTime, label, money } from '../../utils/format.js';

const CATEGORIES = ['HERBS', 'LEAFY_GREENS', 'MICROGREENS', 'FRUITING', 'OTHER'];
const METHODS = ['FARM_PICKUP', 'DELIVERY', 'COMMUNITY_DROP'];
const REGIONS = ['CENTRAL', 'NORTH', 'NORTH_EAST', 'EAST', 'WEST'];

function FarmProfile({ farm, canEdit, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: farm.name, description: farm.description || '', region: farm.region || '', address: farm.address || '',
    contactEmail: farm.contactEmail || '', contactPhone: farm.contactPhone || '', fulfilmentMethods: farm.fulfilmentMethods,
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleMethod = (m) => setForm((f) => ({ ...f, fulfilmentMethods: f.fulfilmentMethods.includes(m) ? f.fulfilmentMethods.filter((x) => x !== m) : [...f.fulfilmentMethods, m] }));
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.patch(`/farms/${farm.id}`, { ...form, region: form.region || null, contactEmail: form.contactEmail || null, contactPhone: form.contactPhone || null });
      toast('Farm profile saved');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <Card title="Farm profile" description="Region and fulfilment methods feed HarvestMatch's location score.">
      <form className="form" onSubmit={submit}>
        <fieldset disabled={!canEdit} style={{ border: 'none', padding: 0, margin: 0 }} className="form">
          <div className="form-grid">
            <Field label="Farm name" full><input className="input" value={form.name} onChange={set('name')} required /></Field>
            <Field label="Description" full><textarea className="input" rows={2} value={form.description} onChange={set('description')} /></Field>
            <Field label="Region"><select className="input" value={form.region} onChange={set('region')}><option value="">—</option>{REGIONS.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></Field>
            <Field label="Address"><input className="input" value={form.address} onChange={set('address')} /></Field>
            <Field label="Contact email"><input className="input" type="email" value={form.contactEmail} onChange={set('contactEmail')} /></Field>
            <Field label="Contact phone"><input className="input" value={form.contactPhone} onChange={set('contactPhone')} /></Field>
          </div>
          <Field label="Fulfilment methods offered">
            <div className="row">
              {METHODS.map((m) => (
                <label key={m} className="checkbox"><input type="checkbox" checked={form.fulfilmentMethods.includes(m)} onChange={() => toggleMethod(m)} />{label(m)}</label>
              ))}
            </div>
          </Field>
          {canEdit && <div><button className="btn btn-primary">Save profile</button></div>}
        </fieldset>
      </form>
    </Card>
  );
}

function ProduceModal({ farmId, item, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: item?.name || '', category: item?.category || 'LEAFY_GREENS', unit: item?.unit || 'kg', defaultPrice: item?.defaultPrice ?? '', isActive: item?.isActive ?? true });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    try {
      const body = { ...form, defaultPrice: Number(form.defaultPrice) };
      if (item) await api.patch(`/produce/${item.id}`, body);
      else await api.post('/produce', { ...body, farmId });
      toast(item ? 'Produce updated' : 'Produce added');
      onSaved();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Modal title={item ? `Edit ${item.name}` : 'Add produce'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="produce-form">Save</button></>}>
      <form id="produce-form" className="form" onSubmit={submit}>
        {error && <div className="form-error">{error.message}</div>}
        <div className="form-grid">
          <Field label="Name" full><input className="input" value={form.name} onChange={set('name')} required /></Field>
          <Field label="Category"><select className="input" value={form.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></Field>
          <Field label="Unit"><input className="input" value={form.unit} onChange={set('unit')} required /></Field>
          <Field label="Default selling price ($)"><input className="input" type="number" min="0" step="0.01" value={form.defaultPrice} onChange={set('defaultPrice')} required /></Field>
          <Field label="Status"><label className="checkbox"><input type="checkbox" checked={form.isActive} onChange={set('isActive')} />Active</label></Field>
        </div>
      </form>
    </Modal>
  );
}

function ProduceCatalogue({ farmId, canEdit }) {
  const state = useApi(() => api.get('/produce', { farmId }), [farmId]);
  const [editing, setEditing] = useState(undefined);
  return (
    <Card tight title="Produce catalogue" actions={canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing(null)}><Icons.Plus />Add produce</button>}>
      <AsyncBoundary state={state}>
        {(rows) => rows.length === 0 ? <EmptyState title="No produce yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Category</th><th>Unit</th><th className="num">Default price</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="cell-title">{p.name}</td>
                    <td>{label(p.category)}</td>
                    <td>{p.unit}</td>
                    <td className="num">{money(p.defaultPrice)}</td>
                    <td>{p.isActive ? <Badge tone="low">Active</Badge> : <Badge>Inactive</Badge>}</td>
                    <td>{canEdit && <button className="btn btn-sm btn-ghost" onClick={() => setEditing(p)}>Edit</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AsyncBoundary>
      {editing !== undefined && <ProduceModal farmId={farmId} item={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); state.reload(); }} />}
    </Card>
  );
}

function Team({ farmId }) {
  const state = useApi(() => api.get(`/farms/${farmId}/team`), [farmId]);
  return (
    <Card tight title="Team" description="Farm accounts are provisioned by a Tyllage platform admin.">
      <AsyncBoundary state={state}>
        {(rows) => (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign-in</th></tr></thead>
              <tbody>{rows.map((u) => <tr key={u.id}><td className="cell-title">{u.fullName}</td><td>{u.email}</td><td>{label(u.role)}</td><td>{dateTime(u.lastLoginAt)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </AsyncBoundary>
    </Card>
  );
}

function AuditLog({ farmId }) {
  const state = useApi(() => api.get(`/farms/${farmId}/audit-logs`), [farmId]);
  return (
    <Card tight title="Audit log" description="Farm-sensitive actions: harvest changes, approvals, cancellations, recovery, Rescue and campaigns.">
      <AsyncBoundary state={state}>
        {(rows) => rows.length === 0 ? <EmptyState title="No activity yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Action</th><th>Record</th><th>User</th></tr></thead>
              <tbody>{rows.map((a) => <tr key={a.id}><td className="nowrap">{dateTime(a.createdAt)}</td><td><span className="mono">{a.action}</span></td><td>{label(a.entityType)} #{a.entityId}</td><td>{a.userName || '—'}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </AsyncBoundary>
    </Card>
  );
}

export default function Settings() {
  const { farm, farmId, refreshFarms } = useFarm();
  const { isFarmAdmin } = useAuth();
  const [tab, setTab] = useState('profile');
  const tabs = [
    { value: 'profile', label: 'Farm profile' },
    { value: 'produce', label: 'Produce' },
    { value: 'team', label: 'Team' },
    ...(isFarmAdmin ? [{ value: 'audit', label: 'Audit log' }] : []),
  ];
  if (!farm) return null;
  return (
    <>
      <PageHeader title="Settings" description={farm.name} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'profile' && <FarmProfile key={farm.id} farm={farm} canEdit={isFarmAdmin} onSaved={refreshFarms} />}
      {tab === 'produce' && <ProduceCatalogue farmId={farmId} canEdit={isFarmAdmin} />}
      {tab === 'team' && <Team farmId={farmId} />}
      {tab === 'audit' && <AuditLog farmId={farmId} />}
    </>
  );
}
