import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, homePathFor } from '../../context/AuthContext.jsx';
import { Logo } from '../../components/Icons.jsx';
import { CATEGORIES, STATUS_CODES } from '../../utils/httpStatus.js';

const FILTERS = [
  { value: 'all', label: 'All' },
  ...Object.entries(CATEGORIES).map(([k, c]) => ({ value: k, label: `${k}xx ${c.label}` })),
  { value: 'tyllage', label: 'Used by Tyllage API' },
];

export default function StatusCodes() {
  const { user } = useAuth();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = STATUS_CODES.filter((s) => {
      if (filter === 'tyllage' && !s.tyllage) return false;
      if (CATEGORIES[filter] && s.category !== Number(filter)) return false;
      if (!term) return true;
      return `${s.code} ${s.name} ${s.summary} ${s.tag || ''} ${(s.tyllage || []).join(' ')}`.toLowerCase().includes(term);
    });
    return Object.keys(CATEGORIES)
      .map((k) => ({ category: Number(k), info: CATEGORIES[k], rows: rows.filter((s) => s.category === Number(k)) }))
      .filter((g) => g.rows.length);
  }, [filter, q]);

  return (
    <div className="status-page">
      <header className="status-header">
        <Link to={user ? homePathFor(user) : '/'} className="row" style={{ gap: 10, color: 'var(--text)', textDecoration: 'none' }}>
          <Logo size={28} />
          <span className="strong">Tyllage</span>
        </Link>
        {user && <Link className="small" to={homePathFor(user)}>Back to app</Link>}
      </header>

      <div className="content">
        <div className="page-header">
          <div>
            <h1>HTTP status codes</h1>
            <p>
              Every API response starts with a status line — <span className="mono">HTTP-Version SP Status-Code SP Reason-Phrase CRLF</span> — whose
              code tells the client the overall result. Codes marked <span className="badge badge-primary">Tyllage API</span> are ones this
              platform returns, with the machine-readable <span className="mono">code</span> sent in the JSON error body.
            </p>
          </div>
        </div>

        <div className="row-between" style={{ marginBottom: 16 }}>
          <div className="filters">
            {FILTERS.map((f) => (
              <button key={f.value} className={`chip ${filter === f.value ? 'active' : ''}`} onClick={() => setFilter(f.value)}>{f.label}</button>
            ))}
          </div>
          <input className="input" style={{ maxWidth: 260 }} placeholder="Search code, name or error…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search status codes" />
        </div>

        {groups.length === 0 && <div className="empty"><h3>No status codes match</h3></div>}

        {groups.map((g) => (
          <section key={g.category} className="status-group">
            <div className="status-group-head">
              <span className={`status-chip tone-${g.info.tone}`}>{g.category}xx</span>
              <div>
                <h2>{g.info.label}</h2>
                <p className="small muted">{g.info.blurb}</p>
              </div>
            </div>
            <div className="status-grid">
              {g.rows.map((s) => (
                <article key={s.code} className={`status-item tone-${g.info.tone}`}>
                  <div className="row-between">
                    <div className="row" style={{ gap: 10 }}>
                      <span className="status-item-code">{s.code}</span>
                      <span className="strong">{s.name}</span>
                    </div>
                    <div className="row" style={{ gap: 4 }}>
                      {s.tyllage && <span className="badge badge-primary">Tyllage API</span>}
                      {s.tag && <span className="badge badge-outline">{s.tag}</span>}
                    </div>
                  </div>
                  <p className="small" style={{ marginTop: 6 }}>{s.summary}</p>
                  {s.tyllage && (
                    <div className="row" style={{ gap: 4, marginTop: 8 }}>
                      {s.tyllage.map((t) => <span key={t} className="mono status-usage">{t}</span>)}
                    </div>
                  )}
                  <Link className="small status-preview" to={`/status/${s.code}`}>Preview page →</Link>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
