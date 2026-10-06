import { useState } from 'react';
import { api } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Field, Modal, Notice, fieldErrors } from '../ui.jsx';
import { kg, label, localDateTimeInput, money } from '../../utils/format.js';

const REASONS = ['SURPLUS', 'SHORT_DATED', 'COSMETIC_IMPERFECTION', 'IRREGULAR_SIZE', 'OTHER'];

/**
 * Creates a Rescue listing for a batch. The farm must explicitly confirm suitability for sale;
 * Tyllage never makes that judgement.
 */
export default function RescueFormModal({ batches, defaultBatchId, defaultQuantity, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(() => {
    const b = batches.find((x) => x.id === defaultBatchId) || batches[0];
    return {
      harvestBatchId: b?.id ?? '',
      quantity: defaultQuantity ?? b?.unallocatedQuantity ?? '',
      rescuePrice: b ? (Math.round(b.preferredPrice * 0.65 * 2) / 2).toFixed(2) : '',
      reason: 'SURPLUS',
      reasonDetails: '',
      collectionDeadline: localDateTimeInput(2, 18),
      suitabilityConfirmed: false,
    };
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const errs = fieldErrors(error);
  const batch = batches.find((b) => b.id === Number(form.harvestBatchId));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const [suggestion, setSuggestion] = useState(null);

  // Pricing support: transparent rule-based suggestion within farm and platform constraints.
  const suggest = async () => {
    try {
      const s = await api.get('/rescue/price-suggestion', { harvestBatchId: form.harvestBatchId });
      setSuggestion(s);
      setForm((f) => ({ ...f, rescuePrice: s.suggestedPrice.toFixed(2) }));
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const listing = await api.post('/rescue', {
        harvestBatchId: Number(form.harvestBatchId),
        quantity: Number(form.quantity),
        rescuePrice: Number(form.rescuePrice),
        reason: form.reason,
        reasonDetails: form.reasonDetails || null,
        collectionDeadline: new Date(form.collectionDeadline).toISOString(),
        suitabilityConfirmed: form.suitabilityConfirmed,
      });
      toast(`Rescue listing created: ${kg(listing.quantity)} ${listing.produceName}`);
      onCreated(listing);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Create Rescue listing"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="rescue-form" disabled={busy || !form.suitabilityConfirmed}>
            {busy ? 'Creating…' : 'Create listing'}
          </button>
        </>
      }
    >
      <form id="rescue-form" className="form" onSubmit={submit}>
        {error && <div className="form-error">{error.message}</div>}
        <Field label="Harvest batch">
          <select className="input" value={form.harvestBatchId} onChange={set('harvestBatchId')} required>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.produceName} · {b.harvestDate} · {kg(b.unallocatedQuantity)} unallocated
              </option>
            ))}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Quantity (kg)" error={errs.quantity} hint={batch ? `Up to ${kg(batch.unallocatedQuantity)}` : undefined}>
            <input className="input" type="number" min="0.1" step="0.1" max={batch?.unallocatedQuantity} value={form.quantity} onChange={set('quantity')} required />
          </Field>
          <Field label="Rescue price ($/kg)" error={errs.rescuePrice} hint={batch ? `Original ${money(batch.preferredPrice)}/kg` : undefined}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="input" type="number" min="0.01" step="0.01" max={batch?.preferredPrice} value={form.rescuePrice} onChange={set('rescuePrice')} required />
              <button type="button" className="btn btn-sm" onClick={suggest} title="Rule-based pricing support">Suggest</button>
            </div>
          </Field>
          {suggestion && (
            <div className="full notice notice-info" style={{ gridColumn: '1 / -1', flexDirection: 'column', gap: 4 }}>
              <div className="strong">Suggested {money(suggestion.suggestedPrice)}/kg (rule-based, floor {money(suggestion.floorPrice)})</div>
              {suggestion.rationale.map((r) => <div key={r} className="small">• {r}</div>)}
            </div>
          )}
          <Field label="Reason">
            <select className="input" value={form.reason} onChange={set('reason')}>
              {REASONS.map((r) => <option key={r} value={r}>{label(r)}</option>)}
            </select>
          </Field>
          <Field label="Collect before" error={errs.collectionDeadline}>
            <input className="input" type="datetime-local" value={form.collectionDeadline} onChange={set('collectionDeadline')} required />
          </Field>
          <Field label="Details for buyers (optional)" full>
            <input className="input" value={form.reasonDetails} onChange={set('reasonDetails')} placeholder="e.g. Slightly smaller leaves, same flavour" />
          </Field>
        </div>
        <Notice tone="warning">
          <div>
            Tyllage does not inspect produce. Only list produce your farm has assessed as suitable for sale.
            <label className="checkbox mt-8">
              <input type="checkbox" checked={form.suitabilityConfirmed} onChange={set('suitabilityConfirmed')} />
              <span className="strong">I confirm the farm has assessed this produce as suitable for sale.</span>
            </label>
          </div>
        </Notice>
      </form>
    </Modal>
  );
}
