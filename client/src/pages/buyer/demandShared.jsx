// Shared demand/interest building blocks for buyer and consumer pages.
import { useState } from 'react';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Modal, Field, Notice, Badge, Loading, fieldErrors } from '../../components/ui.jsx';
import { kg, money, date, relativeDay, todayISO, addDaysISO, label } from '../../utils/format.js';

export const RECURRENCE = ['NONE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'];
export const OPEN_DEMAND = ['OPEN', 'PARTIALLY_FULFILLED'];

const laterOf = (a, b) => (a && a > b ? a : b);

/** Shared fields: quantity, required date, max price (business only), recurrence, notes. */
function DemandFields({ form, set, errs, unit, consumer }) {
  return (
    <div className="form-grid">
      <Field label={`Quantity (${unit || 'kg'})`} error={errs.quantity}>
        <input className="input" type="number" min="0.5" step="0.5" value={form.quantity} onChange={set('quantity')} required />
      </Field>
      <Field label="Required by" error={errs.requiredDate}>
        <input className="input" type="date" min={todayISO()} value={form.requiredDate} onChange={set('requiredDate')} required />
      </Field>
      {!consumer && (
        <Field label="Max price per unit (optional)" error={errs.maxPrice}>
          <input className="input" type="number" min="0" step="0.01" value={form.maxPrice} onChange={set('maxPrice')} />
        </Field>
      )}
      <Field label="Recurrence" error={errs.recurrence}>
        <select className="input" value={form.recurrence} onChange={set('recurrence')}>
          {RECURRENCE.map((r) => <option key={r} value={r}>{r === 'NONE' ? 'One-off' : label(r)}</option>)}
        </select>
      </Field>
      <Field label="Notes (optional)" full error={errs.notes}>
        <textarea className="input" rows={3} value={form.notes} onChange={set('notes')} />
      </Field>
    </div>
  );
}

