// src/context/AuthContext.jsx
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, setApiAccessors } from "../lib/apiClient";
import { storage } from "../utils/storage";
import { isExpired, getExpiry } from "../utils/jwt";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => storage.getUser());
  const [ispId, setIspId] = useState(() => storage.getIspId());
  const [accessToken, setAccessToken] = useState(() => storage.getAccess());
  const [refreshToken, setRefreshToken] = useState(() => storage.getRefresh());
  const refreshTimer = useRef(null);

  // Allow apiClient to call refresh/logout through context:
  useEffect(() => {
    setApiAccessors({
      getAccessToken: () => storage.getAccess(),
      getIspId: () => storage.getIspId(),
      tryRefresh: () => tryRefresh(),
      forceLogout: () => logout({ redirect: true }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleRefresh = useCallback((token) => {
    clearTimeout(refreshTimer.current);
    const expMs = getExpiry(token);
    if (!expMs) return;
    // refresh 45s before expiry to be safe
    const delay = Math.max(1_000, expMs - Date.now() - 45_000);
    refreshTimer.current = setTimeout(() => {
      tryRefresh().catch(() => logout({ redirect: true }));
    }, delay);
  }, []);

  useEffect(() => {
    if (accessToken) scheduleRefresh(accessToken);
    return () => clearTimeout(refreshTimer.current);
  }, [accessToken, scheduleRefresh]);

  const login = useCallback(async ({ email, password }) => {
    const { data } = await api.post("/auth/login", { email, password });
    // expected { ok:true, accessToken, refreshToken, user, ispId }
    if (!data?.ok) throw new Error(data?.error || "Login failed");

    storage.setAccess(data.accessToken);
    storage.setRefresh(data.refreshToken);
    storage.setUser(data.user || null);
    if (data.ispId) storage.setIspId(String(data.ispId));

    setAccessToken(data.accessToken);
    setRefreshToken(data.refreshToken);
    setUser(data.user || null);
    setIspId(data.ispId ? String(data.ispId) : null);
  }, []);

  const tryRefresh = useCallback(async () => {
    const currentRefresh = storage.getRefresh();
    if (!currentRefresh) throw new Error("No refresh token");
    const { data } = await api.post("/auth/refresh", { refreshToken: currentRefresh });
    // expected { ok:true, accessToken, refreshToken? }
    if (!data?.ok || !data?.accessToken) throw new Error(data?.error || "Refresh failed");

    storage.setAccess(data.accessToken);
    setAccessToken(data.accessToken);
    if (data.refreshToken) {
      storage.setRefresh(data.refreshToken);
      setRefreshToken(data.refreshToken);
    }
    return data.accessToken;
  }, []);

  const logout = useCallback(async ({ redirect } = {}) => {
    try {
      const rt = storage.getRefresh();
      if (rt) {
        // best-effort (don’t block UI)
        api.post("/auth/logout", { refreshToken: rt }).catch(() => {});
      }
    } finally {
      clearTimeout(refreshTimer.current);
      storage.clearAll();
      setUser(null);
      setIspId(null);
      setAccessToken(null);
      setRefreshToken(null);
      if (redirect) window.location.replace("/login");
    }
  }, []);

  const isAuthenticated = !!accessToken && !isExpired(accessToken);

  const value = {
    user,
    ispId,
    isAuthenticated,
    accessToken,
    login,
    logout,
    setTenant(tenantId) {
      storage.setIspId(String(tenantId));
      setIspId(String(tenantId));
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
