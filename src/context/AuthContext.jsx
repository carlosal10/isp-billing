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

const decodeToken = (t) => {
  try {
    return jwtDecode(t);
  } catch {
    return null;
  }
};
const msUntil = (exp) => Math.max(exp * 1000 - Date.now(), 0);
const loadPersisted = () => {
  try {
    return JSON.parse(localStorage.getItem("auth") || "null");
  } catch {
    return null;
  }
};
const persistAuth = (auth) =>
  auth
    ? localStorage.setItem("auth", JSON.stringify(auth))
    : localStorage.removeItem("auth");

// Fallback user builder if backend doesn’t send a user object
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

  const clearRefreshTimer = useCallback(() => {
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = null;
  }, []);

  const scheduleRefresh = useCallback(
    (decoded) => {
      clearRefreshTimer();
      if (!decoded?.exp) return;
      const ms = Math.max(msUntil(decoded.exp) - 30_000, 1_000);
      refreshTimerRef.current = setTimeout(() => {
        refresh().catch(() => logout());
      }, ms);
    },
    // refresh & logout are defined with useCallback below, but JS hoisting
    // means we still need to list them as deps to satisfy ESLint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const setAuthState = useCallback(
    ({ access, refresh: r, isp, usr }) => {
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

      const toPersist =
        access && r
          ? {
              accessToken: access,
              refreshToken: r,
              ispId: isp,
              user:
                usr !== undefined
                  ? usr
                  : access
                  ? user ?? userFromToken(access)
                  : null,
            }
          : null;
      persistAuth(toPersist);

      const decoded = access ? decodeToken(access) : null;
      if (decoded) scheduleRefresh(decoded);
    },
    [scheduleRefresh, user]
  );

  const refresh = useCallback(async () => {
    const r = refreshToken || loadPersisted()?.refreshToken;
    if (!r) throw new Error("No refresh token");
    const { data } = await api.post("/auth/refresh", { refreshToken: r });
    if (!data?.ok || !data?.accessToken)
      throw new Error(data?.error || "Refresh failed");

    const saved = loadPersisted() || {};
    const fallbackUser =
      saved.user || userFromToken(data.accessToken) || user || null;
    const isp =
      ispId || saved.ispId || decodeToken(data.accessToken)?.ispId || null;

    setAuthState({ access: data.accessToken, refresh: r, isp, usr: fallbackUser });
    return data.accessToken;
  }, [refreshToken, ispId, user, setAuthState]);

  const logout = useCallback(async () => {
    try {
      const r = refreshToken || loadPersisted()?.refreshToken;
      if (r) await api.post("/auth/logout", { refreshToken: r });
    } catch {
      // ignore network errors on logout
    }
    clearRefreshTimer();
    setAuthState({ access: null, refresh: null, isp: null, usr: null });
  }, [refreshToken, clearRefreshTimer, setAuthState]);

  const login = useCallback(
    async ({ email, password, ispId: ispOverride }) => {
      const { data } = await api.post("/auth/login", {
        email,
        password,
        ispId: ispOverride,
      });
      if (!data?.ok || !data?.accessToken)
        throw new Error(data?.error || "Login failed");
      const dec = decodeToken(data.accessToken);
      const isp = data.ispId || dec?.ispId || ispOverride;
      const fallbackUser = data.user || userFromToken(data.accessToken);
      setAuthState({
        access: data.accessToken,
        refresh: data.refreshToken,
        isp,
        usr: fallbackUser,
      });
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
      if (!data?.ok || !data?.accessToken)
        throw new Error(data?.error || "Registration failed");
      const dec = decodeToken(data.accessToken);
      const isp = data.ispId || dec?.ispId || null;
      const fallbackUser = data.user || userFromToken(data.accessToken);
      setAuthState({
        access: data.accessToken,
        refresh: data.refreshToken,
        isp,
        usr: fallbackUser,
      });
    },
    [setAuthState]
  );

  // Wire axios accessors once on mount
  useEffect(() => {
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
      setUser(saved.user || userFromToken(saved.accessToken));
      if (dec) scheduleRefresh(dec);
    }

    return () => clearRefreshTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once

  // Consider the user "authed" if we have an access token (in state or persisted)
  const isAuthed = useMemo(
    () => Boolean(accessToken || loadPersisted()?.accessToken),
    [accessToken]
  );

  // ✅ Include all functions used in the memo value to satisfy ESLint
  const value = useMemo(
    () => ({
      isAuthed,
      isAuthenticated: isAuthed, // alias for callers expecting this name
      user,
      ispId,
      token: accessToken,
      login,
      register,
      refresh,
      logout,
    }),
    [isAuthed, user, ispId, accessToken, login, register, refresh, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
