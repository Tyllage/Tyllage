import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useFarm } from '../../context/FarmContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { AsyncBoundary, Card, EmptyState, KpiCard, PageHeader } from '../../components/ui.jsx';
import { CoverageBar, RiskBadge, StatusBadge } from '../../components/domain.jsx';
import { Icons } from '../../components/Icons.jsx';
import { date, kg, label, pct, relativeDay } from '../../utils/format.js';
import AiPanel from '../../components/AiPanel.jsx';

const ACTION_STYLE = {
  RUN_HARVESTMATCH: { icon: Icons.Match, bg: 'var(--high-soft)', color: 'var(--high)' },
  REVIEW_MATCHES: { icon: Icons.Check, bg: 'var(--medium-soft)', color: 'var(--medium)' },
  RECOVER_DEMAND: { icon: Icons.Recovery, bg: 'var(--medium-soft)', color: 'var(--medium)' },
  CONFIRM_ORDERS: { icon: Icons.Orders, bg: 'var(--info-soft)', color: 'var(--info)' },
  RESCUE_EXPIRING: { icon: Icons.Clock, bg: 'var(--high-soft)', color: 'var(--high)' },
  APPROVE_CAMPAIGNS: { icon: Icons.Campaign, bg: 'var(--primary-soft)', color: 'var(--primary)' },
};
const ACTION_LINK = {
  CONFIRM_ORDERS: '/farm/orders',
  RESCUE_EXPIRING: '/farm/rescue',
  APPROVE_CAMPAIGNS: '/farm/campaigns',
};

function BatchAction({ batch, isFarmAdmin, onRun, running }) {
  if (batch.status === 'CLOSED') return null;
  if (isFarmAdmin && batch.pendingMatches > 0) {
    return <Link className="btn btn-sm" to={`/farm/harvests/${batch.id}`}>Review {batch.pendingMatches} match{batch.pendingMatches > 1 ? 'es' : ''}</Link>;
  }
  if (isFarmAdmin && batch.unallocatedQuantity > 0 && batch.riskLevel !== 'LOW') {
    return (
      <button className="btn btn-sm btn-primary" onClick={() => onRun(batch)} disabled={running === batch.id}>
        <Icons.Match />{running === batch.id ? 'Matching…' : 'Run HarvestMatch'}
      </button>
    );
  }
  if (isFarmAdmin && batch.unallocatedQuantity > 0 && batch.daysToHarvest <= 3) {
    return <Link className="btn btn-sm" to={`/farm/harvests/${batch.id}#recovery`}>Recover demand</Link>;
  }
  return <Link className="btn btn-sm btn-ghost" to={`/farm/harvests/${batch.id}`}>View</Link>;
}

/** Weekly demand briefing from the AI assistant (simulated without an OpenAI key). */
function InsightsCard({ farmId }) {
  const toast = useToast();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setResult(await api.post('/ai/insights', { farmId }));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="AI demand insights" description="A short briefing written from this dashboard's data."
      actions={<button className="btn btn-sm" onClick={run} disabled={busy}><Icons.Sparkle />{busy ? 'Writing…' : result ? 'Refresh' : 'Generate'}</button>}>
      {result ? <AiPanel result={result} title="Demand briefing" /> : <p className="small muted">Summarises coverage gaps, potential demand and routing urgency. The AI only writes text — it never changes stock or prices.</p>}
    </Card>
  );
}

