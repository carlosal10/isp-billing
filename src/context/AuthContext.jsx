// src/context/AuthContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { jwtDecode } from "jwt-decode";
import { api, setApiAccessors } from "../lib/apiClient";
import { storage } from "../utils/storage";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const msUntil = (exp) => Math.max((exp * 1000) - Date.now(), 0);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(storage.getUser());
  const [ispId, setIspId] = useState(storage.getIspId());
  const [accessToken, setAccessToken] = useState(storage.getAccess());
  const [refreshToken, setRefreshToken] = useState(storage.getRefresh());
  const refreshTimer = useRef(null);

  const schedule = (token) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    if (!token) return;
    const dec = safeDecode(token);
    if (!dec?.exp) return;
    const delay = Math.max(msUntil(dec.exp) - 30_000, 1_000);
    refreshTimer.current = setTimeout(() => refresh().catch(logout), delay);
  };

  const safeDecode = (t) => { try { return jwtDecode(t); } catch { return null; } };

  // ---- core state setter
  const setAuth = ({ access, refresh, isp, usr }) => {
    setAccessToken(access || null);
    setRefreshToken(refresh || null);
    setIspId(isp || null);
    setUser(usr ?? user ?? null);
    storage.setAuth({ accessToken: access || null, refreshToken: refresh || null, ispId: isp || null, user: usr ?? user ?? null });
    schedule(access || null);
  };

  // ---- API to components
  async function login({ email, password, ispId: ispOverride }) {
    const { data } = await api.post("/auth/login", { email, password, ispId: ispOverride });
    if (!data?.ok || !data?.accessToken) throw new Error(data?.error || "Login failed");
    const dec = safeDecode(data.accessToken);
    const isp = data.ispId || dec?.ispId || ispOverride;
    setAuth({ access: data.accessToken, refresh: data.refreshToken, isp, usr: data.user || null });
  }

  async function register({ tenantName, displayName, email, password }) {
    const { data } = await api.post("/auth/register", { tenantName, displayName, email, password });
    if (!data?.ok || !data?.accessToken) throw new Error(data?.error || "Registration failed");
    const dec = safeDecode(data.accessToken);
    const isp = data.ispId || dec?.ispId || null;
    setAuth({ access: data.accessToken, refresh: data.refreshToken, isp, usr: data.user || null });
  }

  async function refresh() {
    const r = storage.getRefresh();
    if (!r) throw new Error("No refresh token");
    const { data } = await api.post("/auth/refresh", { refreshToken: r });
    if (!data?.ok || !data?.accessToken) throw new Error(data?.error || "Refresh failed");
    setAuth({ access: data.accessToken, refresh: r, isp: storage.getIspId(), usr: storage.getUser() });
    return data.accessToken;
  }

  async function logout() {
    try {
      const r = storage.getRefresh();
      if (r) await api.post("/auth/logout", { refreshToken: r });
    } catch {}
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    setAuth({ access: null, refresh: null, isp: null, usr: null });
  }

  // ---- bootstrap + set api accessors once
  useEffect(() => {
    // provide functions used by apiClient
    setApiAccessors({
      getAccessToken: () => storage.getAccess(),
      getIspId: () => storage.getIspId(),
      tryRefresh: () => refresh(),
      forceLogout: () => logout(),
    });

    // schedule refresh for existing token
    if (accessToken) schedule(accessToken);
    return () => refreshTimer.current && clearTimeout(refreshTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAuthed = !!(accessToken && user);

  return (
    <AuthContext.Provider value={{ isAuthed, user, ispId, token: accessToken, login, register, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
