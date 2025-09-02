// src/context/AuthContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { jwtDecode } from "jwt-decode";
import { api, setApiAccessors } from "../lib/apiClient";

const decodeToken = (t) => { try { return jwtDecode(t); } catch { return null; } };
const msUntil = (exp) => Math.max((exp * 1000) - Date.now(), 0);
const loadPersisted = () => { try { return JSON.parse(localStorage.getItem("auth") || "null"); } catch { return null; } };
const persistAuth = (auth) => auth ? localStorage.setItem("auth", JSON.stringify(auth)) : localStorage.removeItem("auth");

// NEW: fallback builder if backend doesn't return user
const userFromToken = (token) => {
  const d = decodeToken(token);
  if (!d) return null;
  return {
    id: d.sub || d.userId || d.uid || null,
    email: d.email || d.upn || null,
    displayName: d.name || d.preferred_username || null,
  };
};

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ispId, setIspId] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const refreshTimerRef = useRef(null);

  function scheduleRefresh(decoded) {
    clearTimeout(refreshTimerRef.current);
    if (!decoded?.exp) return;
    const ms = Math.max(msUntil(decoded.exp) - 30_000, 1_000);
    refreshTimerRef.current = setTimeout(() => { refresh().catch(() => logout()); }, ms);
  }
  function clearRefreshTimer() {
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = null;
  }

  function setAuthState({ access, refresh: r, isp, usr }) {
    setAccessToken(access || null);
    setRefreshToken(r || null);
    setIspId(isp || null);

    // If caller didn't supply a user, derive from token once
    if (usr !== undefined) {
      setUser(usr);
    } else if (access) {
      setUser((prev) => prev ?? userFromToken(access));
    } else {
      setUser(null);
    }

    persistAuth(access && r ? {
      accessToken: access,
      refreshToken: r,
      ispId: isp,
      user: usr !== undefined ? usr : (access ? (user ?? userFromToken(access)) : null),
    } : null);

    const decoded = access ? decodeToken(access) : null;
    if (decoded) scheduleRefresh(decoded);
  }

  async function login({ email, password, ispId: ispOverride }) {
    const { data } = await api.post("/auth/login", { email, password, ispId: ispOverride });
    if (!data?.ok || !data?.accessToken) throw new Error(data?.error || "Login failed");
    const dec = decodeToken(data.accessToken);
    const isp = data.ispId || dec?.ispId || ispOverride;
    const fallbackUser = data.user || userFromToken(data.accessToken);   // <-- key
    setAuthState({ access: data.accessToken, refresh: data.refreshToken, isp, usr: fallbackUser });
  }

  async function register({ tenantName, displayName, email, password }) {
    const { data } = await api.post("/auth/register", { tenantName, displayName, email, password });
    if (!data?.ok || !data?.accessToken) throw new Error(data?.error || "Registration failed");
    const dec = decodeToken(data.accessToken);
    const isp = data.ispId || dec?.ispId || null;
    const fallbackUser = data.user || userFromToken(data.accessToken);   // <-- key
    setAuthState({ access: data.accessToken, refresh: data.refreshToken, isp, usr: fallbackUser });
  }

  async function refresh() {
    const r = refreshToken || loadPersisted()?.refreshToken;
    if (!r) throw new Error("No refresh token");
    const { data } = await api.post("/auth/refresh", { refreshToken: r });
    if (!data?.ok || !data?.accessToken) throw new Error(data?.error || "Refresh failed");

    const saved = loadPersisted() || {};
    const fallbackUser = saved.user || userFromToken(data.accessToken) || user || null; // <-- key
    const isp = ispId || saved.ispId || decodeToken(data.accessToken)?.ispId || null;

    setAuthState({ access: data.accessToken, refresh: r, isp, usr: fallbackUser });
    return data.accessToken;
  }

  async function logout() {
    try {
      const r = refreshToken || loadPersisted()?.refreshToken;
      if (r) await api.post("/auth/logout", { refreshToken: r });
    } catch {}
    clearRefreshTimer();
    setAuthState({ access: null, refresh: null, isp: null, usr: null });
  }

  useEffect(() => {
    // give apiClient the hooks it needs
    setApiAccessors({
      getAccessToken: () => loadPersisted()?.accessToken || null,
      getIspId: () => loadPersisted()?.ispId || null,
      tryRefresh: () => refresh(),
      forceLogout: () => logout(),
    });

    const saved = loadPersisted();
    if (saved?.accessToken && saved?.refreshToken) {
      const dec = decodeToken(saved.accessToken);
      setIspId(saved.ispId || dec?.ispId || null);
      setAccessToken(saved.accessToken);
      setRefreshToken(saved.refreshToken);
      setUser(saved.user || userFromToken(saved.accessToken)); // <-- key
      scheduleRefresh(dec);
    }
    return () => clearRefreshTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // IMPORTANT: don't require user to decide "authed"
  const isAuthed = useMemo(
    () => Boolean(accessToken || loadPersisted()?.accessToken),
    [accessToken]
  );

  const value = useMemo(
    () => ({ isAuthed, user, ispId, token: accessToken, login, register, refresh, logout }),
    [isAuthed, user, ispId, accessToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
