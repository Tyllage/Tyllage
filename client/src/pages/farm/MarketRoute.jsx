import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useFarm } from '../../context/FarmContext.jsx';
import { AsyncBoundary, Card, EmptyState, Notice, PageHeader } from '../../components/ui.jsx';
import { CoverageBar, RiskBadge } from '../../components/domain.jsx';
import { Icons } from '../../components/Icons.jsx';
import { RoutePlan, FACTOR_LABELS } from '../../components/farm/MarketRouteCard.jsx';
import { date, kg, label, relativeDay } from '../../utils/format.js';

// The routes MarketRoute compares, with the default fulfilment terms used when a route has no live demand.
const ROUTE_PROFILES = [
  ['Restaurants & cafés', 'Restaurant, café', 'Buyer pickup', 'Strong demand and price; medium volume'],
  ['Hotels & caterers', 'Hotel, caterer', 'Farm delivery', 'Larger recurring orders; institutional terms'],
  ['Wholesale', 'Wholesaler', 'Central drop', 'High volume at a lower price'],
  ['Retail & wet markets', 'Retailer, wet market', 'Farm delivery', 'Shelf and commercial requirements'],
  ['Community & D2C', 'Community, consumer', 'Collection point', 'Premium and local-story demand; small orders'],
  ['Tyllage Rescue', 'Consumers (farm-approved listing)', 'Buyer pickup', 'Alternative route for surplus or short-dated produce'],
];

const FACTOR_HELP = {
  demandFit: 'Share of the unallocated quantity that eligible open demand in the route can absorb',
  price: 'Achievable price vs your preferred and minimum price',
  margin: 'Margin after production cost and estimated fulfilment cost (Margin Guard)',
  volume: 'Average order size — fewer, larger orders mean fewer fulfilment runs',
  fulfilment: 'Who carries logistics: buyer pickup > central drop > collection point > farm delivery',
  reliability: 'Completed vs cancelled orders for the route’s buyers (neutral without history)',
  urgency: 'Can the route sell before the shelf-life window closes?',
};

/** MarketRoute across all exposed batches (proposal v3 §8.2). Detailed comparison lives on each batch. */
export default function MarketRoute() {
  const { farmId } = useFarm();
  const state = useApi(() => api.get(`/farms/${farmId}/dashboard`), [farmId], { enabled: Boolean(farmId) });

  return (
    <>
      <PageHeader
        title="MarketRoute"
        description="Compare sales routes before matching individual buyers. MarketRoute does not assume the highest-volume buyer is the best outcome — it weighs price, margin after fulfilment, volume, logistics, reliability and urgency."
      />
      <AsyncBoundary state={state}>
        {({ upcomingHarvest, rules }) => {
          const exposed = upcomingHarvest.filter((b) => b.unallocatedQuantity > 0 && b.marketRoute);
          return (
            <div className="grid grid-main-side">
              <Card tight title="Batches with unallocated produce" description="Recommended route and route plan for each. Open a batch to compare every route and select one.">
                {exposed.length === 0 ? (
                  <EmptyState title="Nothing to route">Every open batch is fully allocated or listed.</EmptyState>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Produce</th><th>Harvest</th><th>Coverage</th><th className="num">Unallocated</th><th>Recommended route</th><th style={{ minWidth: 220 }}>Route plan</th><th /></tr></thead>
                      <tbody>
                        {exposed.map((b) => (
                          <tr key={b.id}>
                            <td><Link className="cell-title" to={`/farm/harvests/${b.id}#routes`}>{b.produceName}</Link><div className="cell-sub">{label(b.grade)} grade</div></td>
                            <td className="nowrap">{date(b.harvestDate)}<div className="cell-sub">{relativeDay(b.harvestDate)}</div></td>
                            <td><CoverageBar value={b.demandCoverage} risk={b.riskLevel} /><div className="mt-8"><RiskBadge level={b.riskLevel} /></div></td>
                            <td className="num strong">{kg(b.unallocatedQuantity, b.unit)}</td>
                            <td>
                              {b.marketRoute.recommendedRoute
                                ? <><div className="strong">{b.marketRoute.label}</div><div className="cell-sub">score {b.marketRoute.score}</div></>
                                : <span className="muted small">No viable route — record a final disposition</span>}
                            </td>
                            <td><RoutePlan plan={b.marketRoute.plan} total={b.unallocatedQuantity} unit={b.unit} /></td>
                            <td><Link className="btn btn-sm" to={`/farm/harvests/${b.id}#routes`}><Icons.Route />Compare</Link></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <div className="stack">
                <Card title="Commercial Route Score" description="Transparent weighted rules — not machine learning.">
                  {Object.entries(FACTOR_LABELS).map(([k, name]) => (
                    <div key={k} style={{ padding: '8px 0', borderBottom: '1px dashed var(--border)' }}>
                      <div className="row-between"><span className="strong small">{name}</span><span className="badge badge-primary">{rules.routeWeights[k]}%</span></div>
                      <div className="small muted">{FACTOR_HELP[k]}</div>
                    </div>
                  ))}
                </Card>
                <Notice>Recommendations only. Selecting a route runs HarvestMatch within it; nothing is allocated until you approve.</Notice>
              </div>

              <Card tight title="Routes compared" description="Tyllage does not replace wholesalers, retailers or logistics partners — they are routes and fulfilment options to compare.">
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Route</th><th>Buyer types</th><th>Default fulfilment</th><th>Typical profile</th></tr></thead>
                    <tbody>
                      {ROUTE_PROFILES.map(([route, buyers, terms, profile]) => (
                        <tr key={route}><td className="cell-title">{route}</td><td>{buyers}</td><td>{terms}</td><td className="small muted">{profile}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          );
        }}
      </AsyncBoundary>
    </>
  );
}
