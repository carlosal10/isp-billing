import { Link } from "react-router-dom";
import {
  MdArrowForward,
  MdBolt,
  MdCheckCircle,
  MdDashboard,
  MdPayments,
  MdReceiptLong,
  MdRouter,
  MdSecurity,
  MdSms,
  MdSupportAgent,
  MdWifiTethering,
} from "react-icons/md";
import "./Landing.css";

const capabilities = [
  {
    icon: MdPayments,
    eyebrow: "Revenue",
    title: "Billing that closes the loop",
    text: "Move from invoice to payment, allocation, receipt, and service entitlement with a traceable financial history.",
  },
  {
    icon: MdRouter,
    eyebrow: "Network",
    title: "Router operations in context",
    text: "Manage PPPoE, hotspot, static IP, queues, and connected routers beside the subscriber record that matters.",
  },
  {
    icon: MdSms,
    eyebrow: "Collections",
    title: "Timely, relevant communication",
    text: "Coordinate reminders, paylinks, campaigns, preferences, and delivery outcomes from one operational workspace.",
  },
  {
    icon: MdSupportAgent,
    eyebrow: "Service",
    title: "Support with the full picture",
    text: "Bring incidents, tickets, work orders, assets, payments, and network health into the same customer conversation.",
  },
];

const workflow = [
  ["01", "Connect", "Add your team, payment channels, messaging provider, and MikroTik estate."],
  ["02", "Operate", "Provision customers, monitor access, collect revenue, and resolve issues."],
  ["03", "Improve", "Use finance, delivery, audit, and network signals to tighten performance."],
];

