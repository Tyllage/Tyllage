import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Card, Notice } from '../ui.jsx';
import { Icons } from '../Icons.jsx';
import { kg, dateTime, routeLabel, ROUTES } from '../../utils/format.js';
import RescueFormModal from './RescueFormModal.jsx';
import { RoutePlan } from './MarketRouteCard.jsx';

// Recovery stages (proposal v3 §8.5).
const LADDER = [
  ['PRIMARY', 'Primary route', 'e.g. restaurant / institutional buyer'],
  ['ALTERNATIVE', 'Alternative route', 'wholesale / community / D2C'],
  ['RESCUE', 'Rescue route', 'farm-approved surplus or short-dated listing'],
  ['FINAL_DISPOSITION', 'Final disposition', 'donation or other farm-approved action'],
];

function Ladder({ stage }) {
  const idx = LADDER.findIndex(([k]) => k === stage);
  return (
    <div className="ladder" aria-label="Recovery stages">
      {LADDER.map(([k, title, sub], i) => (
        <div key={k} className={`ladder-step ${idx >= 0 && i < idx ? 'done' : ''} ${i === idx ? 'current' : ''}`}>
          <b>{i + 1}. {title}</b>{sub}
        </div>
      ))}
    </div>
  );
}

/**
 * Demand Recovery for one batch: re-runs route comparison and buyer matching against the remaining
 * eligible channels, shows the current recovery stage, recoverable quantity by route, and
 * approval-required suggestions (e.g. move to Rescue).
 */
export default function RecoveryPanel({ batch, recovery, lastRunAt, onRecovered, onRescueCreated }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [rescueQty, setRescueQty] = useState(null);
  const [createdListing, setCreatedListing] = useState(null);
  const [genBusy, setGenBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/recovery/harvests/${batch.id}/start`, { trigger: 'MANUAL' });
      toast('Demand Recovery complete — review the suggestions');
      onRecovered(res);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const generateCampaign = async () => {
    setGenBusy(true);
    try {
      const c = await api.post('/campaigns/generate', { farmId: batch.farmId, campaignType: 'RESCUE_ALERT', rescueListingId: createdListing.id });
      toast('Rescue campaign drafted — review before approving');
      navigate(`/farm/campaigns?open=${c.id}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setGenBusy(false);
    }
  };

  const canRecover = batch.status !== 'CLOSED' && batch.unallocatedQuantity > 0;

  return (
    <Card
      title="Demand Recovery"
      description="Re-compare routes and re-match remaining produce against eligible demand. Cancelled buyers, rejected matches and fulfilled demand are excluded."
      actions={
        <button className="btn btn-primary" onClick={run} disabled={busy || !canRecover}>
          <Icons.Recovery />{busy ? 'Recovering…' : 'Recover demand'}
        </button>
      }
    >
      {!recovery && (
        <p className="muted">
          {canRecover ? `${kg(batch.unallocatedQuantity, batch.unit)} of ${batch.produceName} is unallocated. Run recovery to see where it could go.` : 'Nothing left to recover — all produce is allocated or listed.'}
        </p>
      )}
      {recovery?.stage && (
        <div style={{ marginBottom: 14 }}>
          <Ladder stage={recovery.stage} />
          {recovery.primaryRoute && <div className="small muted mt-8">Primary route: <b>{routeLabel(recovery.primaryRoute)}</b></div>}
        </div>
      )}
      {recovery && (
        <div className="grid grid-2">
          <div>
            <div className="stat-line"><span>Remaining {batch.produceName}</span><b>{kg(recovery.remainingAtStart, batch.unit)}</b></div>
            <div className="small muted mt-12 strong">Potential recovery by route (strong matches ≥ {recovery.strongMatchThreshold}%)</div>
            {ROUTES.filter(([key]) => key in (recovery.potentialByRoute || {})).map(([key, text]) => (
              <div className="stat-line" key={key}><span>{text}</span><b>{kg(recovery.potentialByRoute[key] || 0, batch.unit)}</b></div>
            ))}
            {(recovery.potentialFromExistingCustomers > 0 || recovery.potentialFromSubscribers > 0) && (
              <div className="small muted" style={{ padding: '6px 0' }}>
                Of which existing customers {kg(recovery.potentialFromExistingCustomers || 0, batch.unit)} · recurring subscribers {kg(recovery.potentialFromSubscribers || 0, batch.unit)}
              </div>
            )}
            {recovery.potentialWeakTotal > 0 && (
              <div className="stat-line"><span className="muted">Weak matches (below threshold)</span><b className="muted">{kg(recovery.potentialWeakTotal, batch.unit)}</b></div>
            )}
            <div className="stat-line"><span className="strong">Remaining after recovery</span><b>{kg(recovery.remainingAfterStrong, batch.unit)}</b></div>
            {recovery.plan?.length > 0 && (
              <div className="mt-12">
                <div className="small muted strong" style={{ marginBottom: 6 }}>MarketRoute plan over the remaining eligible routes</div>
                <RoutePlan plan={recovery.plan} total={recovery.plan.reduce((t, p) => t + p.quantity, 0)} unit={batch.unit} />
              </div>
            )}
            {lastRunAt && <div className="small muted mt-8">Last run {dateTime(lastRunAt)}</div>}
          </div>
          <div className="stack">
            <div className="small muted strong">Suggested — requires your approval</div>
            {(recovery.suggestions || []).map((s) => (
              <div key={s.type} className="notice notice-info" style={{ alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <div className="strong">{s.message}</div>
                </div>
                {s.type === 'DEMAND_POOL' && <Link className="btn btn-sm btn-primary" to="/farm/demandpool"><Icons.Users />Open DemandPool</Link>}
                {s.type === 'RECORD_DISPOSITION' && <a className="btn btn-sm btn-primary" href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Icons.Heart />Record donation above</a>}
                {s.type === 'MOVE_TO_RESCUE' && batch.unallocatedQuantity > 0 && (
                  <button className="btn btn-sm btn-primary" onClick={() => setRescueQty(Math.min(s.quantity, batch.unallocatedQuantity))}>
                    <Icons.Rescue />Move {kg(Math.min(s.quantity, batch.unallocatedQuantity), batch.unit)} to Rescue
                  </button>
                )}
              </div>
            ))}
            {createdListing && (
              <Notice tone="success">
                <div style={{ flex: 1 }}>
                  <div className="strong">Rescue listing created for {kg(createdListing.quantity, batch.unit)}.</div>
                  <div className="small">Draft a Rescue alert with Tyllage Connect — you'll review it before anything is sent.</div>
                  <button className="btn btn-sm btn-primary mt-8" onClick={generateCampaign} disabled={genBusy}>
                    <Icons.Sparkle />{genBusy ? 'Drafting…' : 'Generate Rescue campaign'}
                  </button>
                </div>
              </Notice>
            )}
          </div>
        </div>
      )}
      {rescueQty !== null && (
        <RescueFormModal
          batches={[batch]}
          defaultBatchId={batch.id}
          defaultQuantity={rescueQty}
          onClose={() => setRescueQty(null)}
          onCreated={(listing) => {
            setRescueQty(null);
            setCreatedListing(listing);
            onRescueCreated?.(listing);
          }}
        />
      )}
    </Card>
  );
}
