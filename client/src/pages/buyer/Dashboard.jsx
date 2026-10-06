import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, KpiCard, AsyncBoundary, EmptyState } from '../../components/ui.jsx';
import { StatusBadge } from '../../components/domain.jsx';
import { Icons } from '../../components/Icons.jsx';
import { kg, money, date, relativeDay } from '../../utils/format.js';
import { OPEN_DEMAND } from './demandShared.jsx';

const ACTIVE_ORDERS = ['PENDING', 'CONFIRMED', 'READY'];

export default function Dashboard() {
  const { user } = useAuth();
  const state = useApi(
    () => Promise.all([api.get('/demand'), api.get('/matches'), api.get('/orders')]).then(([demand, matches, orders]) => ({ demand, matches, orders })),
    []
  );

  return (
    <>
      <PageHeader
        title={`Welcome back${user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}`}
        description="Your demand, confirmed HarvestMatch results and orders across Tyllage partner farms."
        actions={
          <>
            <Link className="btn" to="/buyer/supply"><Icons.Supply width={16} /> Available supply</Link>
            <Link className="btn btn-primary" to="/buyer/demand?new=1"><Icons.Plus width={16} /> Register demand</Link>
          </>
        }
      />
      <AsyncBoundary state={state}>
        {({ demand, matches, orders }) => {
          const openDemand = demand.filter((d) => OPEN_DEMAND.includes(d.status));
          const activeOrders = orders.filter((o) => ACTIVE_ORDERS.includes(o.status));
          return (
            <div className="stack">
              <div className="grid grid-3">
                <KpiCard label="Open demand" value={openDemand.length} sub="Awaiting farm review" tone="primary" icon={<Icons.Demand width={14} />} />
                <KpiCard label="Approved matches" value={matches.length} sub="Confirmed by farms" tone="low" icon={<Icons.Match width={14} />} />
                <KpiCard label="Active orders" value={activeOrders.length} sub="Pending, confirmed or ready" tone="neutral" icon={<Icons.Orders width={14} />} />
              </div>
              <div className="grid grid-2">
                <Card title="Recent orders" actions={<Link className="btn btn-ghost btn-sm" to="/buyer/orders">View all</Link>} tight>
                  {orders.length === 0 ? (
                    <EmptyState title="No orders yet">Orders appear here once a farm approves your demand.</EmptyState>
                  ) : (
                    <div className="table-wrap">
                      <table className="table">
                        <tbody>
                          {orders.slice(0, 5).map((o) => (
                            <tr key={o.id}>
                              <td>
                                <div className="cell-title">#{o.id} · {o.farmName}</div>
                                <div className="cell-sub">{o.items.map((i) => i.produceName).join(', ') || '—'}</div>
                              </td>
                              <td className="num">{money(o.totalAmount)}</td>
                              <td><StatusBadge status={o.status} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
                <Card title="Open demand" actions={<Link className="btn btn-ghost btn-sm" to="/buyer/demand">Manage</Link>} tight>
                  {openDemand.length === 0 ? (
                    <EmptyState title="No open demand" action={<Link className="btn btn-sm" to="/buyer/supply">Browse supply</Link>}>
                      Tell farms what you need ahead of harvest.
                    </EmptyState>
                  ) : (
                    <div className="table-wrap">
                      <table className="table">
                        <tbody>
                          {openDemand.slice(0, 5).map((d) => (
                            <tr key={d.id}>
                              <td>
                                <div className="cell-title">{d.produceName}</div>
                                <div className="cell-sub">{d.farmName || 'Any farm'}</div>
                              </td>
                              <td className="num">{kg(d.remainingQuantity, d.unit)}</td>
                              <td>
                                <div>{date(d.requiredDate)}</div>
                                <div className="cell-sub">{relativeDay(d.requiredDate)}</div>
                              </td>
                              <td><StatusBadge status={d.status} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          );
        }}
      </AsyncBoundary>
    </>
  );
}
