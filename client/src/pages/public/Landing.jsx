import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { Icons, Wordmark } from '../../components/Icons.jsx';
import { date, kg } from '../../utils/format.js';
import './landing.css';

const NAV = [
  ['#how', 'How it works'],
  ['#features', 'Platform'],
  ['#buyers', 'For buyers'],
  ['#principles', 'Principles'],
];

const PROBLEMS = [
  ['Demand is fragmented', 'Wholesalers, restaurants, caterers, retailers and households all buy differently — on different prices, volumes and terms.', Icons.Demand],
  ['Costs are structurally high', 'Local land, labour and energy cost more than for regional imports, so competing on price alone rarely works.', Icons.Analytics],
  ['Produce cannot wait', 'Leafy greens and herbs have days, not weeks. A cancelled order or a bigger harvest quickly becomes surplus.', Icons.Clock],
];

const STEPS = [
  ['Record expected harvest', 'Crop, quantity, harvest date, quality and your commercial constraints.'],
  ['Capture demand', 'Buyer requests, recurring requirements and confirmed orders in one place.'],
  ['See demand coverage', 'How much of upcoming harvest is already sold — and what is exposed.'],
  ['Compare routes', 'Price, volume, logistics, margin, reliability and urgency, side by side.'],
  ['Match and approve', 'Rank the right buyers within the route. Nothing moves until you approve.'],
  ['Recover and learn', 'Redirect displaced produce early, then learn which channels perform best.'],
];

const FEATURES = [
  ['Demand Radar', 'Expected harvest against confirmed and potential demand, so exposure is visible before harvest becomes surplus.', Icons.Overview],
  ['MarketRoute', 'Compares wholesale, food service, retail, community and Rescue routes with a transparent commercial score.', Icons.Route],
  ['HarvestMatch', 'Ranks specific buyers within the chosen route by fit, date, price, quantity, location and history — with reasons.', Icons.Match],
  ['Margin Guard', 'Checks price, minimum viable price and fulfilment cost, so clearing stock never quietly destroys margin.', Icons.Check],
  ['Demand Recovery', 'When a buyer cancels or harvest runs over, re-routes produce: alternative route, Rescue, then final disposition.', Icons.Recovery],
  ['Tyllage Rescue', 'A farm-approved route for cosmetically imperfect, irregular or short-dated produce.', Icons.Rescue],
  ['Tyllage Connect', 'Drafts outreach to the right buyers. You review and approve every message before it is sent.', Icons.Campaign],
  ['Insights', 'Which crops sell through, which routes keep margin, which buyers reorder — learned from your own sales.', Icons.Analytics],
];

const ROUTES = [
  ['Restaurants & cafés', 'Strong', 'High', 'Medium', 'Buyer pickup', 'High'],
  ['Wholesale', 'Strong', 'Lower', 'High', 'Central drop', 'Medium-high'],
  ['Community & D2C', 'Moderate', 'High', 'Low', 'Collection point', 'Medium'],
  ['Retail & wet markets', 'Moderate', 'Medium', 'High', 'Farm delivery', 'Medium'],
];

const BUYERS = [
  ['Restaurants & cafés', 'Recurring, premium and specialty produce.'],
  ['Hotels & caterers', 'Larger recurring orders with clear delivery terms.'],
  ['Wholesalers', 'High-volume supply, planned ahead of harvest.'],
  ['Retailers & wet markets', 'Reliable local supply for the shelf.'],
  ['Community buyers', 'Fresh local produce through collection points.'],
  ['Households', 'Rescue offers and harvests from nearby farms.'],
];

const PARTNERS = [
  ['Wholesalers', 'A route and a buyer group to compare — not a competitor to remove.'],
  ['Logistics providers', 'Fulfilment partners whose terms and costs count towards route viability.'],
  ['Retailers & wet markets', 'Existing channels, weighed against every other route.'],
  ['Industry programmes', 'Aggregation and demand signals treated as routes and inputs.'],
  ['Farm-management systems', 'Sources of expected harvest — not systems to replace.'],
];

const PRINCIPLES = [
  ['Explainable, not a black box', 'Every recommendation shows the rules and reasons behind it. Scoring is rule-based until real history justifies more.'],
  ['The farmer stays in control', 'Tyllage recommends; the farm approves every route, allocation, listing and message.'],
  ['Farm data stays private', 'Costs, minimum prices and margins are never shown to buyers.'],
  ['AI writes words, not decisions', 'AI only drafts messages and summaries. It never changes stock, prices or permissions.'],
];

/** Decorative crop rows echoing the stripes in the Tyllage mark. */
function FieldRows() {
  return (
    <svg className="site-fields" viewBox="0 0 600 400" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      {Array.from({ length: 9 }, (_, i) => (
        <path key={i} d={`M-40 ${120 + i * 38} C 160 ${40 + i * 30}, 380 ${200 + i * 26}, 660 ${90 + i * 34}`} fill="none"
          stroke={i % 2 ? '#2da124' : '#024123'} strokeOpacity={0.07 + (i % 3) * 0.03} strokeWidth="18" strokeLinecap="round" />
      ))}
    </svg>
  );
}