export default function Overview() {
  const { farmId, farm } = useFarm();
  const { isFarmAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const state = useApi(() => api.get(`/farms/${farmId}/dashboard`), [farmId], { enabled: Boolean(farmId) });
  const [running, setRunning] = useState(null);

  const runMatch = async (batch) => {
    setRunning(batch.id);
    try {
      await api.post(`/harvests/${batch.id}/run-matching`);
      navigate(`/farm/harvests/${batch.id}`);
    } catch (err) {
      toast(err.message, 'error');
      setRunning(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Overview"
        description="What are we harvesting, how much already has demand, what may remain unsold — and what needs action today."
        actions={<Link className="btn" to="/farm/harvests"><Icons.Plus />New harvest</Link>}
      />
      {!farmId && <EmptyState title="No farm assigned">Ask a platform admin to link your account to a farm.</EmptyState>}
      {farmId && (
        <AsyncBoundary state={state}>
          {({ kpis, upcomingHarvest, actions, rules }) => (
            <>
              <div className="kpi-grid">
                <KpiCard label="Expected Harvest" value={kg(kpis.expectedHarvest)} sub={`${upcomingHarvest.length} open batches`} tone="primary" />
                <KpiCard label="Confirmed Demand" value={kg(kpis.confirmedDemand)} sub={`${pct(kpis.demandCoverage)} coverage · ${kg(kpis.potentialDemand)} potential`} tone={kpis.riskLevel ? kpis.riskLevel.toLowerCase() : 'neutral'} />
                <KpiCard label="Unallocated Produce" value={kg(kpis.unallocatedProduce)} sub="No buyer or Rescue yet" tone="neutral" />
                <KpiCard label="At-Risk Produce" value={kg(kpis.atRiskProduce)} sub="Needs matching or recovery" tone={kpis.atRiskProduce > 0 ? 'high' : 'low'} />
                <KpiCard label="Active Orders" value={kpis.activeOrders} sub="Pending, confirmed or ready" tone="neutral" />
                <KpiCard label="Rescue Quantity" value={kg(kpis.rescueQuantity)} sub="Committed to Rescue" tone="neutral" />
              </div>

              <div className="grid grid-main-side">
                <Card
                  title="Demand Radar — Upcoming Harvest"
                  description={`Potential = open demand not yet confirmed. Risk is rule-based on Demand Coverage: ≥${rules.riskThresholds.LOW}% LOW · ${rules.riskThresholds.MEDIUM}–${rules.riskThresholds.LOW - 1}% MEDIUM · <${rules.riskThresholds.MEDIUM}% HIGH`}
                  tight
                >
                  {upcomingHarvest.length === 0 ? (
                    <EmptyState title="No upcoming harvests" action={<Link className="btn btn-primary" to="/farm/harvests">Add a harvest batch</Link>} />
                  ) : (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Produce</th><th>Harvest Date</th><th className="num">Expected</th><th className="num">Confirmed Demand</th>
                            <th className="num">Potential Demand</th><th>Demand Coverage</th><th className="num">Unallocated</th><th>Risk</th><th>Status</th><th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {upcomingHarvest.map((b) => (
                            <tr key={b.id}>
                              <td><Link className="cell-title" to={`/farm/harvests/${b.id}`}>{b.produceName}</Link><div className="cell-sub">{b.grade.toLowerCase()} grade</div></td>
                              <td className="nowrap">{date(b.harvestDate)}<div className="cell-sub">{relativeDay(b.harvestDate)}</div></td>
                              <td className="num">{kg(b.harvestQuantity, b.unit)}</td>
                              <td className="num">{kg(b.confirmedDemand, b.unit)}</td>
                              <td className="num" title={`${b.potentialDemand.requests} open request(s) fit this batch`}>{kg(b.potentialDemand.quantity, b.unit)}</td>
                              <td><CoverageBar value={b.demandCoverage} risk={b.riskLevel} /></td>
                              <td className="num strong">{kg(b.unallocatedQuantity, b.unit)}</td>
                              <td><RiskBadge level={b.riskLevel} /></td>
                              <td><StatusBadge status={b.status} />{b.routing?.active && <div className="cell-sub">{label(b.routing.stage)} route</div>}</td>
                              <td><BatchAction batch={b} isFarmAdmin={isFarmAdmin} onRun={runMatch} running={running} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>

                <div className="stack">
                <InsightsCard farmId={farmId} />
                <Card title="Requires action" tight>
                  {actions.length === 0 ? (
                    <EmptyState title="All clear">No harvests currently need attention.</EmptyState>
                  ) : (
                    <ul className="action-list">
                      {actions.map((a, i) => {
                        const s = ACTION_STYLE[a.type] || ACTION_STYLE.RECOVER_DEMAND;
                        const to = a.harvestBatchId ? `/farm/harvests/${a.harvestBatchId}` : ACTION_LINK[a.type];
                        return (
                          <li key={i} className="action-item">
                            <div className="action-icon" style={{ background: s.bg, color: s.color }}><s.icon /></div>
                            <div className="action-text">{a.message}</div>
                            {to && <Link className="btn btn-sm btn-ghost" to={to} aria-label="Open"><Icons.Arrow /></Link>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
                </div>
              </div>
              {farm?.isDemo && <p className="small muted mt-16">All figures are calculated live from PostgreSQL records. Demo records are fictional.</p>}
            </>
          )}
        </AsyncBoundary>
      )}
    </>
  );
}
