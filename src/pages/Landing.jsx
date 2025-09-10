import { Link } from "react-router-dom";
import {
  MdReceiptLong,
  MdSms,
  MdSubscriptions,
  MdPayments,
  MdInsights,
} from "react-icons/md";
import "./Landing.css";

export default function Landing() {
  const features = [
    {
      icon: <MdReceiptLong size={20} />,
      title: "Automated invoicing & billing",
      text: "Generate invoices, track dues, and bill on schedule.",
    },
    {
      icon: <MdSms size={20} />,
      title: "SMS/email notifications",
      text: "Send reminders and confirmations automatically.",
    },
    {
      icon: <MdSubscriptions size={20} />,
      title: "Subscription & plan management",
      text: "Create plans, assign customers, and manage expiries.",
    },
    {
      icon: <MdPayments size={20} />,
      title: "Payment integration",
      text: "STK-Push, cards, and more — all in one place.",
    },
    {
      icon: <MdInsights size={20} />,
      title: "Reporting & analytics",
      text: "Visualize collections and monitor performance.",
    },
  ];

  return (
    <div className="landing" aria-labelledby="landing-title">
      {/* Nav */}
      <nav className="landing-nav" aria-label="Primary">
        <div className="brand" aria-label="KT-SwiftBridge">
          KT-SwiftBridge
        </div>
        <Link className="nav-login" to="/login">
          Login
        </Link>
      </nav>

      {/* Hero */}
      <header className="hero" role="banner">
        <div
          className="hero-bg"
          aria-hidden="true"
          style={{
            background: `radial-gradient(1200px 380px at 80% -10%, rgba(230,57,70,.20), transparent 60%),
            radial-gradient(900px 320px at 0% 30%, rgba(241,196,15,.18), transparent 60%),
            linear-gradient(180deg, rgba(11,37,69,.85), rgba(11,37,69,.70))`,
          }}
        />
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="chip">Built for ISPs</span>
            <h1 id="landing-title" className="hero-title">
              Smart ISP billing — automated, reliable, fast.
            </h1>
            <p className="hero-sub">
              Automate subscriptions, invoice customers, collect payments, and
              keep clients informed — all from a simple, high-performance
              dashboard.
            </p>
            <div className="hero-cta">
              <Link to="/login" className="cta">
                Login to Continue
              </Link>
              <a href="#features" className="cta ghost">
                See Features
              </a>
            </div>
            <div className="trust-row">
              <span className="trust-dot" /> Trusted by growing ISPs
            </div>
          </div>

          <aside className="hero-card" aria-label="Why SwiftBridge">
            <h3>Why SwiftBridge?</h3>
            <p>
              Streamline PPPoE and Hotspot billing with built-in notifications,
              integrated payments, and clear insights. Designed for providers
              that demand reliability and speed.
            </p>
            <ul className="hero-list">
              <li>Zero-friction STK-Push</li>
              <li>Automated dunning & reminders</li>
              <li>Actionable revenue analytics</li>
            </ul>
          </aside>
        </div>
      </header>

      {/* Features */}
      <section id="features" className="features" aria-label="Key Features">
        <h2 className="section-title">Key Features</h2>
        <div className="feature-grid">
          {features.map((f, i) => (
            <article className="feature" key={i} tabIndex={0}>
              <span className="icon" aria-hidden>
                {f.icon}
              </span>
              <div>
                <h3 className="feature-title">{f.title}</h3>
                <p className="feature-text">{f.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        Fast, reliable billing — built for ISPs.
      </footer>
    </div>
  );
}

