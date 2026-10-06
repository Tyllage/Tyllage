import { Logo } from '../components/Icons.jsx';

const LOOP = ['Expected harvest', 'Existing demand & coverage', 'HarvestMatch recommendations', 'Farmer approval → orders', 'Demand Recovery & Rescue', 'Analytics'];

export default function AuthLayout({ children }) {
  return (
    <div className="auth-page">
      <aside className="auth-side">
        <div>
          <div className="row" style={{ gap: 12 }}>
            <Logo size={36} />
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>Tyllage</div>
              <div style={{ fontSize: 12, color: '#8fa89b' }}>From Harvest to Demand.</div>
            </div>
          </div>
          <h1>Match what you harvest with the demand that's already there — before produce is at risk.</h1>
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
          Local farm demand, market-access and harvest-matching platform. ComCrop-first pilot, built for Singapore's farms.
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}
