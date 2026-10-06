import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Card, AsyncBoundary, EmptyState, FilterChips, Modal, Field, Badge } from '../../components/ui.jsx';
import { StatusBadge } from '../../components/domain.jsx';
import { kg, money, date, label } from '../../utils/format.js';

const GROUPS = {
  all: null,
  active: ['PENDING', 'CONFIRMED', 'READY'],
  completed: ['COMPLETED'],
  cancelled: ['CANCELLED'],
};
const CANCELLABLE = ['PENDING', 'CONFIRMED'];

function CancelModal({ order, onClose, onDone }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.patch(`/orders/${order.id}/status`, { status: 'CANCELLED', reason: reason.trim() || undefined });
      toast(`Order #${order.id} cancelled`);
      onDone();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Cancel order #${order.id}`} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Keep order</button>
        <button className="btn btn-danger" onClick={submit} disabled={busy}>{busy ? 'Cancelling…' : 'Cancel order'}</button>
      </>
    }>
      <div className="form">
        <p className="muted">The farm will be notified and the reserved produce released for other buyers.</p>
        <Field label="Reason (optional)" hint="Helps the farm plan future harvests">
          <textarea className="input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export default function MyOrders() {
  const { user } = useAuth();
  const isConsumer = user?.role === 'consumer';
  const state = useApi(() => api.get('/orders'), []);
  const [filter, setFilter] = useState('all');
  const [cancelling, setCancelling] = useState(null);

  return (
    <>
      <PageHeader
        title="My orders"
        description={isConsumer ? 'Rescue reservations and orders from local farms, with collection details.' : 'Orders created from approved HarvestMatch results, Demand Recovery offers and direct sales.'}
      />
      <AsyncBoundary state={state}>
        {(orders) => {
          const count = (k) => (GROUPS[k] ? orders.filter((o) => GROUPS[k].includes(o.status)).length : orders.length);
          const rows = GROUPS[filter] ? orders.filter((o) => GROUPS[filter].includes(o.status)) : orders;
          return (
            <div className="stack">
              <FilterChips
                options={Object.keys(GROUPS).map((k) => ({ value: k, label: `${k.charAt(0).toUpperCase()}${k.slice(1)} (${count(k)})` }))}
                value={filter}
                onChange={setFilter}
              />
              <Card tight>
                {rows.length === 0 ? (
                  <EmptyState
                    title={orders.length ? 'No orders in this view' : 'No orders yet'}
                    action={!orders.length && <Link className="btn btn-sm" to={isConsumer ? '/consumer/rescue' : '/buyer/supply'}>{isConsumer ? 'Browse Rescue produce' : 'Browse supply'}</Link>}
                  >
                    {orders.length ? 'Try another filter.' : 'Your orders and their collection details will appear here.'}
                  </EmptyState>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Order</th>
                          <th>Items</th>
                          <th className="num">Total</th>
                          <th>Status</th>
                          <th>Collection</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((o) => (
                          <tr key={o.id}>
                            <td>
                              <div className="cell-title">#{o.id} · {o.farmName}</div>
                              <div className="cell-sub">{label(o.source)} · placed {date(o.createdAt)}</div>
                            </td>
                            <td>
                              {o.items.map((i) => (
                                <div key={i.id} className="small">
                                  <span className="strong">{i.produceName}</span> {kg(i.quantity, i.unit)} @ {money(i.unitPrice)}
                                </div>
                              ))}
                            </td>
                            <td className="num strong">{money(o.totalAmount)}</td>
                            <td>
                              <StatusBadge status={o.status} />
                              {o.cancelledReason && <div className="cell-sub mt-8">{o.cancelledReason}</div>}
                            </td>
                            <td>
                              <div>{label(o.collectionMethod)}</div>
                              <div className="cell-sub">{o.scheduledDate ? date(o.scheduledDate, { weekday: true }) : 'Date to be confirmed'}</div>
                              {o.communityName && <Badge tone="primary">{o.communityName}</Badge>}
                            </td>
                            <td className="num">
                              {CANCELLABLE.includes(o.status) && (
                                <button className="btn btn-danger btn-sm" onClick={() => setCancelling(o)}>Cancel</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          );
        }}
      </AsyncBoundary>
      {cancelling && <CancelModal order={cancelling} onClose={() => setCancelling(null)} onDone={state.reload} />}
    </>
  );
}
