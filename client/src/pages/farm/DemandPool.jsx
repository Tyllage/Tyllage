import { useState } from 'react';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useFarm } from '../../context/FarmContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { AsyncBoundary, Badge, Card, EmptyState, PageHeader } from '../../components/ui.jsx';
import { StatusBadge } from '../../components/domain.jsx';
import { Icons } from '../../components/Icons.jsx';
import { date, dateTime, kg, label, money } from '../../utils/format.js';

function Suggestion({ s, farmId, drops, onCreated }) {
  const toast = useToast();
  const [selected, setSelected] = useState(() => Object.fromEntries(s.members.map((m) => [m.demandRequestId, true])));
  const [dropId, setDropId] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = s.members.filter((m) => selected[m.demandRequestId]);
  const total = chosen.reduce((sum, m) => sum + m.quantity, 0);
  const viable = total >= s.viableMinimum && chosen.length >= 2;
  const fits = total <= s.availableQuantity;

  const create = async () => {
    setBusy(true);
    try {
      await api.post('/demandpool', {
        farmId, harvestBatchId: s.harvestBatchId, demandRequestIds: chosen.map((m) => m.demandRequestId), communityDropId: dropId ? Number(dropId) : null,
      });
      toast(`DemandPool created: ${chosen.length} orders, ${kg(total, s.unit)} ${s.produceName}`);
      onCreated();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={`${s.produceName} · harvest ${date(s.harvestDate)}`}
      description={`${s.members.length} small requests, each below the ${kg(s.viableMinimum, s.unit)} viable order size. ${kg(s.availableQuantity, s.unit)} unallocated on this batch.`}
      actions={<Badge tone={viable ? 'low' : 'medium'}>{viable ? 'Viable together' : `Needs ${kg(Math.max(0, s.viableMinimum - total), s.unit)} more`}</Badge>}
    >
      <table className="table">
        <thead><tr><th /><th>Buyer</th><th>Type</th><th>Region</th><th className="num">Quantity</th><th>Needed</th><th className="num">Price</th></tr></thead>
        <tbody>
          {s.members.map((m) => (
            <tr key={m.demandRequestId}>
              <td><input type="checkbox" checked={!!selected[m.demandRequestId]} onChange={(e) => setSelected((x) => ({ ...x, [m.demandRequestId]: e.target.checked }))} aria-label={`Include ${m.buyerName}`} /></td>
              <td className="cell-title">{m.buyerName}</td>
              <td>{label(m.buyerType)}</td>
              <td>{label(m.region)}</td>
              <td className="num">{kg(m.quantity, s.unit)}</td>
              <td className="nowrap">{date(m.requiredDate, { weekday: true })}</td>
              <td className="num">{money(m.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-between mt-16">
        <div className="small">
          Pooled total <b>{kg(total, s.unit)}</b> · revenue <b>{money(chosen.reduce((sum, m) => sum + m.quantity * m.unitPrice, 0))}</b>
          {!fits && <span className="badge badge-high" style={{ marginLeft: 8 }}>Exceeds available stock</span>}
        </div>
        <div className="row">
          <select className="input" style={{ width: 260 }} value={dropId} onChange={(e) => setDropId(e.target.value)} aria-label="Fulfil via Community Drop">
            <option value="">Farm pickup (no Community Drop)</option>
            {drops.map((d) => <option key={d.id} value={d.id}>Community Drop: {d.communityName} · {d.dropDate}</option>)}
          </select>
          <button className="btn btn-primary" onClick={create} disabled={busy || !viable || !fits}><Icons.Check />Create pooled order</button>
        </div>
      </div>
    </Card>
  );
}

export default function DemandPool() {
  const { farmId } = useFarm();
  const suggestions = useApi(() => api.get('/demandpool/suggestions', { farmId }), [farmId], { enabled: Boolean(farmId) });
  const pools = useApi(() => api.get('/demandpool', { farmId }), [farmId], { enabled: Boolean(farmId) });
  const drops = useApi(() => api.get('/community-drops', { farmId }), [farmId], { enabled: Boolean(farmId) });
  const scheduled = (drops.data || []).filter((d) => d.status === 'SCHEDULED');
  const reload = () => { suggestions.reload(); pools.reload(); };

  return (
    <>
      <PageHeader
        title="DemandPool"
        description="Buyer aggregation: small requests that are each below your minimum order are combined into one commercially viable farm order — Many Buyers → One Viable Farm Order."
      />
      <div className="stack">
        <AsyncBoundary state={suggestions}>
          {(rows) => rows.length === 0
            ? <Card><EmptyState title="No pools to suggest">When several small requests fit the same batch, they appear here.</EmptyState></Card>
            : rows.map((s) => <Suggestion key={s.harvestBatchId} s={s} farmId={farmId} drops={scheduled} onCreated={reload} />)}
        </AsyncBoundary>

        <Card tight title="Pooled orders">
          <AsyncBoundary state={pools}>
            {(rows) => rows.length === 0 ? <EmptyState title="No pooled orders yet" /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Created</th><th>Produce</th><th className="num">Total</th><th>Fulfilment</th><th>Buyers (orders)</th><th>Status</th></tr></thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id}>
                        <td className="nowrap">{dateTime(p.createdAt)}</td>
                        <td>{p.produceName}<div className="cell-sub">Harvest {date(p.harvestDate)}</div></td>
                        <td className="num">{kg(p.totalQuantity, p.unit)}</td>
                        <td>{p.communityName ? `Community Drop: ${p.communityName}` : 'Farm pickup'}</td>
                        <td className="small">{p.members.map((m) => `${m.buyerName} ${kg(m.quantity)} (#${m.orderId})`).join(', ')}</td>
                        <td><StatusBadge status={p.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AsyncBoundary>
        </Card>
      </div>
    </>
  );
}