export default function Landing() {
  return (
    <div className="landing" aria-labelledby="landing-title">
      <nav className="landing-nav" aria-label="Primary navigation">
        <div className="landing-nav-inner">
          <Link className="landing-brand" to="/" aria-label="SwiftBridge home">
            <span className="landing-brand-mark" aria-hidden="true">
              <MdWifiTethering />
            </span>
            <span>
              <strong>SwiftBridge</strong>
              <small>ISP operations</small>
            </span>
          </Link>

          <div className="landing-nav-links">
            <a href="#platform">Platform</a>
            <a href="#workflow">How it works</a>
          </div>

          <div className="landing-nav-actions">
            <Link className="landing-link-button" to="/login?mode=customer">
              Customer portal
            </Link>
            <Link className="landing-primary-button compact" to="/login">
              Sign in <MdArrowForward aria-hidden="true" />
            </Link>
          </div>
        </div>
      </nav>

      <main>
        <header className="landing-hero">
          <div className="landing-orb landing-orb-one" aria-hidden="true" />
          <div className="landing-orb landing-orb-two" aria-hidden="true" />
          <div className="landing-grid" aria-hidden="true" />

          <div className="landing-shell landing-hero-grid">
            <div className="landing-hero-copy">
              <div className="landing-kicker">
                <span className="landing-live-dot" />
                One command center for growing ISPs
              </div>
              <h1 id="landing-title">
                Run the network.
                <span>Know the money.</span>
                Serve every customer.
              </h1>
              <p>
                SwiftBridge connects billing, collections, subscriber access,
                MikroTik operations, and support in one calm, accountable workspace.
              </p>

              <div className="landing-hero-actions">
                <Link className="landing-primary-button" to="/register">
                  Create your workspace <MdArrowForward aria-hidden="true" />
                </Link>
                <a className="landing-secondary-button" href="#platform">
                  Explore the platform
                </a>
              </div>

              <ul className="landing-assurance" aria-label="Platform assurances">
                <li><MdCheckCircle /> Tenant-aware operations</li>
                <li><MdCheckCircle /> Auditable finance</li>
                <li><MdCheckCircle /> Built for East African payments</li>
              </ul>
            </div>

            <div className="product-preview" aria-label="SwiftBridge operations dashboard preview">
              <div className="preview-topbar">
                <div className="preview-brand">
                  <span><MdBolt /></span>
                  Operations overview
                </div>
                <div className="preview-health"><i /> All systems nominal</div>
              </div>

              <div className="preview-metrics">
                <article>
                  <small>Collections</small>
                  <strong>KES 2.48m</strong>
                  <span className="positive">+12.4% this month</span>
                </article>
                <article>
                  <small>Subscribers online</small>
                  <strong>1,284</strong>
                  <span>across 6 routers</span>
                </article>
                <article>
                  <small>Collection rate</small>
                  <strong>94.8%</strong>
                  <span className="positive">On track</span>
                </article>
              </div>

              <div className="preview-content">
                <section className="preview-chart-card" aria-label="Fourteen day collections trend">
                  <div className="preview-card-heading">
                    <span>
                      <small>Revenue pulse</small>
                      <strong>14-day collections</strong>
                    </span>
                    <em>KES</em>
                  </div>
                  <div className="preview-chart" aria-hidden="true">
                    {[32, 46, 40, 68, 54, 74, 61, 82, 70, 88, 76, 94, 85, 100].map((height, index) => (
                      <i key={index} style={{ "--bar-height": `${height}%` }} />
                    ))}
                  </div>
                  <div className="preview-chart-axis"><span>14 days ago</span><span>Today</span></div>
                </section>

                <section className="preview-activity-card" aria-label="Live operations activity">
                  <div className="preview-card-heading">
                    <span>
                      <small>Live activity</small>
                      <strong>Operations feed</strong>
                    </span>
                  </div>
                  <ul>
                    <li>
                      <span className="activity-icon success"><MdPayments /></span>
                      <span><strong>Payment matched</strong><small>ACC-1048 · KES 3,500</small></span>
                      <time>Now</time>
                    </li>
                    <li>
                      <span className="activity-icon info"><MdRouter /></span>
                      <span><strong>Access restored</strong><small>PPPoE · East router</small></span>
                      <time>2m</time>
                    </li>
                    <li>
                      <span className="activity-icon warn"><MdReceiptLong /></span>
                      <span><strong>17 invoices due</strong><small>Reminder run prepared</small></span>
                      <time>8m</time>
                    </li>
                  </ul>
                </section>
              </div>
            </div>
          </div>
        </header>

        <section className="landing-platform" id="platform" aria-labelledby="platform-title">
          <div className="landing-shell">
            <div className="landing-section-heading">
              <span>One operational picture</span>
              <h2 id="platform-title">Every team works from the same truth.</h2>
              <p>
                Finance, network operations, support, and customer care see the
                context they need without stitching together disconnected tools.
              </p>
            </div>

            <div className="capability-grid">
              {capabilities.map(({ icon: Icon, eyebrow, title, text }) => (
                <article className="capability-card" key={title}>
                  <div className="capability-icon"><Icon /></div>
                  <span>{eyebrow}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  <div className="capability-line" aria-hidden="true" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-control-band" aria-label="Operational control">
          <div className="landing-shell control-band-grid">
            <div>
              <span className="landing-section-label">Designed for consequential work</span>
              <h2>Fast enough for the front desk. Precise enough for finance and NOC.</h2>
            </div>
            <div className="control-list">
              <p><MdSecurity /><span><strong>Accountable by default</strong>Roles, audit history, request context, and controlled operational actions.</span></p>
              <p><MdDashboard /><span><strong>Signals before noise</strong>Health, collections, due accounts, failed jobs, and router state in one hierarchy.</span></p>
              <p><MdBolt /><span><strong>Action close to evidence</strong>Move from an exception to the customer, payment, router, or recovery step quickly.</span></p>
            </div>
          </div>
        </section>

        <section className="landing-workflow" id="workflow" aria-labelledby="workflow-title">
          <div className="landing-shell">
            <div className="landing-section-heading compact-heading">
              <span>From setup to daily rhythm</span>
              <h2 id="workflow-title">A clear path to operational control.</h2>
            </div>
            <div className="workflow-grid">
              {workflow.map(([number, title, text]) => (
                <article key={number}>
                  <span>{number}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-final-cta">
          <div className="landing-shell final-cta-inner">
            <div>
              <span className="landing-section-label">Build a better operating day</span>
              <h2>Your ISP deserves one dependable control plane.</h2>
              <p>Start with your team and your first router. Grow without losing visibility.</p>
            </div>
            <div>
              <Link className="landing-primary-button light" to="/register">
                Create your workspace <MdArrowForward aria-hidden="true" />
              </Link>
              <Link className="landing-footer-login" to="/login">Already have an account? Sign in</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-shell">
          <div className="landing-brand footer-brand">
            <span className="landing-brand-mark"><MdWifiTethering /></span>
            <span><strong>SwiftBridge</strong><small>ISP operations</small></span>
          </div>
          <p>Billing, network operations, and customer service—connected.</p>
          <span>© {new Date().getFullYear()} SwiftBridge</span>
        </div>
      </footer>
    </div>
  );
}
