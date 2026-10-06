import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { PageHeader, AsyncBoundary, EmptyState, Card } from '../../components/ui.jsx';
import { Icons } from '../../components/Icons.jsx';
import { ProduceCard, RequestSupplyModal } from '../buyer/demandShared.jsx';

export default function AvailableNow() {
  const state = useApi(() => api.get('/marketplace/supply'), []);
  const [selected, setSelected] = useState(null);

  return (
    <>
      <PageHeader
        title="Available now"
        description="Produce harvested or harvesting within the next few days. Register your interest and the farm will confirm availability."
        actions={<Link className="btn" to="/consumer/growing"><Icons.Sprout width={16} /> Growing soon</Link>}
      />
      <AsyncBoundary state={state}>
        {({ availableNow }) =>
          availableNow.length === 0 ? (
            <Card>
              <EmptyState title="Nothing available right now" action={<Link className="btn btn-sm" to="/consumer/rescue">See Rescue produce</Link>}>
                New harvests are added regularly — check what is growing soon.
              </EmptyState>
            </Card>
          ) : (
            <div className="product-grid">
              {availableNow.map((b) => (
                <ProduceCard
                  key={b.id}
                  item={b}
                  action={<button className="btn btn-primary btn-sm" onClick={() => setSelected(b)}><Icons.Heart width={14} /> I&apos;m interested</button>}
                />
              ))}
            </div>
          )
        }
      </AsyncBoundary>
      {selected && <RequestSupplyModal consumer item={selected} onClose={() => setSelected(null)} onDone={state.reload} />}
    </>
  );
}
