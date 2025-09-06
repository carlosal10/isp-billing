// src/App.jsx
import React, { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import "./App.css";
import { GiHamburgerMenu } from "react-icons/gi";

import Dashboard from "./pages/Dashboard";
import Sidebar from "./components/Sidebar";
import Login from "./pages/Login";
import PayLink from "./pages/PayLink";
import ClientsModal from "./components/CustomersModal";
import SubscriptionPlansModal from "./components/PlanModal";
import PppoeSetupModal from "./components/PppoeModal";
import HotspotSetupModal from "./components/HotspotModal";
import PaymentIntegrationModal from "./components/PaymentSetting";
import ConnectMikrotikModal from "./components/ConnectMikrotik";
import MessagingModal from "./components/MessagingModal";
import SmsSettingsModal from "./components/SmsSettingsModal";
import PaymentsModal from "./components/PaymentsModal";
import MikrotikTerminalModal from "./components/MikrotikTerminalModal";

import MODALS from "./constants/modals";
import { useAuth } from "./context/AuthContext";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import AccountSettings from "./pages/AccountSettings";

export default function App() {
  const { isAuthed, token, ispId } = useAuth();

  // Sidebar state: open on desktop, closed on mobile
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" && window.matchMedia("(min-width:1024px)").matches
  );
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop);

  useEffect(() => {
    const mq = window.matchMedia("(min-width:1024px)");
    const handler = (e) => {
      setIsDesktop(e.matches);
      setSidebarOpen(e.matches); // auto-open on desktop, auto-close on mobile
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggleSidebar = () => setSidebarOpen((s) => !s);

  // Global Modals
  const [activeModal, setActiveModal] = useState(null);
  const openModal = (modal) => { setActiveModal(modal); setSidebarOpen(false); };
  const closeModal = () => setActiveModal(null);

  // Public shell
  if (!isAuthed) {
    return (
      <Router>
        <Routes>
          <Route path="/pay" element={<PayLink />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/*" element={<Login />} />
        </Routes>
      </Router>
    );
  }

  // Authenticated shell
  return (
    <Router>
      <div className={`app-container ${sidebarOpen ? "sidebar-open" : ""}`}>
        {/* Mobile hamburger */}
        <div className="hamburger" onClick={toggleSidebar} role="button" aria-label="Toggle sidebar">
          <GiHamburgerMenu />
        </div>

        {/* Mobile backdrop when drawer open */}
        {!isDesktop && sidebarOpen && (
          <div className="sidebar-backdrop" onClick={toggleSidebar} />
        )}

        {/* Sidebar */}
        <Sidebar open={sidebarOpen} toggleSidebar={toggleSidebar} onOpenModal={openModal} />

        {/* Page content */}
        <div className="content-area">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/settings" element={<AccountSettings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>

        {/* Global Modals */}
        <ClientsModal isOpen={activeModal === MODALS.CLIENTS} onClose={closeModal} />
        <SubscriptionPlansModal isOpen={activeModal === MODALS.PLANS} onClose={closeModal} />
        <PppoeSetupModal isOpen={activeModal === MODALS.PPPOE} onClose={closeModal} />
        <HotspotSetupModal isOpen={activeModal === MODALS.HOTSPOT} onClose={closeModal} />
        <PaymentIntegrationModal
          isOpen={activeModal === MODALS.PAYMENT_INTEGRATION}
          onClose={closeModal}
          ispId={ispId}
        />
        <ConnectMikrotikModal isOpen={activeModal === MODALS.MIKROTIK} onClose={closeModal} />
        <MessagingModal isOpen={activeModal === MODALS.MESSAGING} onClose={closeModal} />
        <SmsSettingsModal isOpen={activeModal === MODALS.SMS_SETTINGS} onClose={closeModal} />
        <PaymentsModal isOpen={activeModal === MODALS.PAYMENTS} onClose={closeModal} />
        <MikrotikTerminalModal
          isOpen={activeModal === MODALS.MIKROTIK_TERMINAL}
          onClose={closeModal}
          authToken={token}
        />
      </div>
    </Router>
  );
}

