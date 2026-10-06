import { useState } from 'react';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useFarm } from '../../context/FarmContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Field, Modal, fieldErrors } from '../ui.jsx';
import { label, todayISO } from '../../utils/format.js';

const GRADES = ['PREMIUM', 'EVERYDAY', 'RESCUE_ELIGIBLE'];

/** Create (no `batch`) or edit (with `batch`) a harvest batch. */
export default function HarvestFormModal({ batch, onClose, onSaved }) {
  const { farmId } = useFarm();
  const { isFarmAdmin } = useAuth();
  const toast = useToast();
  const produce = useApi(() => api.get('/produce', { farmId, active: true }), [farmId], { enabled: !batch });
  const [form, setForm] = useState({
    produceId: batch?.produceId ?? '',
    expectedQuantity: batch?.expectedQuantity ?? '',
    actualQuantity: batch?.actualQuantity ?? '',
    harvestDate: batch?.harvestDate ?? todayISO(),
    grade: batch?.grade ?? 'EVERYDAY',
    preferredPrice: batch?.preferredPrice ?? '',
    minPrice: batch?.minPrice ?? '',
    notes: batch?.notes ?? '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const errs = fieldErrors(error);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const canEditPrice = isFarmAdmin;

  const pickProduce = (e) => {
    const id = Number(e.target.value);
    const p = produce.data?.find((x) => x.id === id);
    setForm((f) => ({ ...f, produceId: id, preferredPrice: f.preferredPrice || p?.defaultPrice || '' }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      expectedQuantity: Number(form.expectedQuantity),
      actualQuantity: form.actualQuantity === '' ? null : Number(form.actualQuantity),
      harvestDate: form.harvestDate,
      grade: form.grade,
      notes: form.notes || null,
    };
    if (!batch || canEditPrice) {
      body.preferredPrice = Number(form.preferredPrice);
      body.minPrice = Number(form.minPrice);
    }
    try {
      const saved = batch
        ? await api.patch(`/harvests/${batch.id}`, body)
        : await api.post('/harvests', { ...body, farmId, produceId: Number(form.produceId) });
      toast(batch ? 'Harvest batch updated' : 'Harvest batch created');
      onSaved(saved);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={batch ? `Edit ${batch.produceName} batch` : 'New harvest batch'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="harvest-form" disabled={busy}>{busy ? 'Saving…' : 'Save batch'}</button>
        </>
      }
    >
      <form id="harvest-form" className="form" onSubmit={submit}>
        {error && <div className="form-error">{error.message}</div>}
        <div className="form-grid">
          {!batch && (
            <Field label="Produce" full error={errs.produceId}>
              <select className="input" value={form.produceId} onChange={pickProduce} required>
                <option value="" disabled>Select produce…</option>
                {produce.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Expected quantity (kg)" error={errs.expectedQuantity}>
            <input className="input" type="number" min="0.1" step="0.1" value={form.expectedQuantity} onChange={set('expectedQuantity')} required />
          </Field>
          <Field label="Actual quantity (kg)" hint="Record once harvested" error={errs.actualQuantity}>
            <input className="input" type="number" min="0.1" step="0.1" value={form.actualQuantity} onChange={set('actualQuantity')} />
          </Field>
          <Field label="Harvest date" error={errs.harvestDate}>
            <input className="input" type="date" value={form.harvestDate} onChange={set('harvestDate')} required />
          </Field>
          <Field label="Grade">
            <select className="input" value={form.grade} onChange={set('grade')}>
              {GRADES.map((g) => <option key={g} value={g}>{label(g)}</option>)}
            </select>
          </Field>
          <Field label="Preferred price ($/kg)" error={errs.preferredPrice} hint={!canEditPrice && batch ? 'Farm admins set prices' : undefined}>
            <input className="input" type="number" min="0.01" step="0.01" value={form.preferredPrice} onChange={set('preferredPrice')} required disabled={batch && !canEditPrice} />
          </Field>
          <Field label="Minimum acceptable price ($/kg)" error={errs.minPrice} hint="Never shown to buyers">
            <input className="input" type="number" min="0.01" step="0.01" value={form.minPrice} onChange={set('minPrice')} required disabled={batch && !canEditPrice} />
          </Field>
          <Field label="Notes" full>
            <textarea className="input" value={form.notes || ''} onChange={set('notes')} rows={2} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
