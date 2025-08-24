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

import MODALS from "./constants/modals";
import "./App.css";

function App() {
  const [activeModal, setActiveModal] = useState(null);

  const openModal = (modal) => setActiveModal(modal);
  const closeModal = () => setActiveModal(null);

  return (
    <Router>
      <div className="app-container">
        {/* Sidebar */}
        <Sidebar open={true} toggleSidebar={() => {}} onOpenModal={openModal} />

        {/* Routes */}
        <div className="content-area">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>

        {/* Modals */}
        <ClientsModal
          isOpen={activeModal === MODALS.CLIENTS}
          onClose={closeModal}
        />
        <SubscriptionPlansModal
          isOpen={activeModal === MODALS.PLANS}
          onClose={closeModal}
        />
        <PPPoESetupModal
          isOpen={activeModal === MODALS.PPPOE}
          onClose={closeModal}
        />
        <HotspotSetupModal
          isOpen={activeModal === MODALS.HOTSPOT}
          onClose={closeModal}
        />
        <PaymentIntegrationsModal
          isOpen={activeModal === MODALS.PAYMENTS}
          onClose={closeModal}
        />
        <ConnectMikrotikModal
          isOpen={activeModal === MODALS.MIKROTIK}
          onClose={closeModal}
        />
        <MessagingModal
          isOpen={activeModal === MODALS.MESSAGING}
          onClose={closeModal}
        />
        <PaymentsModal
          isOpen={activeModal === MODALS.PAYMENT}
          onClose={closeModal}
        />
      </div>
    </Router>
  );
}

export default App;
