import React, { useEffect, useState } from "react";
import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";
import { GiHamburgerMenu } from "react-icons/gi";
import "./App.css";

import Sidebar from "./components/Sidebar";
import ClientsModal from "./components/CustomersModal";
import ConnectMikrotikModal from "./components/ConnectMikrotik";
import HotspotSetupModal from "./components/HotspotModal";
import MessagingModal from "./components/MessagingModal";
import MikrotikTerminalModal from "./components/MikrotikTerminalModal";
import PaymentsModal from "./components/PaymentsModal";
import PaymentIntegrationModal from "./components/PaymentSetting";
import PppoeSetupModal from "./components/PppoeModal";
import SmsSettingsModal from "./components/SmsSettingsModal";
import StaticIpSetupModal from "./components/StaticIpSetupModal";
import SubscriptionPlansModal from "./components/PlanModal";
import UsageModal from "./components/UsageModal";

import { useAuth } from "./context/AuthContext";
import AccountSettings from "./pages/AccountSettings";
import AuditLogs from "./pages/AuditLogs";
import ApiKeys from "./pages/ApiKeys";
import Communications from "./pages/Communications";
import CustomerPortal from "./pages/CustomerPortal";
import Dashboard from "./pages/Dashboard";
import ForgotPassword from "./pages/ForgotPassword";
import InviteAccept from "./pages/InviteAccept";
import Jobs from "./pages/Jobs";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import NocOperations from "./pages/NocOperations";
import OperationsHealth from "./pages/OperationsHealth";
import PayLink from "./pages/PayLink";
import PlatformGatewayEvents from "./pages/PlatformGatewayEvents";
import Register from "./pages/Register";
import ResetPassword from "./pages/ResetPassword";
import Routers from "./pages/Routers";
import ServiceOperations from "./pages/ServiceOperations";
import SupportOperations from "./pages/SupportOperations";
import TeamAccess from "./pages/TeamAccess";
import "./theme.css";

export default function App() {
  const { isAuthed, authMode, role } = useAuth();
  const isPlatformAdmin = role === "platform-admin" || authMode === "platform";
  const isCustomerPortal = role === "customer" || authMode === "customer";

  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" && window.matchMedia("(min-width:1024px)").matches
  );
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop);
  useEffect(() => {
    const mq = window.matchMedia("(min-width:1024px)");
    const handler = (event) => {
      setIsDesktop(event.matches);
      setSidebarOpen(event.matches);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggleSidebar = () => setSidebarOpen((open) => !open);
  const isPayRoute =
    typeof window !== "undefined" && window.location.pathname.startsWith("/pay");
  if (isPayRoute) {
    return (
      <Router>
        <Routes>
          <Route path="/pay" element={<PayLink />} />
          <Route path="*" element={<Navigate to="/pay" replace />} />
        </Routes>
      </Router>
    );
  }

  if (!isAuthed) {
    return (
      <Router>
        <Routes>
          <Route path="/pay" element={<PayLink />} />
          <Route path="/invite/accept" element={<InviteAccept />} />
          <Route path="/portal" element={<Navigate to="/login?mode=customer" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/landing" element={<Landing />} />
          <Route path="/" element={<Landing />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </Router>
    );
  }

  return (
    <Router>
      <div className={`app-container ${sidebarOpen ? "sidebar-open" : ""}`}>
        {!isCustomerPortal ? (
          <div
            className="hamburger"
            onClick={toggleSidebar}
            role="button"
            aria-label="Toggle sidebar"
          >
            <GiHamburgerMenu />
          </div>
        ) : null}

        {!isCustomerPortal && !isDesktop && sidebarOpen ? (
          <div className="sidebar-backdrop" onClick={toggleSidebar} />
        ) : null}

        {!isCustomerPortal ? (
          <Sidebar
            open={sidebarOpen}
            toggleSidebar={toggleSidebar}
          />
        ) : null}

        <div className="content-area">
          <Routes>
            <Route path="/pay" element={<PayLink />} />
            <Route path="/invite/accept" element={<InviteAccept />} />

            {isPlatformAdmin ? (
              <>
                <Route
                  path="/"
                  element={<Navigate to="/platform/gateway-events" replace />}
                />
                <Route
                  path="/platform/gateway-events"
                  element={<PlatformGatewayEvents />}
                />
                <Route
                  path="*"
                  element={<Navigate to="/platform/gateway-events" replace />}
                />
              </>
            ) : isCustomerPortal ? (
              <>
                <Route path="/" element={<Navigate to="/portal" replace />} />
                <Route path="/portal" element={<CustomerPortal />} />
                <Route path="*" element={<Navigate to="/portal" replace />} />
              </>
            ) : (
              <>
                <Route path="/" element={<Dashboard />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/settings" element={<AccountSettings />} />
                <Route path="/routers" element={<Routers />} />
                <Route path="/jobs" element={<Jobs />} />
                <Route path="/audit-logs" element={<AuditLogs />} />
                <Route path="/api-keys" element={<ApiKeys />} />
                <Route path="/communications" element={<Communications />} />
                <Route path="/operations-health" element={<OperationsHealth />} />
                <Route path="/team-access" element={<TeamAccess />} />
                <Route path="/noc" element={<NocOperations />} />
                <Route path="/service-ops" element={<ServiceOperations />} />
                <Route path="/support-ops" element={<SupportOperations />} />
                <Route path="/customers" element={<ClientsModal standalone />} />
                <Route path="/plans" element={<SubscriptionPlansModal standalone />} />
                <Route path="/pppoe" element={<PppoeSetupModal standalone />} />
                <Route path="/hotspot" element={<HotspotSetupModal standalone />} />
                <Route path="/payments" element={<PaymentsModal standalone />} />
                <Route path="/payment-settings" element={<PaymentIntegrationModal standalone />} />
                <Route path="/mikrotik/connect" element={<ConnectMikrotikModal standalone />} />
                <Route path="/mikrotik/terminal" element={<MikrotikTerminalModal standalone />} />
                <Route path="/sms-paylinks" element={<SmsSettingsModal standalone />} />
                <Route path="/messaging" element={<MessagingModal standalone />} />
                <Route path="/static-ip" element={<StaticIpSetupModal standalone />} />
                <Route path="/usage-logs" element={<UsageModal standalone />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            )}
          </Routes>
        </div>
      </div>
    </Router>
  );
}
