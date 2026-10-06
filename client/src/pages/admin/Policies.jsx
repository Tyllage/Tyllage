import { useState } from 'react';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useFarm } from '../../context/FarmContext.jsx';
import { PageHeader, Card, AsyncBoundary, Badge, Field, Notice } from '../../components/ui.jsx';
import { dateTime, label } from '../../utils/format.js';

// Display metadata for each policy key (labels and help text; values always come from the API).
const SCALARS = {
  atRiskWindowDays: { label: 'At-risk window', unit: 'days', help: 'A HIGH-risk harvest this many days (or fewer) from its harvest date is flagged At risk.' },
  freshnessWindowDays: { label: 'Freshness window', unit: 'days', help: 'Days after harvest that produce still counts as fresh supply when matching demand.' },
  strongMatchThreshold: { label: 'Strong match threshold', unit: 'score', help: 'Matches scoring at or above this count as strong demand during Demand Recovery.' },
  neutralReliabilityScore: { label: 'Neutral reliability score', unit: 'score', help: 'Reliability score used for buyers without enough order history yet.' },
  rescueMaxDeadlineDays: { label: 'Longest collection deadline', unit: 'days', help: 'Rescue listings must be collected within this many days of listing.' },
  rescueMaxDiscountPct: { label: 'Maximum Rescue discount', unit: '%', help: 'Rescue price cannot be discounted more than this from the original price.' },
  defaultShelfLifeDays: { label: 'Default shelf life', unit: 'days', help: 'Used for routing when a produce item has no shelf life of its own.' },
  demandPoolMinViableKg: { label: 'Minimum viable pool', unit: 'kg', step: '0.5', help: 'Smallest combined quantity worth fulfilling as one pooled farm order.' },
};
const OBJECTS = {
  riskThresholds: {
    label: 'Risk thresholds',
    help: 'Coverage at or above the low-risk threshold is LOW risk; between the two is MEDIUM; below the medium threshold is HIGH.',
    fields: [['LOW', 'Low risk from (%)'], ['MEDIUM', 'Medium risk from (%)']],
  },
  matchWeights: {
    label: 'Factor weights',
    help: 'How much each factor contributes to a 0–100 HarvestMatch score. Weights must add up to exactly 100.',
    fields: [['produce', 'Produce fit'], ['date', 'Harvest date'], ['price', 'Price'], ['quantity', 'Quantity'], ['reliability', 'Buyer reliability'], ['location', 'Location']],
    total: 100,
  },
  routeWeights: {
    label: 'Commercial Route Score weights',
    help: 'How much each factor contributes to a 0–100 MarketRoute score. Weights must add up to exactly 100.',
    fields: [['demandFit', 'Demand fit'], ['price', 'Price'], ['margin', 'Margin after fulfilment'], ['volume', 'Order volume'], ['fulfilment', 'Logistics'], ['reliability', 'Buyer reliability'], ['urgency', 'Urgency vs shelf life']],
    total: 100,
  },
};
const BOOLEANS = {
  networkFeaturesEnabled: {
    label: 'Enable FarmPool & DemandPool preview',
    help: 'Post-MVP network features (proposal Phase 3). Off for the ComCrop MVP; turn on to demonstrate cross-farm fulfilment and buyer aggregation.',
  },
};
const ROUTING = { label: 'Shelf-life stages', help: 'Each stage applies until the given % of shelf life has elapsed since harvest. Limits must increase; the last stage is open-ended.' };

const GROUPS = [
  {
    title: 'Demand Coverage & risk',
    description: 'Demand Coverage = confirmed demand ÷ expected harvest × 100. These rules set the risk badge on every harvest.',
    keys: ['riskThresholds', 'atRiskWindowDays'],
  },
  {
    title: 'HarvestMatch weights',
    description: 'HarvestMatch scores each demand request against a harvest using these weighted, explainable factors.',
    keys: ['matchWeights', 'freshnessWindowDays', 'strongMatchThreshold', 'neutralReliabilityScore'],
  },
  {
    title: 'MarketRoute weights',
    description: 'MarketRoute compares commercial routes for each batch with these transparent, weighted factors before HarvestMatch ranks buyers.',
    keys: ['routeWeights'],
  },
  {
    title: 'Rescue guard-rails',
    description: 'Limits farms must respect when listing surplus or imperfect produce in the Rescue market.',
    keys: ['rescueMaxDeadlineDays', 'rescueMaxDiscountPct'],
  },
  {
    title: 'Shelf-life window',
    description: 'How urgency rises as produce ages, from premium sale to final disposition. Feeds MarketRoute urgency and the Rescue price rule.',
    keys: ['defaultShelfLifeDays', 'routingStages'],
  },
  {
    title: 'Phase 3 network preview',
    description: 'FarmPool (several farms fill one large request) and DemandPool (small requests combined into one viable order) are Post-MVP.',
    keys: ['networkFeaturesEnabled', 'demandPoolMinViableKg'],
  },
];

