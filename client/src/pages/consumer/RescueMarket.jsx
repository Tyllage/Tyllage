import { useState } from 'react';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, AsyncBoundary, EmptyState, Card, Modal, Field, Badge, Notice, fieldErrors } from '../../components/ui.jsx';
import { Icons } from '../../components/Icons.jsx';
import { kg, money, dateTime, label } from '../../utils/format.js';

function ReserveModal({ listing, onClose, onDone }) {
  const toast = useToast();
  const [quantity, setQuantity] = useState(String(Math.min(1, listing.availableQuantity)));
  const [collectionMethod, setCollectionMethod] = useState('FARM_PICKUP');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const qty = Number(quantity) || 0;

  const submit = async (e) => {
    e.preventDefault();
    if (qty <= 0 || qty > listing.availableQuantity) return setError({ message: `Choose between 0.5 and ${kg(listing.availableQuantity, listing.unit)}.` });
    setBusy(true);
    setError(null);
    try {
      await api.post(`/rescue/${listing.id}/reserve`, { quantity: qty, collectionMethod });
      toast('Reserved — the farm will confirm your order');
      onDone();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Reserve ${listing.produceName}`} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" form="reserve-form" disabled={busy}>{busy ? 'Reserving…' : `Reserve for ${money(qty * listing.rescuePrice)}`}</button>
      </>
    }>
      <form id="reserve-form" className="form" onSubmit={submit}>
        {error && <div className="form-error">{error.message}</div>}
        <div className="small muted">{listing.farmName} · {money(listing.rescuePrice)}/{listing.unit} · collect before {dateTime(listing.collectionDeadline)}</div>
        <div className="form-grid">
          <Field label={`Quantity (${listing.unit})`} hint={`Up to ${kg(listing.availableQuantity, listing.unit)}`} error={fieldErrors(error).quantity}>
            <input className="input" type="number" min="0.5" step="0.5" max={listing.availableQuantity} value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </Field>
          <Field label="Collection" error={fieldErrors(error).collectionMethod}>
            <select className="input" value={collectionMethod} onChange={(e) => setCollectionMethod(e.target.value)}>
              <option value="FARM_PICKUP">{label('FARM_PICKUP')}</option>
              <option value="COMMUNITY_DROP">{label('COMMUNITY_DROP')}</option>
            </select>
          </Field>
        </div>
        {collectionMethod === 'COMMUNITY_DROP' && <Notice>After reserving, join a Community Drop from this farm on the Community Drops page.</Notice>}
        <p className="small muted">{listing.disclaimer}</p>
      </form>
    </Modal>
  );
}

export default function RescueMarket() {
  const state = useApi(() => api.get('/rescue/public'), []);
  const [selected, setSelected] = useState(null);

  return (
    <>
      <PageHeader
        title="Rescue market"
        description="Surplus, short-dated or cosmetically imperfect produce, checked by the farm and offered at a lower price. Reserve now and collect before the deadline."
      />
      <AsyncBoundary state={state}>
        {(listings) =>
          listings.length === 0 ? (
            <Card>
              <EmptyState title="No Rescue produce right now">Farms list Rescue produce when they have surplus — check back soon.</EmptyState>
            </Card>
          ) : (
            <div className="product-grid">
              {listings.map((r) => (
                <div key={r.id} className="product-card">
                  <div className="row-between">
                    <h3>{r.produceName}</h3>
                    <Badge tone="medium">{label(r.reason)}</Badge>
                  </div>
                  <div className="small muted">{r.farmName}</div>
                  <div>
                    <span className="small muted">Original: </span><span className="was" style={{ marginLeft: 0 }}>{money(r.originalPrice)}</span>
                    <div className="price">Rescue: {money(r.rescuePrice)}<span className="small muted"> / {r.unit}</span></div>
                  </div>
                  {r.reasonDetails && <div className="small">{r.reasonDetails}</div>}
                  <div className="small">Available: <span className="strong">{kg(r.availableQuantity, r.unit)}</span></div>
                  <div className="small row"><Icons.Clock width={14} /> Collect before {dateTime(r.collectionDeadline)}</div>
                  <p className="small muted">{r.disclaimer}</p>
                  <div className="foot">
                    <button className="btn btn-primary btn-sm" onClick={() => setSelected(r)}><Icons.Rescue width={14} /> Reserve</button>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </AsyncBoundary>
      {selected && <ReserveModal listing={selected} onClose={() => setSelected(null)} onDone={state.reload} />}
    </>
  );
}
