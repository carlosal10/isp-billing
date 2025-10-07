// src/context/AuthContext.jsx
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { jwtDecode } from "jwt-decode";
import { api, setApiAccessors } from "../lib/apiClient";

/** ---------- storage helpers ---------- **/
const SESSIONS_KEY = "auth.sessions.v1";
const ACTIVE_SESSION_KEY = "auth.active.tenant";
const LAST_TENANT_KEY = "auth.last.tenant";

const safeParse = (s) => {
  try {
    return JSON.parse(s || "null");
  } catch {
    return null;
  }
};

const loadSessions = () => safeParse(localStorage.getItem(SESSIONS_KEY)) || {};

const saveSessions = (sessions) => {
  try {
    if (!sessions || Object.keys(sessions).length === 0) {
      localStorage.removeItem(SESSIONS_KEY);
    } else {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    }
  } catch {}
};

const setActiveTenantId = (tenantId) => {
  try {
    if (tenantId) {
      sessionStorage.setItem(ACTIVE_SESSION_KEY, tenantId);
    } else {
      sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    }
  } catch {}

  try {
    if (tenantId) {
      localStorage.setItem(LAST_TENANT_KEY, tenantId);
    }
  } catch {}
};

const resolveActiveTenant = () => {
  const sessions = loadSessions();
  let tenantId = sessionStorage.getItem(ACTIVE_SESSION_KEY);
  if (tenantId && sessions[tenantId]) return { tenantId, sessions };

  const last = localStorage.getItem(LAST_TENANT_KEY);
  if (last && sessions[last]) {
    setActiveTenantId(last);
    return { tenantId: last, sessions };
  }

  const keys = Object.keys(sessions);
  if (keys.length) {
    setActiveTenantId(keys[0]);
    return { tenantId: keys[0], sessions };
  }

  setActiveTenantId(null);
  try {
    localStorage.removeItem(LAST_TENANT_KEY);
  } catch {}
  return { tenantId: null, sessions };
};

const getActiveAuth = () => {
  const { tenantId, sessions } = resolveActiveTenant();
  if (!tenantId) return null;
  const session = sessions[tenantId];
  if (!session) return null;
  return { ...session, ispId: session.ispId ?? tenantId, tenantId };
};

const persistSession = (tenantId, payload) => {
  if (!tenantId) return;
  const sessions = loadSessions();
  sessions[tenantId] = { ...payload, ispId: payload.ispId ?? tenantId };
  saveSessions(sessions);
  setActiveTenantId(tenantId);
};

const removeSession = (tenantId) => {
  if (!tenantId) return;
  const sessions = loadSessions();
  if (sessions[tenantId]) {
    delete sessions[tenantId];
    saveSessions(sessions);
  }

  let active = null;
  try {
    active = sessionStorage.getItem(ACTIVE_SESSION_KEY);
  } catch {}
  if (active === tenantId) {
    const keys = Object.keys(sessions);
    if (keys.length) {
      setActiveTenantId(keys[0]);
    } else {
      setActiveTenantId(null);
      try {
        localStorage.removeItem(LAST_TENANT_KEY);
      } catch {}
    }
  }
};

/** ---------- token utils ---------- **/
const decodeToken = (t) => { try { return jwtDecode(t); } catch { return null; } };
const msUntil = (exp) => Math.max(exp * 1000 - Date.now(), 0);
const userFromToken = (token) => {
  const d = decodeToken(token);
  if (!d) return null;
  return {
    id: d.sub || d.userId || d.uid || null,
    email: d.email || d.upn || null,
    displayName: d.name || d.preferred_username || null,
  };
};

/** ---------- context ---------- **/
const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

/**
 * AuthProvider with:
 * - status gating: "unknown" | "auth" | "guest"
 * - strict-mode-safe init (no double side effects)
 * - proactive refresh (30s before exp) + reactive (on 401 via api client)
 * - refresh-token rotation support (persists new refreshToken from /refresh)
 */
