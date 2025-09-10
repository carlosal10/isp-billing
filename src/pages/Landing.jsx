// src/pages/Landing.jsx
import { Link } from "react-router-dom";
import { MdReceiptLong, MdSms, MdSubscriptions, MdPayments, MdInsights } from "react-icons/md";
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
    <div className="landing">
      <nav className="landing-nav">
        <div className="brand">KT-SwiftBridge</div>
        <Link className="nav-login" to="/login">Login</Link>
      </nav>

      <section className="hero">
        <div>
          <h1>Welcome to KT-SwiftBridge, your smart ISP billing solution.</h1>
          <p>Automate subscriptions, invoice customers, collect payments, and keep clients informed — all from a simple, fast dashboard.</p>
          <Link to="/login" className="cta">Login to Continue</Link>
        </div>
        <div className="hero-card">
          <h3>Why SwiftBridge?</h3>
          <p>Streamline PPPoE and Hotspot billing with built-in notifications, integrated payments, and clear insights. Designed for ISPs that want reliability and speed.</p>
        </div>
      </section>

      <section className="features">
        <h2>Key Features</h2>
        <div className="feature-grid">
          {features.map((f, i) => (
            <div className="feature" key={i}>
              <span className="icon" aria-hidden>{f.icon}</span>
              <div>
                <h4>{f.title}</h4>
                <p>{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="landing-footer">Fast, reliable billing — built for ISPs.</footer>
    </div>
  );
}
