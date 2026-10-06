import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useFarm } from '../../context/FarmContext.jsx';
import { Badge, Card, Field, Modal, fieldErrors } from '../ui.jsx';
import { Icons } from '../Icons.jsx';
import { date, dateTime, kg, label } from '../../utils/format.js';

const STAGES = ['PREMIUM', 'COMMUNITY', 'RESCUE', 'CLEARANCE', 'DONATION'];
const URGENCY_TONE = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'high' };
const ACTION_LINK = {
  COMMUNITY_PROMOTION: [['/farm/demandpool', 'Open DemandPool', 'network'], ['/farm/campaigns', 'Community outreach']],
  MOVE_TO_RESCUE: [['/farm/rescue', 'Go to Rescue']],
  B2B_CLEARANCE: [['/farm/campaigns', 'B2B clearance outreach']],
};

function DispositionModal({ batch, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ dispositionType: 'DONATION', quantity: batch.unallocatedQuantity, recipient: '', notes: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const errs = fieldErrors(error);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/harvests/${batch.id}/dispositions`, { ...form, quantity: Number(form.quantity), recipient: form.recipient || null, notes: form.notes || null });
      toast(`${label(form.dispositionType)} of ${kg(form.quantity, batch.unit)} recorded`);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Record donation, alternative use or waste" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="disp-form" disabled={busy}>Record</button></>}>
      <form id="disp-form" className="form" onSubmit={submit}>
        {error && <div className="form-error">{error.message}</div>}
        <div className="form-grid">
          <Field label="Outcome">
            <select className="input" value={form.dispositionType} onChange={set('dispositionType')}>
              {['DONATION', 'ALTERNATIVE_USE', 'WASTE'].map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          </Field>
          <Field label={`Quantity (${batch.unit})`} error={errs.quantity} hint={`Up to ${kg(batch.unallocatedQuantity, batch.unit)}`}>
            <input className="input" type="number" min="0.1" step="0.1" max={batch.unallocatedQuantity} value={form.quantity} onChange={set('quantity')} required />
          </Field>
          <Field label="Recipient / use" full><input className="input" value={form.recipient} onChange={set('recipient')} placeholder="e.g. community food programme, compost, staff meals" /></Field>
          <Field label="Notes" full><input className="input" value={form.notes} onChange={set('notes')} /></Field>
        </div>
        <p className="small muted">Donations and alternative use count towards Waste Avoided. Recording waste honestly keeps analytics accurate.</p>
      </form>
    </Modal>
  );
}

/**
 * Shelf-life window for one batch: how urgency rises as produce ages (it feeds MarketRoute's urgency
 * factor), plus the final disposition records — donation, alternative use or waste.
 */
export default function RoutingCard({ batch, canAct, onChanged }) {
  const { features } = useFarm();
  const [recording, setRecording] = useState(false);
  const dispositions = useApi(() => api.get(`/harvests/${batch.id}/dispositions`), [batch.id, batch.disposedQuantity]);
  const r = batch.routing;
  if (!r) return null;
  const idx = STAGES.indexOf(r.stage);

  return (
    <Card
      title="Shelf-life window & final disposition"
      description={`How urgency rises as ${batch.produceName} ages (shelf life ${r.shelfLifeDays} days). Feeds MarketRoute's urgency score. Suggestions only — you decide.`}
      actions={<Badge tone={URGENCY_TONE[r.urgency]}>{label(r.urgency)} urgency</Badge>}
    >
      <div className="row-between">
        <div>
          <div className="strong">{r.stage === 'PRE_HARVEST' ? `Pre-harvest — harvest ${date(batch.harvestDate)}` : `${r.label} · day ${r.daysSinceHarvest} of ${r.shelfLifeDays}`}</div>
          <div className="small muted">{r.active ? r.advice : 'Nothing unallocated — no routing needed.'}</div>
          {r.nextStage && r.active && <div className="small muted">Next: {r.nextStage.label} from {date(r.nextStage.on, { weekday: true })}</div>}
        </div>
        {canAct && r.active && (
          <div className="row">
            {(ACTION_LINK[r.action] || []).filter(([, , needs]) => !needs || features.networkFeaturesEnabled)
              .map(([to, text]) => <Link key={to + text} className="btn btn-sm" to={to}>{text}</Link>)}
            <button className={`btn btn-sm ${r.action === 'RECORD_DISPOSITION' ? 'btn-primary' : ''}`} onClick={() => setRecording(true)}>
              <Icons.Heart />Record donation / use
            </button>
          </div>
        )}
      </div>
      <div className="routing-track" aria-label="Routing stages">
        {STAGES.map((s, i) => (
          <div key={s} className={`routing-step ${i < idx ? 'done' : ''} ${i === idx ? 'current' : ''}`}>
            <b>{label(s)}</b>
            {s === 'PREMIUM' && 'B2B & direct'}
            {s === 'COMMUNITY' && 'Promotion / drops'}
            {s === 'RESCUE' && 'Rescue pricing'}
            {s === 'CLEARANCE' && 'Wholesale / chef pack'}
            {s === 'DONATION' && 'Donate / alt. use'}
          </div>
        ))}
      </div>
      {dispositions.data?.length > 0 && (
        <table className="table mt-16">
          <thead><tr><th>Recorded</th><th>Outcome</th><th className="num">Quantity</th><th>Recipient / use</th><th>By</th></tr></thead>
          <tbody>
            {dispositions.data.map((d) => (
              <tr key={d.id}>
                <td className="nowrap">{dateTime(d.createdAt)}</td>
                <td>{label(d.dispositionType)}</td>
                <td className="num">{kg(d.quantity, batch.unit)}</td>
                <td>{d.recipient || '—'}</td>
                <td>{d.createdByName || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {recording && <DispositionModal batch={batch} onClose={() => setRecording(false)} onSaved={() => { setRecording(false); onChanged(); }} />}
    </Card>
  );
}