export function AuthProvider({ children }) {
  // public state
  const [status, setStatus] = useState("unknown"); // "unknown" | "auth" | "guest"
  const [user, setUser] = useState(null);
  const [ispId, setIspId] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);

  // internals
  const refreshTimerRef = useRef(null);
  const inFlightRefreshRef = useRef(null);
  const didInitRef = useRef(false);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const scheduleRefresh = useCallback((decoded) => {
    clearRefreshTimer();
    if (!decoded?.exp) return;
    // Try to refresh 30s before expiry; never schedule in the past.
    const delay = Math.max(msUntil(decoded.exp) - 30_000, 1_000);
    refreshTimerRef.current = setTimeout(() => {
      refresh().catch(() => logout());
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAuthState = useCallback(
    ({ access, refresh: r, isp, usr }) => {
      const decoded = access ? decodeToken(access) : null;
      const activeBefore = getActiveAuth();
      const tenantKey =
        isp ??
        decoded?.ispId ??
        activeBefore?.ispId ??
        null;

      if (tenantKey) {
        setActiveTenantId(tenantKey);
      }

      setAccessToken(access || null);
      setRefreshToken(r || null);
      setIspId(tenantKey || null);

      if (usr !== undefined) {
        setUser(usr);
      } else if (access) {
        setUser((prev) => prev ?? userFromToken(access));
      } else {
        setUser(null);
      }

      if (access && r && tenantKey) {
        const existing = getActiveAuth() || activeBefore;
        const payload = {
          accessToken: access,
          refreshToken: r,
          ispId: tenantKey,
          user:
            usr !== undefined
              ? usr
              : existing?.user ?? userFromToken(access) ?? null,
        };
        persistSession(tenantKey, payload);
      } else if (tenantKey) {
        removeSession(tenantKey);
        clearRefreshTimer();
      } else {
        const active = getActiveAuth();
        if (active?.tenantId) removeSession(active.tenantId);
        clearRefreshTimer();
      }

      if (access && decoded) {
        scheduleRefresh(decoded);
      } else if (!access) {
        clearRefreshTimer();
      }
    },
    [scheduleRefresh, clearRefreshTimer]
  );

  /** ---------- core ops ---------- **/
  const refresh = useCallback(async () => {
    if (inFlightRefreshRef.current) return inFlightRefreshRef.current;

    const run = (async () => {
      const saved = getActiveAuth();
      const r = refreshToken || saved?.refreshToken;
      if (!r) throw new Error("No refresh token");

      const { data } = await api.post("/auth/refresh", { refreshToken: r });
      if (!data?.ok || !data?.accessToken) {
        throw new Error(data?.error || "Refresh failed");
      }
      const nextUser =
        data.user ?? saved?.user ?? userFromToken(data.accessToken) ?? user ?? null;
      const dec = decodeToken(data.accessToken);
      const nextIsp = data.ispId ?? ispId ?? saved?.ispId ?? dec?.ispId ?? null;
      // Rotation support: backend may return a new refresh token
      const nextRefresh = data.refreshToken ?? r;

      setAuthState({
        access: data.accessToken,
        refresh: nextRefresh,
        isp: nextIsp,
        usr: nextUser,
      });
      setStatus("auth");
      return data.accessToken;
    })();

    inFlightRefreshRef.current = run;
    try {
      return await run;
    } finally {
      inFlightRefreshRef.current = null;
    }
  }, [refreshToken, ispId, user, setAuthState]);

  const logout = useCallback(async () => {
    try {
      const saved = getActiveAuth();
      const r = refreshToken || saved?.refreshToken;
      if (r) await api.post("/auth/logout", { refreshToken: r });
    } catch {
      /* ignore network errors on logout */
    }
    clearRefreshTimer();
    const active = getActiveAuth();
    setAuthState({ access: null, refresh: null, isp: active?.ispId ?? null, usr: null });
    setStatus("guest");
  }, [refreshToken, clearRefreshTimer, setAuthState]);

  const login = useCallback(
    async ({ email, password, ispId: ispOverride }) => {
      const { data } = await api.post("/auth/login", {
        email,
        password,
        ispId: ispOverride,
      });
      if (!data?.ok || !data?.accessToken || !data?.refreshToken) {
        throw new Error(data?.error || "Login failed");
      }

      const dec = decodeToken(data.accessToken);
      const isp = data.ispId ?? dec?.ispId ?? ispOverride ?? null;
      const u = data.user ?? userFromToken(data.accessToken) ?? null;

      setAuthState({
        access: data.accessToken,
        refresh: data.refreshToken,
        isp,
        usr: u,
      });
      setStatus("auth");
    },
    [setAuthState]
  );

  const register = useCallback(
    async ({ tenantName, displayName, email, password }) => {
      const { data } = await api.post("/auth/register", {
        tenantName,
        displayName,
        email,
        password,
      });
      if (!data?.ok || !data?.accessToken || !data?.refreshToken) {
        throw new Error(data?.error || "Registration failed");
      }

      const dec = decodeToken(data.accessToken);
      const isp = data.ispId ?? dec?.ispId ?? null;
      const u = data.user ?? userFromToken(data.accessToken) ?? null;

      setAuthState({
        access: data.accessToken,
        refresh: data.refreshToken,
        isp,
        usr: u,
      });
      setStatus("auth");
    },
    [setAuthState]
  );

  /** ---------- mount/bootstrap ---------- **/
  useEffect(() => {
    if (didInitRef.current) return; // StrictMode-safe
    didInitRef.current = true;

    // Wire axios accessors once (used by interceptors for auth headers/refresh)
    setApiAccessors({
      getAccessToken: () => getActiveAuth()?.accessToken || null,
      getIspId:       () => getActiveAuth()?.ispId || null,
      tryRefresh:     () => refresh(),
      forceLogout:    () => logout(),
    });

    const saved = getActiveAuth();
    const haveBoth = Boolean(saved?.accessToken && saved?.refreshToken);

    (async () => {
      if (!haveBoth) {
        if (saved?.ispId) removeSession(saved.ispId);
        setStatus("guest");
        return;
      }

      const dec = decodeToken(saved.accessToken);
      setIspId(saved.ispId ?? dec?.ispId ?? null);
      setAccessToken(saved.accessToken);
      setRefreshToken(saved.refreshToken);
      setUser(saved.user ?? userFromToken(saved.accessToken));

      const nearExpiry = !dec?.exp || msUntil(dec.exp) < 30_000;

      try {
        if (nearExpiry) {
          await refresh(); // sets status to "auth" on success
        } else {
          // quick validation; if it fails, try refresh; else mark auth
          try {
            await api.get("/auth/me");
            scheduleRefresh(dec);
            setStatus("auth");
          } catch {
            await refresh();
          }
        }
      } catch {
        await logout();
      }
    })();

    return () => clearRefreshTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ---------- value ---------- **/
  const isAuthed = status === "auth";
  const value = useMemo(
    () => ({
      status,
      isAuthed,
      isAuthenticated: isAuthed, // alias for convenience
      user,
      ispId,
      token: accessToken,
      login,
      register,
      refresh,
      logout,
    }),
    [status, isAuthed, user, ispId, accessToken, login, register, refresh, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
