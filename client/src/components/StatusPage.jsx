import { Link, useNavigate } from 'react-router-dom';
import { useAuth, homePathFor } from '../context/AuthContext.jsx';
import { Icons, Logo } from './Icons.jsx';
import { getStatus, isRetryable } from '../utils/httpStatus.js';

/**
 * Status page for any HTTP status code.
 * - full (default): standalone page with the Tyllage header (direct visits, unknown routes).
 * - inline: rendered inside the app shell when a page fails to load or access is denied.
 * `detail` shows the server's own message (e.g. "You do not have access to this farm").
 */
export default function StatusPage({ code = 404, inline = false, detail, onRetry }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const status = getStatus(code) || getStatus(404);
  const tone = status.categoryInfo.tone;
  const home = homePathFor(user);
  const retryable = isRetryable(status.code) || status.category === 5;

  const actions = (
    <div className="status-actions">
      {status.code === 401 ? (
        <Link className="btn btn-primary" to="/login">Sign in</Link>
      ) : retryable ? (
        <button className="btn btn-primary" onClick={() => (onRetry ? onRetry() : window.location.reload())}>
          <Icons.Recovery />Try again
        </button>
      ) : (
        <Link className="btn btn-primary" to={user ? home : '/'}>
          <Icons.Home />{user ? 'Back to dashboard' : 'Go to home'}
        </Link>
      )}
      <button className="btn" onClick={() => navigate(-1)}>Go back</button>
    </div>
  );

  const body = (
    <div className={`status-card tone-${tone} ${inline ? 'inline' : ''}`}>
      <div className="status-code" aria-hidden="true">{status.code}</div>
      <span className={`badge badge-${tone}`}>{status.code} · {status.categoryInfo.label}</span>
      <h1 className="status-title">{status.title}</h1>
      <p className="status-message">{status.message}</p>
      {detail && detail !== status.message && <p className="status-detail">{detail}</p>}
      {actions}
      <details className="status-tech">
        <summary>Technical details</summary>
        <div className="mono status-line">HTTP/1.1 {status.code} {status.name}</div>
        <p>{status.summary}</p>
        {status.tag && <p className="small muted">Source: {status.tag}</p>}
        <Link className="small" to="/status">All HTTP status codes →</Link>
      </details>
    </div>
  );

  if (inline) return <div className="status-inline" role="alert">{body}</div>;

  return (
    <div className="status-page">
      <header className="status-header">
        <Link to={user ? home : '/'} className="row" style={{ gap: 10, color: 'var(--text)', textDecoration: 'none' }}>
          <Logo size={28} />
          <span className="strong">Tyllage</span>
        </Link>
        <Link className="small" to="/status">Status codes</Link>
      </header>
      <main className="status-main">{body}</main>
    </div>
  );
}
