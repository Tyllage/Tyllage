import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Card, AsyncBoundary, EmptyState } from '../../components/ui.jsx';
import { Icons } from '../../components/Icons.jsx';
import { kg, money, date, dateTime, label } from '../../utils/format.js';
import { ProduceCard } from '../buyer/demandShared.jsx';

const hhmm = (t) => (t ? t.slice(0, 5) : '');
const more = (to) => <Link className="btn btn-ghost btn-sm" to={to}>View all <Icons.Arrow width={14} /></Link>;

export default function Home() {
  const { user } = useAuth();
  const state = useApi(
    () => Promise.all([api.get('/rescue/public'), api.get('/community-drops/upcoming'), api.get('/marketplace/supply')])
      .then(([rescue, drops, supply]) => ({ rescue, drops, available: supply.availableNow })),
    []
  );

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <h1>Fresh from local farms{user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}</h1>
          <p>
            Buy produce harvested days ago, not weeks. Rescue lets you reserve surplus or cosmetically imperfect produce at a lower
            price, and Community Drops let neighbours collect together from one convenient point.
          </p>
        </div>
        <div className="row">
          <Link className="btn btn-primary" to="/consumer/rescue"><Icons.Rescue width={16} /> Rescue produce</Link>
          <Link className="btn" to="/consumer/available">Available now</Link>
        </div>
      </div>

      <AsyncBoundary state={state}>
        {({ rescue, drops, available }) => (
          <>
            <Card title="Rescue produce" description="Good food at a lower price, collected before the deadline." actions={more('/consumer/rescue')}>
              {rescue.length === 0 ? <EmptyState title="No Rescue listings right now">Farms post Rescue produce when they have surplus.</EmptyState> : (
                <div className="product-grid">
                  {rescue.slice(0, 3).map((r) => (
                    <div key={r.id} className="product-card">
                      <h3>{r.produceName}</h3>
                      <div className="small muted">{r.farmName} · {label(r.reason)}</div>
                      <div className="price">{money(r.rescuePrice)}<span className="was">{money(r.originalPrice)}</span></div>
                      <div className="small muted">{kg(r.availableQuantity, r.unit)} left · collect before {dateTime(r.collectionDeadline)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Upcoming Community Drops" actions={more('/consumer/drops')} tight>
              {drops.length === 0 ? <EmptyState title="No drops scheduled">Check back soon for collection points near you.</EmptyState> : (
                <ul className="action-list">
                  {drops.slice(0, 3).map((d) => (
                    <li key={d.id} className="action-item">
                      <span className="action-icon" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}><Icons.Pin /></span>
                      <div className="action-text">
                        <div className="strong">{d.communityName}</div>
                        <div className="small muted">{d.collectionPoint} · {d.farmName}</div>
                      </div>
                      <div className="small num">{date(d.dropDate, { weekday: true })}<div className="muted">{hhmm(d.windowStart)}–{hhmm(d.windowEnd)}</div></div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Available now" description="Harvested within the next few days." actions={more('/consumer/available')}>
              {available.length === 0 ? <EmptyState title="Nothing available right now" /> : (
                <div className="product-grid">
                  {available.slice(0, 4).map((b) => (
                    <ProduceCard key={b.id} item={b} action={<Link className="btn btn-sm" to="/consumer/available">Details</Link>} />
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}
