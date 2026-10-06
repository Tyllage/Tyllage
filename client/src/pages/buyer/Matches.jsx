import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { PageHeader, AsyncBoundary, EmptyState, Notice, Card } from '../../components/ui.jsx';
import { StatusBadge, ScoreRing } from '../../components/domain.jsx';
import { kg, money, date, dateTime } from '../../utils/format.js';

export default function Matches() {
  const state = useApi(() => api.get('/matches'), []);

  return (
    <>
      <PageHeader
        title="Approved matches"
        description="HarvestMatch results confirmed by farms for your demand. Each approved match becomes an order."
      />
      <div className="stack">
        <Notice>
          Farms run HarvestMatch against their upcoming harvests and approve the quantity and price they can supply.
          You see the confirmed result here — no action is needed unless you want to cancel the resulting order.
        </Notice>
        <AsyncBoundary state={state}>
          {(rows) =>
            rows.length === 0 ? (
              <Card>
                <EmptyState title="No approved matches yet" action={<Link className="btn btn-sm" to="/buyer/demand">View my demand</Link>}>
                  When a farm approves your demand, the match and its reasons appear here.
                </EmptyState>
              </Card>
            ) : (
              <div className="grid grid-2">
                {rows.map((m) => (
                  <div key={m.id} className="match-card approved">
                    <div className="match-top">
                      <div>
                        <div className="strong">{m.produceName}</div>
                        <div className="small muted">{m.farmName} · approved {dateTime(m.decidedAt)}</div>
                      </div>
                      {m.matchScore != null && <ScoreRing score={Math.round(m.matchScore)} />}
                    </div>
                    <div className="mt-12">
                      <div className="stat-line"><span>Approved quantity</span><b>{kg(m.approvedQuantity, m.unit)} of {kg(m.demandQuantity, m.unit)}</b></div>
                      <div className="stat-line"><span>Unit price</span><b>{money(m.unitPrice)}</b></div>
                      <div className="stat-line"><span>Required / harvest</span><b>{date(m.requiredDate)} / {date(m.harvestDate)}</b></div>
                    </div>
                    {m.reasons?.length > 0 && (
                      <ul className="reason-list">
                        {m.reasons.map((r) => <li key={r}>{r}</li>)}
                      </ul>
                    )}
                    <div className="match-actions">
                      {m.orderStatus ? <StatusBadge status={m.orderStatus} /> : <span className="small muted">Order pending</span>}
                      {m.orderId && <Link className="btn btn-sm" to="/buyer/orders">Order #{m.orderId}</Link>}
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </AsyncBoundary>
      </div>
    </>
  );
}
