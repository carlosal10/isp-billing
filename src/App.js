// src/App.jsx
import React, { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Sidebar from "./components/Sidebar";
import Login from "./pages/Login";

// Modals (single source of truth here)
import ClientsModal from "./components/CustomersModal";
import SubscriptionPlansModal from "./components/PlanModal";
import PppoeSetupModal from "./components/PppoeModal";
import HotspotSetupModal from "./components/HotspotModal";
import PaymentIntegrationModal from "./components/PaymentSetting";
import ConnectMikrotikModal from "./components/ConnectMikrotik";
import MessagingModal from "./components/MessagingModal";
import PaymentsModal from "./components/PaymentsModal";
import MikrotikTerminalModal from "./components/MikrotikTerminalModal";

import MODALS from "./constants/modals";
import "./App.css";
import { useAuth } from "./context/AuthContext";

export default function App() {
  const { isAuthed, token } = useAuth();

  // —— Sidebar state: open on desktop, closed on mobile
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" && window.matchMedia("(min-width:1024px)").matches
  );
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop);

  useEffect(() => {
    const mq = window.matchMedia("(min-width:1024px)");
    const handler = (e) => {
      setIsDesktop(e.matches);
      setSidebarOpen(e.matches); // auto-open desktop, auto-close mobile
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggleSidebar = () => setSidebarOpen((s) => !s);

  // —— Modals
  const [activeModal, setActiveModal] = useState(null);
  const openModal = (modal) => setActiveModal(modal);
  const closeModal = () => setActiveModal(null);

  // If not authenticated, show only the login page (no sidebar/modals)
  if (!isAuthed) {
    return (
      <Router>
        <Routes>
          <Route path="/*" element={<Login />} />
        </Routes>
      </Router>
    );
  }

  // Authenticated shell: sidebar + routes + global modals
  return (
    <Router>
      <div className="app-container">
        {/* Mobile hamburger */}
        <div
          className="hamburger"
          onClick={toggleSidebar}
          role="button"
          aria-label="Toggle sidebar"
        >
          ☰
        </div>

        {/* Mobile backdrop when drawer open */}
        {!isDesktop && sidebarOpen && (
          <div className="sidebar-backdrop" onClick={toggleSidebar} />
        )}

        {/* The ONLY Sidebar in the app */}
        <Sidebar open={sidebarOpen} toggleSidebar={toggleSidebar} onOpenModal={openModal} />

        {/* Page content */}
        <div className="content-area">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>

        {/* Global Modals (do NOT mount these inside pages) */}
        <ClientsModal
          isOpen={activeModal === MODALS.CLIENTS}
          onClose={closeModal}
        />
        <SubscriptionPlansModal
          isOpen={activeModal === MODALS.PLANS}
          onClose={closeModal}
        />
        <PppoeSetupModal
          isOpen={activeModal === MODALS.PPPOE}
          onClose={closeModal}
        />
        <HotspotSetupModal
          isOpen={activeModal === MODALS.HOTSPOT}
          onClose={closeModal}
        />
        <PaymentIntegrationModal
          isOpen={activeModal === MODALS.PAYMENT_INTEGRATION}
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
          isOpen={activeModal === MODALS.PAYMENTS}
          onClose={closeModal}
        />
        <MikrotikTerminalModal
          isOpen={activeModal === MODALS.MIKROTIK_TERMINAL}
          onClose={closeModal}
          authToken={token}   
        />
      </div>
    </Router>
  );
}
