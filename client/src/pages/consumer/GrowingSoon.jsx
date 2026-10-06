import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { PageHeader, AsyncBoundary, EmptyState, Card, Notice } from '../../components/ui.jsx';
import { Icons } from '../../components/Icons.jsx';
import { ProduceCard, RequestSupplyModal } from '../buyer/demandShared.jsx';

export default function GrowingSoon() {
  const state = useApi(() => api.get('/marketplace/supply'), []);
  const [selected, setSelected] = useState(null);

  return (
    <>
      <PageHeader
        title="Growing soon"
        description="Upcoming harvests from local farms. Registering interest early helps farms plan how much to harvest."
        actions={<Link className="btn" to="/consumer/available">Available now</Link>}
      />
      <div className="stack">
        <Notice>Harvest dates are the farm&apos;s current estimate and may shift with weather and crop conditions.</Notice>
        <AsyncBoundary state={state}>
          {({ growingSoon }) =>
            growingSoon.length === 0 ? (
              <Card>
                <EmptyState title="No upcoming harvests listed">Farms add upcoming harvests as crops are planted.</EmptyState>
              </Card>
            ) : (
              <div className="product-grid">
                {growingSoon.map((b) => (
                  <ProduceCard
                    key={b.id}
                    item={b}
                    upcoming
                    action={<button className="btn btn-sm" onClick={() => setSelected(b)}><Icons.Sprout width={14} /> Register interest</button>}
                  />
                ))}
              </div>
            )
          }
        </AsyncBoundary>
      </div>
      {selected && <RequestSupplyModal consumer item={selected} onClose={() => setSelected(null)} onDone={state.reload} />}
    </>
  );
}
