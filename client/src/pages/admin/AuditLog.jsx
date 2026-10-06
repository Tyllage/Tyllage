import { useState } from 'react';
import { api } from '../../services/api.js';
import { useApi } from '../../hooks/useApi.js';
import { PageHeader, Card, AsyncBoundary, EmptyState, FilterChips } from '../../components/ui.jsx';
import { dateTime, label } from '../../utils/format.js';

const SECURITY_PREFIXES = ['LOGIN_', 'USER_', 'POLICY_'];
const isSecurity = (action) => SECURITY_PREFIXES.some((p) => action?.startsWith(p));
const FILTERS = {
  all: () => true,
  security: (r) => isSecurity(r.action),
  farm: (r) => !isSecurity(r.action),
};
const hasDetails = (d) => d && typeof d === 'object' && Object.keys(d).length > 0;

export default function AuditLog() {
  const state = useApi(() => api.get('/admin/audit-logs'), []);
  const [filter, setFilter] = useState('all');

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Platform-wide record of sign-ins, account changes, policy updates and farm activity (latest 100 events)."
        actions={<button className="btn" disabled={state.loading} onClick={state.reload}>Refresh</button>}
      />
      <AsyncBoundary state={state}>
        {(logs) => {
          const count = (k) => logs.filter(FILTERS[k]).length;
          const rows = logs.filter(FILTERS[filter]);
          return (
            <div className="stack">
              <FilterChips
                options={[
                  { value: 'all', label: `All (${count('all')})` },
                  { value: 'security', label: `Security (${count('security')})` },
                  { value: 'farm', label: `Farm activity (${count('farm')})` },
                ]}
                value={filter}
                onChange={setFilter}
              />
              <Card tight>
                {rows.length === 0 ? <EmptyState title="No events in this view" /> : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr><th>Time</th><th>Action</th><th>User</th><th>Farm</th><th>Entity</th><th>IP</th><th>Details</th></tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.id}>
                            <td className="nowrap">{dateTime(r.createdAt)}</td>
                            <td><span className="mono">{r.action}</span></td>
                            <td>
                              {r.userName ? (
                                <>
                                  <div className="cell-title">{r.userName}</div>
                                  <div className="cell-sub">{r.userEmail}</div>
                                </>
                              ) : <span className="muted">System</span>}
                            </td>
                            <td>{r.farmName || <span className="muted">Platform</span>}</td>
                            <td>{r.entityType ? <>{label(r.entityType)}{r.entityId ? <span className="muted"> #{r.entityId}</span> : null}</> : <span className="muted">—</span>}</td>
                            <td><span className="mono">{r.ipAddress || '—'}</span></td>
                            <td style={{ minWidth: 160 }}>
                              {hasDetails(r.details) ? (
                                <details>
                                  <summary className="small muted" style={{ cursor: 'pointer' }}>View details</summary>
                                  <pre className="ai-prompt">{JSON.stringify(r.details, null, 2)}</pre>
                                </details>
                              ) : <span className="muted">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          );
        }}
      </AsyncBoundary>
    </>
  );
}
