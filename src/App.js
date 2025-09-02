// src/App.jsx
import React, { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import Dashboard from "./pages/Dashboard";
import Sidebar from "./components/Sidebar";
import Login from "./pages/Login";
import Register from "./pages/Register";

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
import { useAuth } from "./context/AuthContext";

// A tiny protected layout that renders the app chrome (sidebar, modals)
// only when authed. Public routes (login/register) bypass this.
function ProtectedAppShell() {
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" && window.matchMedia("(min-width:1024px)").matches
  );
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop);
  const [activeModal, setActiveModal] = useState(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width:1024px)");
    const handler = (e) => {
      setIsDesktop(e.matches);
      setSidebarOpen(e.matches);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggleSidebar = () => setSidebarOpen((s) => !s);
  const openModal = (m) => setActiveModal(m);
  const closeModal = () => setActiveModal(null);

  return (
    <div className="app-container">
      {/* Mobile hamburger */}
      <div className="hamburger" onClick={toggleSidebar} role="button" aria-label="Toggle sidebar">
        ☰
      </div>

      {/* Mobile backdrop when drawer open */}
      {!isDesktop && sidebarOpen && <div className="sidebar-backdrop" onClick={toggleSidebar} />}

      {/* The ONLY Sidebar in the app */}
      <Sidebar open={sidebarOpen} toggleSidebar={toggleSidebar} onOpenModal={openModal} />

      {/* Page content (protected routes only) */}
      <div className="content-area">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>

      {/* Global Modals */}
      <ClientsModal isOpen={activeModal === MODALS.CLIENTS} onClose={closeModal} />
      <SubscriptionPlansModal isOpen={activeModal === MODALS.PLANS} onClose={closeModal} />
      <PppoeSetupModal isOpen={activeModal === MODALS.PPPOE} onClose={closeModal} />
      <HotspotSetupModal isOpen={activeModal === MODALS.HOTSPOT} onClose={closeModal} />
      <PaymentIntegrationModal isOpen={activeModal === MODALS.PAYMENT_INTEGRATION} onClose={closeModal} />
      <ConnectMikrotikModal isOpen={activeModal === MODALS.MIKROTIK} onClose={closeModal} />
      <MessagingModal isOpen={activeModal === MODALS.MESSAGING} onClose={closeModal} />
      <PaymentsModal isOpen={activeModal === MODALS.PAYMENTS} onClose={closeModal} />
      <MikrotikTerminalModal isOpen={activeModal === MODALS.MIKROTIK_TERMINAL} onClose={closeModal} />
    </div>
  );
}

function ProtectedRouteElement({ children }) {
  const { hydrated, isAuthed } = useAuth(); // make sure AuthContext exposes these
  if (!hydrated) return null;               // or a spinner if you like
  return isAuthed ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Router>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Protected app shell */}
        <Route
          path="/*"
          element={
            <ProtectedRouteElement>
              <ProtectedAppShell />
            </ProtectedRouteElement>
          }
        />
      </Routes>
    </Router>
  );
}
