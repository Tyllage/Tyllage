import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useFarm } from '../../context/FarmContext.jsx';
import { AsyncBoundary, Card, KpiCard, PageHeader } from '../../components/ui.jsx';
import { MetricValue } from '../../components/domain.jsx';
import { date, kg, money } from '../../utils/format.js';

const METRICS = [
  ['sellThrough', 'Harvest sell-through', 'kg'],
  ['demandCoverage', 'Demand coverage (open batches)', 'kg'],
  ['rescueRate', 'Rescue rate', 'kg'],
  ['matchConversion', 'Match conversion', 'matches'],
  ['repeatBuyerRate', 'Repeat buyer rate', 'buyers'],
  ['channelConcentration', 'Channel concentration', '$'],
];
const CHANNELS = [['BUSINESS', 'Business buyers'], ['COMMUNITY', 'Community'], ['CONSUMER', 'Consumers']];

function MetricCard({ title, metric, unit }) {
  const fmt = (n) => (unit === '$' ? money(n) : unit === 'kg' ? kg(n) : n);
  return (
    <div className="card kpi metric-card">
      <div className="kpi-label">{title}</div>
      <div className="metric-value mt-8"><MetricValue metric={metric} /></div>
      {metric?.sufficient && <div className="kpi-sub">{fmt(metric.numerator)} of {fmt(metric.denominator)}{unit !== '$' && unit !== 'kg' ? ` ${unit}` : ''}</div>}
      {metric?.largestBuyer && <div className="kpi-sub">Largest: {metric.largestBuyer}</div>}
      <div className="formula">{metric?.formula}</div>
    </div>
  );
}

function Bars({ rows, value, labelKey, format }) {
  const max = Math.max(...rows.map(value), 0);
  return (
    <div className="bar-chart">
      {rows.map((r) => (
        <div className="bar-row" key={r[labelKey]}>
          <span className="small">{r[labelKey]}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${max ? (value(r) / max) * 100 : 0}%` }} /></div>
          <span className="small num strong">{format(r)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Analytics() {
  const { farmId } = useFarm();
  const state = useApi(() => api.get('/analytics', { farmId }), [farmId], { enabled: Boolean(farmId) });

  return (
    <>
      <PageHeader title="Analytics" description="Every figure is computed from orders, allocations, matches and Rescue records in the database. Where data is thin, we say so instead of drawing a trend." />
      <AsyncBoundary state={state}>
        {({ totals, metrics, topProduce, revenueByChannel, weeklyRevenue }) => (
          <div className="stack">
            <div className="kpi-grid">
              <KpiCard label="Revenue" value={money(totals.revenue)} sub="Confirmed, ready & completed" tone="primary" />
              <KpiCard label="Orders" value={totals.orders} sub={`${kg(totals.soldQuantity)} sold`} tone="neutral" />
              <KpiCard label="At-risk now" value={kg(totals.atRiskQuantity)} tone={totals.atRiskQuantity > 0 ? 'high' : 'low'} />
              <KpiCard label="Rescue listed" value={kg(totals.rescueListedQuantity)} sub={`${kg(totals.rescueSoldQuantity)} reserved`} tone="neutral" />
              <KpiCard label="Matches generated" value={totals.matchesGenerated} sub={`${totals.matchesApproved} approved · ${totals.matchesRejected} rejected`} tone="neutral" />
              <KpiCard label="Rescue active" value={kg(totals.rescueActiveQuantity)} sub="Still available to buyers" tone="neutral" />
            </div>

            <div className="grid grid-3">
              {METRICS.map(([key, title, unit]) => <MetricCard key={key} title={title} metric={metrics[key]} unit={unit} />)}
            </div>

            <div className="grid grid-3">
              <Card title="Top produce by revenue">
                {topProduce.length ? (
                  <Bars rows={topProduce} labelKey="name" value={(r) => r.revenue} format={(r) => money(r.revenue)} />
                ) : <span className="insufficient">Not enough data yet</span>}
              </Card>
              <Card title="Revenue by channel">
                {totals.revenue > 0 ? (
                  <Bars rows={CHANNELS.map(([k, l]) => ({ name: l, revenue: revenueByChannel[k] }))} labelKey="name" value={(r) => r.revenue} format={(r) => money(r.revenue)} />
                ) : <span className="insufficient">Not enough data yet</span>}
              </Card>
              <Card title="Weekly revenue (8 weeks)">
                {weeklyRevenue.sufficient ? (
                  <div className="column-chart" role="img" aria-label="Weekly revenue">
                    {weeklyRevenue.points.map((p) => {
                      const max = Math.max(...weeklyRevenue.points.map((x) => x.revenue));
                      return (
                        <div className="column" key={p.week} title={`${money(p.revenue)} · ${p.orders} orders`}>
                          <small className="strong">{money(p.revenue).replace('.00', '')}</small>
                          <div className="column-bar" style={{ height: `${(p.revenue / max) * 110}px` }} />
                          <small>{date(p.week)}</small>
                        </div>
                      );
                    })}
                  </div>
                ) : <span className="insufficient">Not enough data yet — at least two weeks of sales are needed to show a trend.</span>}
              </Card>
            </div>
          </div>
        )}
      </AsyncBoundary>
    </>
  );
}
