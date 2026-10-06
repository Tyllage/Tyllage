// Shared demand/interest and direct-order building blocks for buyer and consumer pages.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Modal, Field, Notice, Badge, Loading, fieldErrors } from '../../components/ui.jsx';
import { kg, money, date, relativeDay, todayISO, addDaysISO, label } from '../../utils/format.js';

export const RECURRENCE = ['NONE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'];
export const OPEN_DEMAND = ['OPEN', 'PARTIALLY_FULFILLED'];
export const COLLECTION_METHODS = ['FARM_PICKUP', 'DELIVERY', 'COMMUNITY_DROP'];
export const CONSUMER_COLLECTION = ['FARM_PICKUP', 'COMMUNITY_DROP'];

const laterOf = (a, b) => (a && a > b ? a : b);

/** Orders page for the signed-in buyer's role. */
export const ordersPathFor = (role) => (role === 'consumer' ? '/consumer/orders' : '/buyer/orders');

/** Farm name linking to its public profile. */
export function FarmLink({ id, name }) {
  return id ? <Link to={`/market/farms/${id}`}>{name}</Link> : <span>{name}</span>;
}

/** Default order quantity for a public batch: the farm minimum (or 1), capped at what is available. */
export const defaultOrderQty = (item) => Math.min(Math.max(Number(item.minOrderQuantity) || 0, 1), item.availableQuantity);

/** Error message when `qty` breaks the farm minimum or exceeds available stock, else null. */
export function orderQtyError(item, qty) {
  const moq = Number(item.minOrderQuantity) || 0;
  if (!(qty > 0)) return 'Enter a quantity greater than 0.';
  if (qty > item.availableQuantity) return `Only ${kg(item.availableQuantity, item.unit)} of ${item.produceName} is available.`;
  if (moq > 0 && qty < moq) return `Minimum order for ${item.produceName} is ${kg(moq, item.unit)}.`;
  return null;
}

/** Toast body confirming a placed order, with a link to the buyer's orders. */
export function OrderPlacedToast({ order, role }) {
  return (
    <span>
      Order #{order.id} placed — awaiting farm confirmation.{' '}
      <Link to={ordersPathFor(role)} style={{ color: '#fff', textDecoration: 'underline' }}>View orders</Link>
    </span>
  );
}

