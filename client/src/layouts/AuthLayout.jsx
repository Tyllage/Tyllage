import { Link } from 'react-router-dom';
import { Logo } from '../components/Icons.jsx';

// Proposal v3 core workflow.
const LOOP = ['Record expected harvest', 'Capture demand & coverage', 'Compare routes with MarketRoute', 'HarvestMatch within the route', 'Farmer approves allocation', 'Demand Recovery & Rescue', 'Insights'];

export default function AuthLayout({ children }) {
  return (
    <div className="auth-page">
      <aside className="auth-side">
        <div>
          <Link to="/" className="row" style={{ gap: 12 }} aria-label="Tyllage website">
            <Logo size={36} />
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>Tyllage</div>
              <div style={{ fontSize: 12, color: '#8fa89b' }}>From Harvest to Demand.</div>
            </div>
          </Link>
          <h1>Decide where upcoming harvest should go — before it becomes a commercial problem.</h1>
          <div className="loop">
            {LOOP.map((step, i) => (
              <div key={step}>
                <b>{i + 1}</b>
                {step}
              </div>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#7f978a' }}>
          Demand &amp; market access platform for local farms: commercial intelligence, market coordination and demand recovery. Industry-wide opportunity, ComCrop-first validation.
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <Link to="/" className="small" style={{ display: 'inline-block', marginBottom: 18 }}>← Back to the Tyllage website</Link>
          {children}
        </div>
      </main>
    </div>
  );
}
