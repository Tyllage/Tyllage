import { Card, Notice } from '../ui.jsx';
import { money, pct } from '../../utils/format.js';

const TONE = { OK: 'ok', BELOW_MINIMUM: 'warn', LOSS: 'bad', UNKNOWN: '' };

export function MarginChip({ margin, prefix = 'Margin' }) {
  if (!margin) return null;
  if (!margin.known) return <span className="mini-chip" title={margin.message}>{prefix}: unknown</span>;
  return (
    <span className={`mini-chip ${TONE[margin.status]}`} title={margin.message}>
      {prefix} {pct(margin.pct)} · {money(margin.perUnit)}/kg
    </span>
  );
}

/** Margin Guard: is this batch commercially sensible at the prices being accepted? (farm-private) */
export default function MarginGuardCard({ batch }) {
  const g = batch.marginGuard;
  return (
    <Card title="Margin Guard" description="Farm-private. Compares prices with your production cost and minimum margin — buyers never see this.">
      {!g?.known ? (
        <Notice tone="info">{g?.message || 'Record a production cost to enable Margin Guard.'}</Notice>
      ) : (
        <>
          <div className="stat-line"><span>Production cost</span><b>{money(g.costPerUnit)}/{batch.unit}</b></div>
          <div className="stat-line"><span>Minimum viable price ({pct(g.minMarginPct)} margin)</span><b>{money(g.minViablePrice)}/{batch.unit}</b></div>
          <div className="stat-line"><span>At preferred price {money(batch.preferredPrice)}</span><MarginChip margin={g.atPreferredPrice} prefix="" /></div>
          <div className="stat-line"><span>At minimum price {money(batch.minPrice)}</span><MarginChip margin={g.atMinimumPrice} prefix="" /></div>
          <div className="stat-line">
            <span>Committed sales so far</span>
            <b>{money(g.committedRevenue)} revenue · {money(g.committedMargin)} margin{g.committedMarginPct !== null ? ` (${pct(g.committedMarginPct)})` : ''}</b>
          </div>
          {g.warnings.map((w) => <Notice key={w} tone="warning">{w}</Notice>)}
        </>
      )}
    </Card>
  );
}
