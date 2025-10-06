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
const AUTH_KEY = "auth"; // { accessToken, refreshToken, ispId, user }

const safeParse = (s) => {
  try { return JSON.parse(s || "null"); } catch { return null; }
};
const loadPersisted = () => safeParse(localStorage.getItem(AUTH_KEY));
const persistAuth = (obj) => {
  if (!obj) localStorage.removeItem(AUTH_KEY);
  else localStorage.setItem(AUTH_KEY, JSON.stringify(obj));
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
      setAccessToken(access || null);
      setRefreshToken(r || null);
      setIspId(isp || null);

      if (usr !== undefined) {
        setUser(usr);
      } else if (access) {
        setUser((prev) => prev ?? userFromToken(access));
      } else {
        setUser(null);
      }

      // Persist only when we have both tokens; otherwise clear.
      if (access && r) {
        const existing = loadPersisted() || {};
        const toSave = {
          accessToken: access,
          refreshToken: r,
          ispId: isp ?? existing.ispId ?? null,
          user:
            usr !== undefined
              ? usr
              : existing.user ?? userFromToken(access) ?? null,
        };
        persistAuth(toSave);
      } else {
        persistAuth(null);
      }

      const decoded = access ? decodeToken(access) : null;
      if (decoded) scheduleRefresh(decoded);
    },
    [scheduleRefresh]
  );

  /** ---------- core ops ---------- **/
  const refresh = useCallback(async () => {
    if (inFlightRefreshRef.current) return inFlightRefreshRef.current;

    const run = (async () => {
      const r = refreshToken || loadPersisted()?.refreshToken;
      if (!r) throw new Error("No refresh token");

      const { data } = await api.post("/auth/refresh", { refreshToken: r });
      if (!data?.ok || !data?.accessToken) {
        throw new Error(data?.error || "Refresh failed");
      }

      const saved = loadPersisted() || {};
      const nextUser =
        data.user ?? saved.user ?? userFromToken(data.accessToken) ?? user ?? null;
      const dec = decodeToken(data.accessToken);
      const nextIsp = data.ispId ?? ispId ?? saved.ispId ?? dec?.ispId ?? null;
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
      const r = refreshToken || loadPersisted()?.refreshToken;
      if (r) await api.post("/auth/logout", { refreshToken: r });
    } catch {
      /* ignore network errors on logout */
    }
    clearRefreshTimer();
    setAuthState({ access: null, refresh: null, isp: null, usr: null });
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
      getAccessToken: () => loadPersisted()?.accessToken || null,
      getIspId:       () => loadPersisted()?.ispId || null,
      tryRefresh:     () => refresh(),
      forceLogout:    () => logout(),
    });

    const saved = loadPersisted();
    const haveBoth = Boolean(saved?.accessToken && saved?.refreshToken);

    (async () => {
      if (!haveBoth) {
        persistAuth(null);
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
