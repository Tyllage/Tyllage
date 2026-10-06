import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useFarm } from '../../context/FarmContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { AsyncBoundary, Badge, Card, EmptyState, Field, Modal, Notice, PageHeader } from '../../components/ui.jsx';
import { StatusBadge } from '../../components/domain.jsx';
import { Icons } from '../../components/Icons.jsx';
import { date, kg, label, money } from '../../utils/format.js';

function ContributeModal({ farmId, request, onClose, onDone }) {
  const toast = useToast();
  const first = request.eligibleBatches[0];
  const [batchId, setBatchId] = useState(first?.id || '');
  const batch = request.eligibleBatches.find((b) => b.id === Number(batchId));
  const max = batch ? Math.min(batch.availableQuantity, request.remainingQuantity) : 0;
  const [quantity, setQuantity] = useState(max);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post(`/farmpool/${request.demandRequestId}/contribute`, { farmId, harvestBatchId: Number(batchId), quantity: Number(quantity) });
      toast(`Committed ${kg(quantity, request.unit)} — order #${res.orderId} created for your farm`);
      onDone();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Contribute to FarmPool — ${request.produceName}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="pool-form" disabled={busy || !batch}>Commit quantity</button></>}>
      <form id="pool-form" className="form" onSubmit={submit}>
        <Notice tone="info">Your contribution becomes your own confirmed order with {request.buyerName}. Your farm fulfils its portion; other farms fulfil theirs. Partner farms only see quantities, never your prices or customers.</Notice>
        <Field label="From harvest batch">
          <select className="input" value={batchId} onChange={(e) => { setBatchId(e.target.value); setQuantity(''); }}>
            {request.eligibleBatches.map((b) => (
              <option key={b.id} value={b.id}>{b.produceName} · {b.harvestDate} · {kg(b.availableQuantity)} available · {money(b.unitPrice)}/kg</option>
            ))}
          </select>
        </Field>
        <Field label={`Quantity (${request.unit})`} hint={`Up to ${kg(max, request.unit)} (your stock and the request's remaining need)`}>
          <input className="input" type="number" min="0.1" step="0.1" max={max} value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
        </Field>
        {batch && <div className="small muted">Price: {money(batch.unitPrice)}/{request.unit} (buyer maximum vs your preferred and minimum price) · Revenue {money(Number(quantity || 0) * batch.unitPrice)}</div>}
      </form>
    </Modal>
  );
}

export default function FarmPool() {
  const { farmId } = useFarm();
  const state = useApi(() => api.get('/farmpool', { farmId }), [farmId], { enabled: Boolean(farmId) });
  const [active, setActive] = useState(null);

  return (
    <>
      <PageHeader
        title="FarmPool"
        description="Cross-farm supply aggregation: large requests no single farm can fill are fulfilled by several farms together — Many Farms → One Large Buyer."
      />
      <AsyncBoundary state={state}>
        {(rows) =>
          rows.length === 0 ? (
            <Card><EmptyState title="No FarmPool requests">Buyers can open a request to several farms by ticking "Allow FarmPool" when registering open-market demand.</EmptyState></Card>
          ) : (
            <div className="stack">
              {rows.map((p) => {
                const mine = p.myContributions.reduce((s, c) => s + c.quantity, 0);
                const others = p.otherContributions.reduce((s, c) => s + c.quantity, 0);
                const w = (n) => `${(n / p.targetQuantity) * 100}%`;
                return (
                  <Card key={p.demandRequestId}
                    title={`${p.produceName} — ${kg(p.targetQuantity, p.unit)} for ${p.buyerName}`}
                    description={`${label(p.buyerType)} · needed ${date(p.requiredDate, { weekday: true })}${p.maxPrice ? ` · up to ${money(p.maxPrice)}/${p.unit}` : ''}`}
                    actions={
                      <>
                        <StatusBadge status={p.status} />
                        <Badge tone="info">{p.contributingFarms} farm{p.contributingFarms === 1 ? '' : 's'}</Badge>
                        {p.remainingQuantity > 0 && (
                          <button className="btn btn-primary btn-sm" disabled={!p.eligibleBatches.length} onClick={() => setActive(p)}
                            title={!p.eligibleBatches.length ? 'None of your open batches fit this request' : undefined}>
                            <Icons.Plus />Contribute
                          </button>
                        )}
                      </>
                    }
                  >
                    <div className="progress" role="img" aria-label={`${kg(p.committedQuantity)} of ${kg(p.targetQuantity)} committed`}>
                      <span style={{ width: w(mine), background: 'var(--primary)' }} />
                      <span style={{ width: w(others), background: 'var(--accent)' }} />
                    </div>
                    <div className="legend">
                      <span><i style={{ background: 'var(--primary)' }} />Your farm {kg(mine, p.unit)}</span>
                      {p.otherContributions.map((c) => <span key={c.label}><i style={{ background: 'var(--accent)' }} />{c.label} {kg(c.quantity, p.unit)}</span>)}
                      <span><i style={{ background: 'var(--neutral-soft)' }} />Still needed {kg(p.remainingQuantity, p.unit)}</span>
                    </div>
                    {p.myContributions.length > 0 && (
                      <div className="small mt-12">
                        Your fulfilment responsibility:{' '}
                        {p.myContributions.map((c) => (
                          <span key={c.orderId} className="mini-chip" style={{ marginRight: 6 }}>
                            Order #{c.orderId} · {kg(c.quantity, p.unit)} @ {money(c.unitPrice)} · {label(c.status)}
                          </span>
                        ))}
                        <Link className="small" to="/farm/orders">View orders →</Link>
                      </div>
                    )}
                    {p.remainingQuantity > 0 && !p.eligibleBatches.length && (
                      <div className="small muted mt-8">None of your open batches fit this request's produce, timing and price.</div>
                    )}
                  </Card>
                );
              })}
            </div>
          )
        }
      </AsyncBoundary>
      {active && <ContributeModal farmId={farmId} request={active} onClose={() => setActive(null)} onDone={() => { setActive(null); state.reload(); }} />}
    </>
  );
}
