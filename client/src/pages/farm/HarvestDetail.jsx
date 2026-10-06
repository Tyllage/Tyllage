import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { AsyncBoundary, Card, Notice } from '../../components/ui.jsx';
import { CoverageBar, RiskBadge, StatusBadge, StockBar } from '../../components/domain.jsx';
import { Icons } from '../../components/Icons.jsx';
import HarvestFormModal from '../../components/farm/HarvestFormModal.jsx';
import MatchList from '../../components/farm/MatchList.jsx';
import RecoveryPanel from '../../components/farm/RecoveryPanel.jsx';
import { date, dateTime, kg, label, money, relativeDay } from '../../utils/format.js';

function Summary({ b }) {
  return (
    <Card>
      <div className="grid grid-2" style={{ alignItems: 'center' }}>
        <div>
          <div className="row" style={{ gap: 28 }}>
            <div><div className="small muted">{b.actualQuantity ? 'Actual harvest' : 'Expected harvest'}</div><div className="kpi-value">{kg(b.harvestQuantity, b.unit)}</div></div>
            <div><div className="small muted">Confirmed demand</div><div className="kpi-value">{kg(b.confirmedDemand, b.unit)}</div></div>
            <div><div className="small muted">Remaining</div><div className="kpi-value" style={{ color: b.unallocatedQuantity > 0 ? 'var(--high)' : 'var(--low)' }}>{kg(b.unallocatedQuantity, b.unit)}</div></div>
          </div>
          <div className="mt-16"><StockBar batch={b} /></div>
        </div>
        <div>
          <div className="stat-line"><span>Demand coverage</span><span style={{ width: 180 }}><CoverageBar value={b.demandCoverage} risk={b.riskLevel} /></span></div>
          <div className="stat-line"><span>Expected / actual</span><b>{kg(b.expectedQuantity, b.unit)} / {b.actualQuantity ? kg(b.actualQuantity, b.unit) : '—'}</b></div>
          <div className="stat-line"><span>Preferred / minimum price</span><b>{money(b.preferredPrice)} / {money(b.minPrice)}</b></div>
          <div className="stat-line"><span>Grade</span><b>{label(b.grade)}</b></div>
          {b.notes && <div className="stat-line"><span>Notes</span><span className="muted">{b.notes}</span></div>}
        </div>
      </div>
    </Card>
  );
}

export default function HarvestDetail() {
  const { id } = useParams();
  const location = useLocation();
  const { isFarmAdmin } = useAuth();
  const toast = useToast();
  const state = useApi(() => api.get(`/recovery/harvests/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [matching, setMatching] = useState(false);

  useEffect(() => {
    if (location.hash === '#recovery' && state.data) document.getElementById('recovery')?.scrollIntoView({ behavior: 'smooth' });
  }, [location.hash, state.data]);

  const runMatching = async () => {
    setMatching(true);
    try {
      await api.post(`/harvests/${id}/run-matching`);
      toast('HarvestMatch updated recommendations');
      await state.reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setMatching(false);
    }
  };

  const act = async (path, message) => {
    try {
      await api.post(path);
      toast(message);
      state.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <AsyncBoundary state={state} loadingLabel="Loading harvest batch…">
      {({ batch: b, matches, lastRun, recovery, recoveryRun }) => {
        const excluded = lastRun?.excluded || [];
        const closed = b.status === 'CLOSED';
        return (
          <>
            <div className="small muted"><Link to="/farm/harvests">Harvests</Link> / Batch #{b.id}</div>
            <div className="page-header mt-8">
              <div>
                <div className="row" style={{ gap: 10 }}>
                  <h1>{b.produceName}</h1>
                  <RiskBadge level={b.riskLevel} />
                  <StatusBadge status={b.status} />
                </div>
                <p>Harvest {date(b.harvestDate, { weekday: true })} · {relativeDay(b.harvestDate)} · {b.farmName}</p>
              </div>
              {!closed && (
                <div className="page-actions">
                  <button className="btn" onClick={() => setEditing(true)}>Edit batch</button>
                  {!b.markedAvailable && <button className="btn" onClick={() => act(`/harvests/${b.id}/mark-available`, 'Marked available')}>Mark available</button>}
                  {isFarmAdmin && (
                    <button className="btn btn-danger" onClick={() => window.confirm('Close this batch? It will be archived and no further matching can run.') && act(`/harvests/${b.id}/close`, 'Batch closed')}>
                      Close batch
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="stack">
              <Summary b={b} />

              {isFarmAdmin && !closed && (
                <Card
                  title="HarvestMatch"
                  description="Ranks existing demand with transparent weighted rules: produce 30% · date 20% · price 20% · quantity 10% · buyer reliability 10% · location 10%."
                  actions={
                    <button className="btn btn-primary" onClick={runMatching} disabled={matching || b.unallocatedQuantity <= 0}>
                      <Icons.Match />{matching ? 'Matching…' : lastRun ? 'Re-run HarvestMatch' : 'Run HarvestMatch'}
                    </button>
                  }
                >
                  {b.unallocatedQuantity <= 0 && <Notice tone="success">Fully allocated — nothing left to match.</Notice>}
                  {lastRun && <div className="small muted" style={{ marginBottom: 12 }}>Last {lastRun.runType === 'RECOVERY' ? 'recovery' : 'HarvestMatch'} run {dateTime(lastRun.createdAt)} against {kg(lastRun.remainingQuantity, b.unit)} unallocated.</div>}
                  <MatchList matches={matches} excluded={excluded} unit={b.unit} canDecide={isFarmAdmin} onChanged={state.reload} />
                </Card>
              )}
              {!isFarmAdmin && (
                <Notice tone="info">Farm admins run HarvestMatch and approve allocations. You can update quantities and fulfilment details.</Notice>
              )}

              {isFarmAdmin && !closed && (
                <div id="recovery">
                  <RecoveryPanel
                    batch={b}
                    recovery={recovery}
                    lastRunAt={recoveryRun?.createdAt}
                    onRecovered={() => state.reload()}
                    onRescueCreated={() => state.reload()}
                  />
                </div>
              )}
            </div>

            {editing && (
              <HarvestFormModal
                batch={b}
                onClose={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false);
                  state.reload();
                }}
              />
            )}
          </>
        );
      }}
    </AsyncBoundary>
  );
}