/** Shared fields: quantity, required date, max price + minimum delivery (business only), recurrence, notes. */
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
      {!consumer && (
        <Field label={`Minimum delivery (${unit || 'kg'}, optional)`} error={errs.minQuantity} hint="Smallest partial delivery you will accept">
          <input className="input" type="number" min="0.5" step="0.5" max={form.quantity || undefined} value={form.minQuantity} onChange={set('minQuantity')} />
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
    if (payload.minQuantity && payload.minQuantity > payload.quantity) {
      return setError({ message: 'Minimum delivery cannot exceed the requested quantity.', details: [{ field: 'minQuantity', message: 'Must be at most the requested quantity' }] });
    }
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

const baseForm = (overrides) => ({ quantity: '', requiredDate: addDaysISO(todayISO(), 7), maxPrice: '', minQuantity: '', recurrence: 'NONE', notes: '', ...overrides });
const toPayload = (form, consumer) => ({
  quantity: Number(form.quantity),
  requiredDate: form.requiredDate,
  maxPrice: !consumer && form.maxPrice ? Number(form.maxPrice) : undefined,
  minQuantity: !consumer && form.minQuantity ? Number(form.minQuantity) : undefined,
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
  const [form, setForm] = useState(() => baseForm({ quantity: consumer ? '1' : '', farmId: '', produceId: '', produceName: '', unit: 'kg', allowPooling: false }));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === 'farmId' ? { produceId: '' } : {}) }));
  const { busy, error, submit } = useDemandSubmit({ onClose, onDone, success: consumer ? 'Interest added' : 'Demand registered' });
  const errs = fieldErrors(error);
  const farm = farms.data?.find((f) => String(f.id) === form.farmId);
  const produce = farm?.produce.find((p) => String(p.id) === form.produceId);
  const title = consumer ? 'Add interest' : 'Register demand';
  const open = mode === 'open';

  const switchMode = (v) => {
    setMode(v);
    // FarmPool only applies to open-market demand.
    if (v === 'farm') setForm((f) => ({ ...f, allowPooling: false }));
  };

  const onSubmit = (e) => {
    e.preventDefault();
    const target = open
      ? { produceName: form.produceName.trim(), unit: form.unit.trim() || 'kg', allowPooling: form.allowPooling }
      : { farmId: Number(form.farmId), produceId: Number(form.produceId) };
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
            <button type="button" key={v} className={`chip ${mode === v ? 'active' : ''}`} onClick={() => switchMode(v)}>{l}</button>
          ))}
        </div>
        {!open ? (
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
        <DemandFields form={form} set={set} errs={errs} unit={open ? form.unit : produce?.unit} consumer={consumer} />
        <label className="checkbox">
          <input type="checkbox" checked={open && form.allowPooling} disabled={!open}
            onChange={(e) => setForm((f) => ({ ...f, allowPooling: e.target.checked }))} />
          <span>
            <span className="strong">Allow FarmPool — several farms may fulfil this together</span>
            <span className="small muted" style={{ display: 'block' }}>
              {open
                ? 'If no single farm can cover the full quantity, partner farms can combine their harvests to fill it.'
                : 'FarmPool is only available for open-market demand. Choose "Any farm (open market)" to enable it.'}
            </span>
          </span>
        </label>
        <Notice>
          {open
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
        {item.grade && <Badge tone="outline">{label(item.grade)}</Badge>}
      </div>
      <div className="small"><FarmLink id={item.farmId} name={item.farmName} /></div>
      <div className="price">{money(item.price)}<span className="small muted"> / {item.unit}</span></div>
      <div className="small">
        {upcoming ? 'Expected harvest' : 'Harvest'} <span className="strong">{date(item.harvestDate, { weekday: true })}</span>
        <span className="muted"> · {relativeDay(item.harvestDate)}</span>
      </div>
      <div className="small muted">
        {kg(item.availableQuantity, item.unit)} available
        {item.minOrderQuantity > 0 && <> · Min order {kg(item.minOrderQuantity, item.unit)}</>}
      </div>
      <div className="foot">{action}</div>
    </div>
  );
}

/** Single-item direct order (POST /orders). The order starts PENDING until the farm confirms it. */
export function BuyModal({ item, methods = CONSUMER_COLLECTION, onClose, onDone }) {
  const { user } = useAuth();
  const toast = useToast();
  const [quantity, setQuantity] = useState(() => String(defaultOrderQty(item)));
  const [collectionMethod, setCollectionMethod] = useState(methods[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const qty = Number(quantity) || 0;
  const moq = Number(item.minOrderQuantity) || 0;

  const submit = async (e) => {
    e.preventDefault();
    const msg = orderQtyError(item, qty);
    if (msg) return setError({ message: msg });
    setBusy(true);
    setError(null);
    try {
      const order = await api.post('/orders', { items: [{ harvestBatchId: item.id, quantity: qty }], collectionMethod });
      toast(<OrderPlacedToast order={order} role={user?.role} />);
      onDone?.();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Buy ${item.produceName}`} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" form="buy-form" disabled={busy}>{busy ? 'Placing order…' : `Place order · ${money(qty * item.price)}`}</button>
      </>
    }>
      <form id="buy-form" className="form" onSubmit={submit}>
        {error && <div className="form-error">{error.message}</div>}
        <div>
          <div className="strong">{item.produceName} · {item.farmName}</div>
          <div className="small muted">
            Harvest {date(item.harvestDate)} · {kg(item.availableQuantity, item.unit)} available · {money(item.price)}/{item.unit}
            {moq > 0 && <> · Min order {kg(moq, item.unit)}</>}
          </div>
        </div>
        <div className="form-grid">
          <Field label={`Quantity (${item.unit})`}>
            <input className="input" type="number" min={moq || 0.5} max={item.availableQuantity} step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </Field>
          <Field label="Collection">
            <select className="input" value={collectionMethod} onChange={(e) => setCollectionMethod(e.target.value)}>
              {methods.map((m) => <option key={m} value={m}>{label(m)}</option>)}
            </select>
          </Field>
        </div>
        <Notice>Your order goes to the farm and stays pending until the farm confirms it. The produce is held for you in the meantime.</Notice>
      </form>
    </Modal>
  );
}