const toNum = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
const sumOf = (obj) => Object.values(obj).reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);
const toDraft = (value) => JSON.parse(JSON.stringify(value), (_, v) => (typeof v === 'number' ? String(v) : v));

function fromDraft(key, d) {
  if (typeof d === 'boolean') return d;
  if (key === 'routingStages') return d.map((s, i) => ({ key: s.key, label: s.label.trim(), upToPct: i === d.length - 1 ? null : toNum(s.upToPct) }));
  if (typeof d === 'object') return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, toNum(v)]));
  return toNum(d);
}

/** Client-side checks mirroring the server rules; the server validates again on save. */
function checkPolicy(key, v) {
  if (typeof v === 'boolean') return null;
  const nums = key === 'routingStages' ? v.slice(0, -1).map((s) => s.upToPct) : typeof v === 'object' ? Object.values(v) : [v];
  if (nums.some((n) => !Number.isFinite(n))) return 'Enter a number in every field.';
  if (nums.some((n) => n < 0)) return 'Values cannot be negative.';
  if (key === 'riskThresholds' && !(v.LOW > v.MEDIUM)) return 'The low-risk threshold must be above the medium-risk threshold.';
  if (key === 'matchWeights' || key === 'routeWeights') {
    const sum = nums.reduce((s, n) => s + n, 0);
    if (sum !== 100) return `Weights add up to ${sum} — they must total 100.`;
  }
  if (key === 'routingStages') {
    if (v.some((s) => s.label.length < 2)) return 'Every stage needs a label.';
    if (nums.some((n, i) => i > 0 && n <= nums[i - 1])) return 'Stage limits must increase from one stage to the next.';
  }
  return null;
}

function PolicyMeta({ policy, busy, onReset }) {
  return (
    <div className="row">
      {policy.isDefault ? <Badge tone="outline">Default</Badge> : <Badge tone="primary">Custom</Badge>}
      {!policy.isDefault && (
        <>
          <span className="small muted">Updated {dateTime(policy.updatedAt)}{policy.updatedByName ? ` by ${policy.updatedByName}` : ''}</span>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onReset}>Reset to default</button>
        </>
      )}
    </div>
  );
}

