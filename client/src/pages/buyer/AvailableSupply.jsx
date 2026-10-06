import { useState } from 'react';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { PageHeader, Card, AsyncBoundary, EmptyState, Tabs, Notice } from '../../components/ui.jsx';
import { kg, money, date, relativeDay, label } from '../../utils/format.js';
import { RequestSupplyModal } from './demandShared.jsx';

export default function AvailableSupply() {
  const state = useApi(() => api.get('/marketplace/supply'), []);
  const [tab, setTab] = useState('availableNow');
  const [requesting, setRequesting] = useState(null);

  return (
    <>
      <PageHeader
        title="Available supply"
        description="Live harvest supply from Tyllage partner farms. Request supply and the farm reviews it through HarvestMatch before confirming an order."
      />
      <AsyncBoundary state={state}>
        {(data) => {
          const rows = data[tab];
          return (
            <>
              <Tabs
                tabs={[
                  { value: 'availableNow', label: 'Available now', count: data.availableNow.length },
                  { value: 'growingSoon', label: 'Growing soon', count: data.growingSoon.length },
                ]}
                value={tab}
                onChange={setTab}
              />
              <Card tight>
                {rows.length === 0 ? (
                  <EmptyState title={tab === 'availableNow' ? 'Nothing available right now' : 'No upcoming harvests listed'}>
                    Check back soon — farms publish new harvests regularly.
                  </EmptyState>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Produce</th>
                          <th>Farm</th>
                          <th>Harvest date</th>
                          <th className="num">Available</th>
                          <th className="num">Price / unit</th>
                          <th>Grade</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((b) => (
                          <tr key={b.id}>
                            <td>
                              <div className="cell-title">{b.produceName}</div>
                              {b.category && <div className="cell-sub">{label(b.category)}</div>}
                            </td>
                            <td>{b.farmName}</td>
                            <td>
                              <div>{date(b.harvestDate, { weekday: true })}</div>
                              <div className="cell-sub">{relativeDay(b.harvestDate)}</div>
                            </td>
                            <td className="num">{kg(b.availableQuantity, b.unit)}</td>
                            <td className="num">{money(b.price)}</td>
                            <td>{b.grade || '—'}</td>
                            <td className="num">
                              <button className="btn btn-primary btn-sm" onClick={() => setRequesting(b)}>Request supply</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
              <div className="mt-16">
                <Notice>Prices shown are the farm&apos;s listed price. The final unit price is confirmed when the farm approves your request.</Notice>
              </div>
            </>
          );
        }}
      </AsyncBoundary>
      {requesting && <RequestSupplyModal item={requesting} onClose={() => setRequesting(null)} onDone={state.reload} />}
    </>
  );
}