/** Illustrative Demand Radar (sample figures, not live data). */
function RadarPreview() {
  const rows = [
    ['Nai Bai', 120, 84, 'Low', 'Restaurants & cafés'],
    ['Kale', 70, 22, 'High', 'Hotels & caterers'],
    ['Basil', 35, 31, 'Low', 'Restaurants & cafés'],
    ['Lettuce', 90, 48, 'Medium', 'Retail & wet markets'],
  ];
  return (
    <div className="site-preview" role="img" aria-label="Illustration of the Tyllage Demand Radar with sample figures">
      <div className="site-preview-head">
        <span className="dot" /><span className="dot" /><span className="dot" />
        <b>Demand Radar</b><em>Sample figures</em>
      </div>
      <div className="site-preview-body">
        {rows.map(([name, expected, confirmed, risk, route]) => {
          const pct = Math.round((confirmed / expected) * 100);
          return (
            <div className="site-radar-row" key={name}>
              <div>
                <div className="name">{name}</div>
                <div className="sub">{confirmed}kg of {expected}kg covered</div>
              </div>
              <div className="bar"><span className={`risk-${risk.toLowerCase()}`} style={{ width: `${pct}%` }} /></div>
              <div className={`risk risk-${risk.toLowerCase()}`}>{risk}</div>
              <div className="route"><Icons.Route />{route}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Live produce from farms on Tyllage (public data only — no price floors, farm names or farm-private figures). */
function GrowingNow() {
  const [items, setItems] = useState(null);
  useEffect(() => {
    api.get('/marketplace/supply')
      .then((s) => setItems([...s.availableNow, ...s.growingSoon].slice(0, 8)))
      .catch(() => setItems([]));
  }, []);
  if (!items?.length) return null;
  return (
    <section className="site-section site-alt" id="growing">
      <div className="site-wrap">
        <div className="site-eyebrow">On Tyllage now</div>
        <h2>Harvests coming up on the platform</h2>
        <p className="site-lead">Produce farms have listed with unallocated quantity. Buyers can request supply before it is harvested.</p>
        <div className="site-produce">
          {items.map((b) => (
            <div className="site-produce-card" key={b.id}>
              <Icons.Sprout />
              <div className="name">{b.produceName}</div>
              <div className="sub">Harvest {date(b.harvestDate)}</div>
              <div className="qty">{kg(b.availableQuantity, b.unit)} available</div>
            </div>
          ))}
        </div>
        <Link className="site-btn site-btn-ghost" to="/register">Request supply as a buyer <Icons.Arrow /></Link>
      </div>
    </section>
  );
}

export default function Landing() {
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    document.title = 'Tyllage — From Harvest to Demand';
  }, []);

  return (
    <div className="site">
      <header className="site-header">
        <div className="site-wrap site-header-inner">
          <a href="#top" className="site-logo" aria-label="Tyllage home"><Wordmark height={34} /></a>
          <nav className={`site-nav ${menu ? 'open' : ''}`} aria-label="Website">
            {NAV.map(([href, text]) => <a key={href} href={href} onClick={() => setMenu(false)}>{text}</a>)}
            <Link to="/login" className="site-btn site-btn-ghost">Sign in</Link>
            <Link to="/register" className="site-btn">Join as a buyer</Link>
          </nav>
          <button className="site-menu" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}><Icons.Menu /></button>
        </div>
      </header>

      <main id="top">
        <section className="site-hero">
          <FieldRows />
          <div className="site-wrap site-hero-inner">
            <div>
              <div className="site-eyebrow">Commercial intelligence for local farms</div>
              <h1>Decide where every harvest goes — <span>before it becomes a problem.</span></h1>
              <p className="site-lead">
                Tyllage brings expected harvest, buyer demand, sales routes, fulfilment costs and recovery options into one view,
                so local farms sell more of what they grow at a margin that keeps them going.
              </p>
              <div className="site-cta">
                <Link to="/login" className="site-btn site-btn-lg">Sign in to Tyllage <Icons.Arrow /></Link>
                <Link to="/register" className="site-btn site-btn-lg site-btn-ghost">Join as a buyer</Link>
              </div>
              <div className="site-tagline">From Harvest to Demand.</div>
            </div>
            <RadarPreview />
          </div>
        </section>

        <section className="site-section" id="why">
          <div className="site-wrap">
            <div className="site-eyebrow">Why it matters</div>
            <h2>Growing more is not the hard part. Selling it well is.</h2>
            <div className="site-facts">
              <div><b>90%+</b><span>of Singapore&apos;s food is imported</span></div>
              <div><b>20%</b><span>2035 target for local fibre — leafy and fruited vegetables, beansprouts, mushrooms</span></div>
              <div><b>30%</b><span>2035 target for local protein — eggs and seafood</span></div>
            </div>
            <p className="site-source">Source: Singapore Food Story 2, Ministry of Sustainability and the Environment.</p>
            <div className="site-grid-3">
              {PROBLEMS.map(([title, text, Icon]) => (
                <div className="site-card" key={title}>
                  <div className="site-icon"><Icon /></div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
            <blockquote className="site-quote">
              The question is not only “Can we sell this harvest?” but <b>“Which route gives this harvest the strongest viable outcome?”</b>
            </blockquote>
          </div>
        </section>

        <section className="site-section site-alt" id="how">
          <div className="site-wrap">
            <div className="site-eyebrow">How it works</div>
            <h2>One workflow, from expected harvest to the right buyer</h2>
            <ol className="site-steps">
              {STEPS.map(([title, text], i) => (
                <li key={title}><span>{i + 1}</span><div><h3>{title}</h3><p>{text}</p></div></li>
              ))}
            </ol>
          </div>
        </section>

        <section className="site-section" id="features">
          <div className="site-wrap">
            <div className="site-eyebrow">The platform</div>
            <h2>Everything between harvest and demand</h2>
            <div className="site-grid-4">
              {FEATURES.map(([title, text, Icon]) => (
                <div className="site-card" key={title}>
                  <div className="site-icon"><Icon /></div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section site-dark">
          <div className="site-wrap site-split">
            <div>
              <div className="site-eyebrow">MarketRoute</div>
              <h2>The biggest buyer is not always the best outcome</h2>
              <p className="site-lead">
                Before matching individual buyers, Tyllage compares routes on demand, price, volume, who carries the logistics and what margin is left after
                fulfilment. Then it ranks buyers inside the route you choose.
              </p>
            </div>
            <div className="site-table-wrap">
              <table className="site-table">
                <thead><tr><th>Route</th><th>Demand</th><th>Price</th><th>Volume</th><th>Fulfilment</th><th>Fit</th></tr></thead>
                <tbody>
                  {ROUTES.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}
                </tbody>
              </table>
              <p className="site-source">Illustrative comparison. Real scores come from each farm&apos;s own demand, prices and costs.</p>
            </div>
          </div>
        </section>

        <GrowingNow />

        <section className="site-section" id="buyers">
          <div className="site-wrap site-split">
            <div>
              <div className="site-eyebrow">For buyers</div>
              <h2>Secure local produce before it is harvested</h2>
              <p className="site-lead">
                Register your recurring requirements once. Farms see your demand early, match it to upcoming harvests and confirm orders on clear terms.
              </p>
              <Link to="/register" className="site-btn site-btn-lg">Join as a buyer <Icons.Arrow /></Link>
            </div>
            <div className="site-list">
              {BUYERS.map(([title, text]) => (
                <div key={title}><Icons.Check /><div><b>{title}</b><span>{text}</span></div></div>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section site-alt">
          <div className="site-wrap">
            <div className="site-eyebrow">Works with what exists</div>
            <h2>Complements the channels farms already use</h2>
            <p className="site-lead">Tyllage does not replace wholesalers, logistics providers, retailers or industry programmes. It gives farms one commercial view across them.</p>
            <div className="site-grid-5">
              {PARTNERS.map(([title, text]) => (
                <div className="site-card site-card-sm" key={title}><h3>{title}</h3><p>{text}</p></div>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section" id="principles">
          <div className="site-wrap">
            <div className="site-eyebrow">Principles</div>
            <h2>Built to be trusted by the people who grow the food</h2>
            <div className="site-grid-2">
              {PRINCIPLES.map(([title, text]) => (
                <div className="site-principle" key={title}><Icons.Check /><div><h3>{title}</h3><p>{text}</p></div></div>
              ))}
            </div>
          </div>
        </section>

        <section className="site-cta-band">
          <FieldRows />
          <div className="site-wrap">
            <img src="/brand/tyllage-icon-192.png" alt="" aria-hidden="true" className="site-cta-emblem" width="76" height="76" />
            <h2>Know where your next harvest is going.</h2>
            <p>Farms are onboarded by the Tyllage team during the pilot. Buyers can register now.</p>
            <div className="site-cta">
              <Link to="/login" className="site-btn site-btn-lg site-btn-light">Sign in <Icons.Arrow /></Link>
              <Link to="/register" className="site-btn site-btn-lg site-btn-outline-light">Join as a buyer</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-wrap site-footer-inner">
          <div>
            <Wordmark height={30} />
            <p>Demand &amp; market access platform for local farms.<br />Commercial intelligence · Market coordination · Demand recovery.</p>
          </div>
          <nav aria-label="Footer">
            {NAV.map(([href, text]) => <a key={href} href={href}>{text}</a>)}
            <Link to="/login">Sign in</Link>
          </nav>
        </div>
        <div className="site-wrap site-copy">© {new Date().getFullYear()} Tyllage. From Harvest to Demand.</div>
      </footer>
    </div>
  );
}