function PolicyGroup({ group, policies, onSaved }) {
  const toast = useToast();
  const { refreshFeatures } = useFarm();
  const initial = (list) => Object.fromEntries(group.keys.map((k) => [k, toDraft(list[k].value)]));
  const [drafts, setDrafts] = useState(() => initial(policies));
  const [busy, setBusy] = useState(false);

  const values = Object.fromEntries(group.keys.map((k) => [k, fromDraft(k, drafts[k])]));
  const errors = Object.fromEntries(group.keys.map((k) => [k, checkPolicy(k, values[k])]));
  const dirty = group.keys.filter((k) => JSON.stringify(values[k]) !== JSON.stringify(policies[k].value));
  const blocked = dirty.some((k) => errors[k]);

  const patch = async (body, success) => {
    setBusy(true);
    try {
      const list = await api.patch('/admin/policies', body);
      const byKey = Object.fromEntries(list.map((p) => [p.key, p]));
      onSaved(list);
      setDrafts(initial(byKey));
      refreshFeatures();
      toast(success);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = () => patch(Object.fromEntries(dirty.map((k) => [k, values[k]])), `${group.title} saved`);
  const reset = (k) => patch({ [k]: null }, 'Reset to the default value');
  const setScalar = (k) => (e) => setDrafts((d) => ({ ...d, [k]: e.target.value }));
  const setField = (k, f) => (e) => setDrafts((d) => ({ ...d, [k]: { ...d[k], [f]: e.target.value } }));
  const setStage = (i, f) => (e) => setDrafts((d) => ({ ...d, routingStages: d.routingStages.map((s, j) => (j === i ? { ...s, [f]: e.target.value } : s)) }));

  const renderPolicy = (k) => {
    const policy = policies[k];
    const err = errors[k];
    const meta = SCALARS[k] || OBJECTS[k] || BOOLEANS[k] || ROUTING;
    return (
      <div key={k} className="stack" style={{ gap: 10 }}>
        <div className="row-between">
          <div>
            <div className="strong">{meta.label}</div>
            <div className="small muted">{meta.help}</div>
          </div>
          <PolicyMeta policy={policy} busy={busy} onReset={() => reset(k)} />
        </div>
        {BOOLEANS[k] && (
          <label className="checkbox">
            <input type="checkbox" checked={drafts[k]} onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.checked }))} />
            {drafts[k] ? 'Enabled' : 'Disabled'} <span className="small muted">(default {policy.defaultValue ? 'enabled' : 'disabled'})</span>
          </label>
        )}
        {SCALARS[k] && (
          <div className="form-grid">
            <Field label={`Value (${meta.unit})`} error={err} hint={`Default ${policy.defaultValue} ${meta.unit}`}>
              <input className="input" type="number" min="0" step={meta.step || '1'} value={drafts[k]} onChange={setScalar(k)} />
            </Field>
          </div>
        )}
        {OBJECTS[k] && (
          <>
            <div className="grid grid-3">
              {meta.fields.map(([f, l]) => (
                <Field key={f} label={l} hint={`Default ${policy.defaultValue[f]}`}>
                  <input className="input" type="number" min="0" max="100" step="1" value={drafts[k][f]} onChange={setField(k, f)} />
                </Field>
              ))}
            </div>
            {meta.total && (
              <div className="row">
                <span className="small muted">Total</span>
                <Badge tone={sumOf(values[k]) === meta.total ? 'low' : 'high'}>{sumOf(values[k])} / {meta.total}</Badge>
              </div>
            )}
            {err && <div className="small" style={{ color: 'var(--high)' }}>{err}</div>}
          </>
        )}
        {k === 'routingStages' && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Stage</th><th>Label shown to farms</th><th className="num">Applies up to (% of shelf life)</th></tr>
                </thead>
                <tbody>
                  {drafts.routingStages.map((s, i) => {
                    const last = i === drafts.routingStages.length - 1;
                    return (
                      <tr key={s.key}>
                        <td className="strong">{label(s.key)}</td>
                        <td><input className="input" value={s.label} maxLength={60} onChange={setStage(i, 'label')} /></td>
                        <td className="num">
                          {last ? <span className="muted">Open-ended</span> : (
                            <input className="input input-sm" type="number" min="1" max="300" step="1" value={s.upToPct ?? ''} onChange={setStage(i, 'upToPct')} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {err && <div className="small" style={{ color: 'var(--high)' }}>{err}</div>}
          </>
        )}
      </div>
    );
  };

  return (
    <Card
      title={group.title}
      description={group.description}
      actions={
        <>
          {dirty.length > 0 && <Badge tone="medium">Unsaved changes</Badge>}
          <button className="btn btn-primary btn-sm" disabled={busy || !dirty.length || blocked} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <div className="stack" style={{ gap: 22 }}>{group.keys.map(renderPolicy)}</div>
    </Card>
  );
}

function SystemHealth() {
  const health = useApi(() => api.get('/health'), []);
  const d = health.data;
  const integration = (v) => <Badge tone={v === 'configured' ? 'low' : 'outline'}>{v === 'configured' ? 'Configured' : 'Mock'}</Badge>;
  return (
    <Card title="System health" actions={<button className="btn btn-ghost btn-sm" disabled={health.loading} onClick={health.reload}>Refresh</button>}>
      {health.error ? (
        <Notice tone="danger">
          <div>
            <div className="strong">API degraded or unreachable</div>
            <div>{health.error.message}</div>
          </div>
        </Notice>
      ) : !d ? (
        <span className="muted small">Checking…</span>
      ) : (
        <div>
          <div className="stat-line"><span>API status</span><Badge tone={d.status === 'ok' ? 'low' : 'high'} dot>{d.status === 'ok' ? 'Operational' : 'Degraded'}</Badge></div>
          <div className="stat-line"><span>Database</span><Badge tone={d.database === 'connected' ? 'low' : 'high'}>{label(d.database)}</Badge></div>
          <div className="stat-line"><span>Environment</span><span className="mono">{d.environment}</span></div>
          <div className="stat-line"><span>OpenAI</span>{integration(d.integrations?.openai)}</div>
          <div className="stat-line"><span>WhatsApp</span>{integration(d.integrations?.whatsapp)}</div>
          <div className="stat-line"><span>Checked</span><span className="small muted">{dateTime(d.timestamp)}</span></div>
        </div>
      )}
    </Card>
  );
}

export default function Policies() {
  const state = useApi(() => api.get('/admin/policies'), []);

  return (
    <>
      <PageHeader
        title="Platform policies"
        description="The transparent business rules behind risk, MarketRoute, HarvestMatch, Rescue, shelf-life urgency and the Phase 3 preview. Changes apply platform-wide immediately and are recorded in the audit log."
      />
      <div className="grid grid-main-side">
        <AsyncBoundary state={state}>
          {(list) => {
            const byKey = Object.fromEntries(list.map((p) => [p.key, p]));
            return (
              <div className="stack">
                {GROUPS.filter((g) => g.keys.every((k) => byKey[k])).map((g) => (
                  <PolicyGroup key={g.title} group={g} policies={byKey} onSaved={state.setData} />
                ))}
              </div>
            );
          }}
        </AsyncBoundary>
        <div className="stack">
          <SystemHealth />
          <Notice>
            Default values come from the platform&apos;s built-in rules. A custom value overrides the default until it is reset. Integrations
            shown as Mock run in safe template mode without external credentials.
          </Notice>
        </div>
      </div>
    </>
  );
}