function useDemandSubmit({ onClose, onDone, success }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (payload) => {
    if (payload.requiredDate < todayISO()) return setError({ message: 'Required date cannot be in the past.' });
    setBusy(true);
    setError(null);
    try {
      await api.post('/demand', payload);
      toast(success);
      onDone?.();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

const baseForm = (overrides) => ({ quantity: '', requiredDate: addDaysISO(todayISO(), 7), maxPrice: '', recurrence: 'NONE', notes: '', ...overrides });
const toPayload = (form, consumer) => ({
  quantity: Number(form.quantity),
  requiredDate: form.requiredDate,
  maxPrice: !consumer && form.maxPrice ? Number(form.maxPrice) : undefined,
  recurrence: form.recurrence,
  notes: form.notes.trim() || undefined,
});

/** Request supply / register interest against a specific harvest batch from GET /marketplace/supply. */
export function RequestSupplyModal({ item, consumer, onClose, onDone }) {
  const [form, setForm] = useState(() => baseForm({ quantity: consumer ? '1' : '', requiredDate: laterOf(item.harvestDate, todayISO()) }));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { busy, error, submit } = useDemandSubmit({ onClose, onDone, success: consumer ? 'Interest registered' : 'Supply request sent to the farm' });
  const title = consumer ? 'Register interest' : 'Request supply';

  return (
    <Modal title={title} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" form="request-supply" disabled={busy}>{busy ? 'Sending…' : title}</button>
      </>
    }>
      <form id="request-supply" className="form" onSubmit={(e) => { e.preventDefault(); submit({ produceId: item.produceId, farmId: item.farmId, ...toPayload(form, consumer) }); }}>
        {error && <div className="form-error">{error.message}</div>}
        <div>
          <div className="strong">{item.produceName} · {item.farmName}</div>
          <div className="small muted">
            Harvest {date(item.harvestDate)} · {kg(item.availableQuantity, item.unit)} available · {money(item.price)}/{item.unit}
          </div>
        </div>
        <DemandFields form={form} set={set} errs={fieldErrors(error)} unit={item.unit} consumer={consumer} />
        <Notice>
          {consumer
            ? 'This registers your interest with the farm. It is not an order yet — the farm will confirm availability.'
            : 'Your request goes to the farm as demand. The farm reviews it through HarvestMatch and approves a quantity and price; approved matches become orders.'}
        </Notice>
      </form>
    </Modal>
  );
}

/** Register demand: pick a farm + produce, or type a produce name for open-market demand (any farm). */
export function RegisterDemandModal({ consumer, onClose, onDone }) {
  const farms = useApi(() => api.get('/marketplace/farms'), []);
  const [mode, setMode] = useState('farm');
  const [form, setForm] = useState(() => baseForm({ quantity: consumer ? '1' : '', farmId: '', produceId: '', produceName: '', unit: 'kg' }));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === 'farmId' ? { produceId: '' } : {}) }));
  const { busy, error, submit } = useDemandSubmit({ onClose, onDone, success: consumer ? 'Interest added' : 'Demand registered' });
  const errs = fieldErrors(error);
  const farm = farms.data?.find((f) => String(f.id) === form.farmId);
  const produce = farm?.produce.find((p) => String(p.id) === form.produceId);
  const title = consumer ? 'Add interest' : 'Register demand';

  const onSubmit = (e) => {
    e.preventDefault();
    const target = mode === 'farm'
      ? { farmId: Number(form.farmId), produceId: Number(form.produceId) }
      : { produceName: form.produceName.trim(), unit: form.unit.trim() || 'kg' };
    submit({ ...target, ...toPayload(form, consumer) });
  };

  return (
    <Modal title={title} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" form="register-demand" disabled={busy || farms.loading}>{busy ? 'Saving…' : title}</button>
      </>
    }>
      <form id="register-demand" className="form" onSubmit={onSubmit}>
        {error && <div className="form-error">{error.message}</div>}
        <div className="filters">
          {[['farm', 'From a specific farm'], ['open', 'Any farm (open market)']].map(([v, l]) => (
            <button type="button" key={v} className={`chip ${mode === v ? 'active' : ''}`} onClick={() => setMode(v)}>{l}</button>
          ))}
        </div>
        {mode === 'farm' ? (
          farms.loading ? <Loading label="Loading farms…" /> : (
            <div className="form-grid">
              <Field label="Farm" error={errs.farmId}>
                <select className="input" value={form.farmId} onChange={set('farmId')} required>
                  <option value="">Select a farm</option>
                  {(farms.data || []).map((f) => <option key={f.id} value={f.id}>{f.name}{f.region ? ` (${label(f.region)})` : ''}</option>)}
                </select>
              </Field>
              <Field label="Produce" error={errs.produceId}>
                <select className="input" value={form.produceId} onChange={set('produceId')} required disabled={!farm}>
                  <option value="">{farm ? 'Select produce' : 'Choose a farm first'}</option>
                  {farm?.produce.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
                </select>
              </Field>
            </div>
          )
        ) : (
          <div className="form-grid">
            <Field label="Produce name" error={errs.produceName} hint="e.g. Butterhead lettuce">
              <input className="input" value={form.produceName} onChange={set('produceName')} required minLength={2} />
            </Field>
            <Field label="Unit" error={errs.unit}>
              <input className="input" value={form.unit} onChange={set('unit')} />
            </Field>
          </div>
        )}
        <DemandFields form={form} set={set} errs={errs} unit={mode === 'farm' ? produce?.unit : form.unit} consumer={consumer} />
        <Notice>
          {mode === 'open'
            ? 'Open-market demand is visible to every farm on Tyllage; any farm with matching supply can respond.'
            : 'The farm reviews demand through HarvestMatch and confirms what it can supply.'}
        </Notice>
      </form>
    </Modal>
  );
}

/** Product card for a public supply batch. */
export function ProduceCard({ item, action, upcoming }) {
  return (
    <div className="product-card">
      <div className="row-between">
        <h3>{item.produceName}</h3>
        {item.grade && <Badge tone="outline">Grade {item.grade}</Badge>}
      </div>
      <div className="small muted">{item.farmName}</div>
      <div className="price">{money(item.price)}<span className="small muted"> / {item.unit}</span></div>
      <div className="small">
        {upcoming ? 'Expected harvest' : 'Harvest'} <span className="strong">{date(item.harvestDate, { weekday: true })}</span>
        <span className="muted"> · {relativeDay(item.harvestDate)}</span>
      </div>
      <div className="small muted">{kg(item.availableQuantity, item.unit)} available</div>
      <div className="foot">{action}</div>
    </div>
  );
}
