// src/App.js
import React, { useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import Dashboard from "./pages/Dashboard";
import Sidebar from "./components/Sidebar";

// Import Modals
import ClientsModal from "./components/CustomersModal";
import SubscriptionPlansModal from "./components/PlanModal";
import PPPoESetupModal from "./components/PppoeModal";
import HotspotSetupModal from "./components/HotspotModal";
import PaymentIntegrationsModal from "./components/PaymentSetting";
import ConnectMikrotikModal from "./components/ConnectMikrotik";
import MessagingModal from "./components/MessagingModal";
import PaymentsModal from "./components/PaymentsModal";

import "./App.css";

function App() {
  // modal states
  const [showClients, setShowClients] = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  const [showPPPoE, setShowPPPoE] = useState(false);
  const [showHotspot, setShowHotspot] = useState(false);
  const [showPayments, setShowPayments] = useState(false);
  const [showMikrotik, setShowMikrotik] = useState(false);
  const [showMessaging, setShowMessaging] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

  return (
    <Router>
      <div className="app-container">
        {/* Sidebar */}
        <Sidebar
          open={true}
          toggleSidebar={() => {}}
          onOpenClients={() => setShowClients(true)}
          onOpenPlans={() => setShowPlans(true)}
          onOpenPPPoE={() => setShowPPPoE(true)}
          onOpenHotspot={() => setShowHotspot(true)}
          onOpenPayments={() => setShowPayments(true)}
          onOpenMikrotik={() => setShowMikrotik(true)}
          onOpenMessaging={() => setShowMessaging(true)}
          onOpenPayment={() => setShowPayment(true)}
        />

        {/* Routes */}
        <div className="content-area">
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            {/* Future: invoices, payments pages can be separate */}
          </Routes>
        </div>

        {/* Modals */}
        <ClientsModal isOpen={showClients} onClose={() => setShowClients(false)} />
        <SubscriptionPlansModal isOpen={showPlans} onClose={() => setShowPlans(false)} />
        <PPPoESetupModal isOpen={showPPPoE} onClose={() => setShowPPPoE(false)} />
        <HotspotSetupModal isOpen={showHotspot} onClose={() => setShowHotspot(false)} />
        <PaymentIntegrationsModal isOpen={showPayments} onClose={() => setShowPayments(false)} />
        <ConnectMikrotikModal isOpen={showMikrotik} onClose={() => setShowMikrotik(false)} />
        <MessagingModal isOpen={showMessaging} onClose={() => setShowMessaging(false)} />
        <PaymentsModal isOpen={showPayment} onClose={() => setShowPayment(false)} />
      </div>
    </Router>
  );
}

export default App;
