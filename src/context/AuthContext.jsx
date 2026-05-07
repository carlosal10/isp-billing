import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { jwtDecode } from "jwt-decode";
import { api, platformApi, portalApi, setApiAccessors } from "../lib/apiClient";

/** ---------- storage helpers ---------- **/
const SESSIONS_KEY = "auth.sessions.v1";
const ACTIVE_SESSION_KEY = "auth.active.tenant";
const LAST_TENANT_KEY = "auth.last.tenant";
const PLATFORM_SESSION_KEY = "auth.platform.v1";
const CUSTOMER_SESSION_KEY = "auth.customer.v1";
const ACTIVE_MODE_KEY = "auth.active.mode";

const safeParse = (value) => {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
};

const loadSessions = () => safeParse(localStorage.getItem(SESSIONS_KEY)) || {};
const loadPlatformSession = () => safeParse(localStorage.getItem(PLATFORM_SESSION_KEY)) || null;
const loadCustomerSession = () => safeParse(localStorage.getItem(CUSTOMER_SESSION_KEY)) || null;

const saveSessions = (sessions) => {
  try {
    if (!sessions || Object.keys(sessions).length === 0) {
      localStorage.removeItem(SESSIONS_KEY);
    } else {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    }
  } catch {}
};

const savePlatformSession = (session) => {
  try {
    if (session?.accessToken) {
      localStorage.setItem(PLATFORM_SESSION_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(PLATFORM_SESSION_KEY);
    }
  } catch {}
};

const saveCustomerSession = (session) => {
  try {
    if (session?.accessToken) {
      localStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(CUSTOMER_SESSION_KEY);
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

const setActiveMode = (mode) => {
  try {
    if (mode) {
      sessionStorage.setItem(ACTIVE_MODE_KEY, mode);
    } else {
      sessionStorage.removeItem(ACTIVE_MODE_KEY);
    }
  } catch {}
};

const getStoredActiveMode = () => {
  try {
    return sessionStorage.getItem(ACTIVE_MODE_KEY) || null;
  } catch {
    return null;
  }
};

const resolveActiveTenant = () => {
  const sessions = loadSessions();
  let tenantId = null;
  try {
    tenantId = sessionStorage.getItem(ACTIVE_SESSION_KEY);
  } catch {}
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

const getActiveTenantAuth = () => {
  const { tenantId, sessions } = resolveActiveTenant();
  if (!tenantId) return null;
  const session = sessions[tenantId];
  if (!session) return null;
  return {
    ...session,
    mode: "tenant",
    ispId: session.ispId ?? tenantId,
    tenantId,
  };
};

const getActivePlatformAuth = () => {
  const session = loadPlatformSession();
  if (!session?.accessToken) return null;
  return {
    ...session,
    mode: "platform",
  };
};

const getActiveCustomerAuth = () => {
  const session = loadCustomerSession();
  if (!session?.accessToken) return null;
  return {
    ...session,
    mode: "customer",
  };
};

const getActiveAuth = () => {
  const activeMode = getStoredActiveMode();
  const tenantAuth = getActiveTenantAuth();
  const platformAuth = getActivePlatformAuth();
  const customerAuth = getActiveCustomerAuth();

  if (activeMode === "platform" && platformAuth) return platformAuth;
  if (activeMode === "customer" && customerAuth) return customerAuth;
  if (activeMode === "tenant" && tenantAuth) return tenantAuth;
  if (tenantAuth) return tenantAuth;
  if (platformAuth) return platformAuth;
  if (customerAuth) return customerAuth;
  return null;
};

const persistTenantSession = (tenantId, payload) => {
  if (!tenantId) return;
  const sessions = loadSessions();
  sessions[tenantId] = { ...payload, ispId: payload.ispId ?? tenantId };
  saveSessions(sessions);
  setActiveTenantId(tenantId);
  setActiveMode("tenant");
};

const removeTenantSession = (tenantId) => {
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

const removePlatformSession = () => {
  savePlatformSession(null);
};

const removeCustomerSession = () => {
  saveCustomerSession(null);
};

/** ---------- token utils ---------- **/
const decodeToken = (token) => {
  try {
    return jwtDecode(token);
  } catch {
    return null;
  }
};
const msUntil = (exp) => Math.max(exp * 1000 - Date.now(), 0);

const userFromToken = (token) => {
  const decoded = decodeToken(token);
  if (!decoded) return null;
  const isPlatformAdmin = decoded.aud === "platform-admin";
  const isCustomer = decoded.aud === "customer-portal";
  return {
    id: decoded.sub || decoded.userId || decoded.uid || null,
    email: decoded.email || decoded.upn || null,
    username: decoded.username || null,
    displayName:
      decoded.customerName ||
      decoded.name ||
      decoded.username ||
      decoded.preferred_username ||
      decoded.email ||
      null,
    role: decoded.role || (isPlatformAdmin ? "platform-admin" : isCustomer ? "customer" : null),
    isPlatformAdmin,
    phone: decoded.phone || null,
    accountNumber: decoded.accountNumber || null,
    tenantName: decoded.tenantName || null,
    isSuper: Boolean(decoded.isSuper),
  };
};

const normalizePlatformUser = (user, token, fallback = null) => {
  const decodedUser = userFromToken(token) || {};
  const source = user || {};
  return {
    id: source.id || source.sub || fallback?.id || decodedUser.id || null,
    email: source.email || fallback?.email || decodedUser.email || null,
    username: source.username || source.name || fallback?.username || decodedUser.username || null,
    displayName:
      source.displayName ||
      source.username ||
      source.name ||
      fallback?.displayName ||
      fallback?.username ||
      decodedUser.displayName ||
      source.email ||
      decodedUser.email ||
      null,
    role: "platform-admin",
    isPlatformAdmin: true,
    isSuper:
      source.isSuper ??
      fallback?.isSuper ??
      decodedUser.isSuper ??
      false,
  };
};

const normalizeCustomerPortalUser = (user, token, fallback = null) => {
  const decodedUser = userFromToken(token) || {};
  const source = user || {};
  return {
    id: source.id || source.sub || fallback?.id || decodedUser.id || null,
    email: source.email || fallback?.email || decodedUser.email || null,
    phone: source.phone || fallback?.phone || decodedUser.phone || null,
    accountNumber:
      source.accountNumber || fallback?.accountNumber || decodedUser.accountNumber || null,
    tenantName: source.tenantName || fallback?.tenantName || decodedUser.tenantName || null,
    displayName:
      source.displayName ||
      source.name ||
      fallback?.displayName ||
      decodedUser.displayName ||
      source.accountNumber ||
      decodedUser.accountNumber ||
      "Customer",
    role: "customer",
    isPlatformAdmin: false,
    isSuper: false,
  };
};

/** ---------- context ---------- **/
const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState("unknown");
  const [user, setUser] = useState(null);
  const [ispId, setIspId] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);
  const [authMode, setAuthMode] = useState(null);

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
    const delay = Math.max(msUntil(decoded.exp) - 30_000, 1_000);
    refreshTimerRef.current = setTimeout(() => {
      refresh().catch(() => logout());
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAuthState = useCallback(
    ({ mode, access, refresh: nextRefresh, isp, usr }) => {
      const decoded = access ? decodeToken(access) : null;
      const activeBefore = getActiveAuth();
      const resolvedMode =
        mode ||
        activeBefore?.mode ||
        (decoded?.aud === "platform-admin" ? "platform" : "tenant");
      const tenantKey =
        resolvedMode === "tenant"
          ? isp ?? decoded?.ispId ?? activeBefore?.ispId ?? null
          : null;
      const nextUser =
        usr !== undefined
          ? usr
          : access
            ? activeBefore?.user ?? userFromToken(access) ?? null
            : null;

      setAuthMode(access ? resolvedMode : null);
      setActiveMode(access ? resolvedMode : null);
      setAccessToken(access || null);
      setRefreshToken(resolvedMode === "tenant" ? nextRefresh || null : null);
      setIspId(resolvedMode === "tenant" ? tenantKey || null : null);
      setUser(nextUser);

      if (resolvedMode === "tenant") {
        if (access && nextRefresh && tenantKey) {
          persistTenantSession(tenantKey, {
            accessToken: access,
            refreshToken: nextRefresh,
            ispId: tenantKey,
            user: nextUser,
          });
        } else if (tenantKey) {
          removeTenantSession(tenantKey);
        }
      } else if (resolvedMode === "platform") {
        if (access) {
          savePlatformSession({
            accessToken: access,
            user: nextUser,
          });
          setActiveMode("platform");
        } else {
          removePlatformSession();
        }
      } else if (resolvedMode === "customer") {
        if (access) {
          saveCustomerSession({
            accessToken: access,
            user: nextUser,
          });
          setActiveMode("customer");
        } else {
          removeCustomerSession();
        }
      }

      if (resolvedMode === "tenant" && access && decoded && nextRefresh) {
        scheduleRefresh(decoded);
      } else {
        clearRefreshTimer();
      }
    },
    [clearRefreshTimer, scheduleRefresh]
  );

  const refresh = useCallback(async () => {
    if (inFlightRefreshRef.current) return inFlightRefreshRef.current;

    const run = (async () => {
      const saved = getActiveAuth();
      if (saved?.mode !== "tenant") {
        throw new Error("Session expired");
      }
      const tokenToRefresh = refreshToken || saved?.refreshToken;
      if (!tokenToRefresh) throw new Error("No refresh token");

      const { data } = await api.post("/auth/refresh", { refreshToken: tokenToRefresh });
      if (!data?.ok || !data?.accessToken) {
        throw new Error(data?.error || "Refresh failed");
      }

      const decoded = decodeToken(data.accessToken);
      const nextUser =
        data.user ?? saved?.user ?? userFromToken(data.accessToken) ?? user ?? null;
      const nextIsp = data.ispId ?? ispId ?? saved?.ispId ?? decoded?.ispId ?? null;
      const rotatedRefresh = data.refreshToken ?? tokenToRefresh;

      setAuthState({
        mode: "tenant",
        access: data.accessToken,
        refresh: rotatedRefresh,
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
  }, [ispId, refreshToken, setAuthState, user]);

  const logout = useCallback(async () => {
    const active = getActiveAuth();
    try {
      if (active?.mode === "tenant") {
        const tokenToRefresh = refreshToken || active?.refreshToken;
        if (tokenToRefresh) {
          await api.post("/auth/logout", { refreshToken: tokenToRefresh });
        }
      } else if (active?.mode === "customer") {
        await portalApi.post("/auth/logout").catch(() => null);
      }
    } catch {
      /* ignore network errors on logout */
    }

    clearRefreshTimer();
    setAuthState({
      mode: active?.mode || authMode || null,
      access: null,
      refresh: null,
      isp: active?.ispId ?? null,
      usr: null,
    });
    setStatus("guest");
  }, [authMode, clearRefreshTimer, refreshToken, setAuthState]);

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

      const decoded = decodeToken(data.accessToken);
      const nextIsp = data.ispId ?? decoded?.ispId ?? ispOverride ?? null;
      const nextUser = data.user ?? userFromToken(data.accessToken) ?? null;

      setAuthState({
        mode: "tenant",
        access: data.accessToken,
        refresh: data.refreshToken,
        isp: nextIsp,
        usr: nextUser,
      });
      setStatus("auth");
    },
    [setAuthState]
  );

  const loginPlatform = useCallback(
    async ({ email, password }) => {
      const { data } = await platformApi.post("/auth/login", { email, password });
      if (!data?.ok || !data?.token) {
        throw new Error(data?.error || "Platform admin login failed");
      }

      const nextUser = normalizePlatformUser(data.user, data.token);
      setAuthState({
        mode: "platform",
        access: data.token,
        refresh: null,
        isp: null,
        usr: nextUser,
      });
      setStatus("auth");
    },
    [setAuthState]
  );

  const loginCustomer = useCallback(
    async ({ tenantName, accountNumber, credential, pin }) => {
      const { data } = await portalApi.post("/auth/login", {
        tenantName,
        accountNumber,
        credential,
        pin,
      });
      if (!data?.ok || !data?.token) {
        throw new Error(data?.error || "Customer portal login failed");
      }

      const nextUser = normalizeCustomerPortalUser(data.user, data.token);
      setAuthState({
        mode: "customer",
        access: data.token,
        refresh: null,
        isp: null,
        usr: nextUser,
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

      const decoded = decodeToken(data.accessToken);
      const nextIsp = data.ispId ?? decoded?.ispId ?? null;
      const nextUser = data.user ?? userFromToken(data.accessToken) ?? null;

      setAuthState({
        mode: "tenant",
        access: data.accessToken,
        refresh: data.refreshToken,
        isp: nextIsp,
        usr: nextUser,
      });
      setStatus("auth");
    },
    [setAuthState]
  );

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    setApiAccessors({
      getAccessToken: () => getActiveAuth()?.accessToken || null,
      getIspId: () => {
        const active = getActiveAuth();
        return active?.mode === "tenant" ? active?.ispId || null : null;
      },
      tryRefresh: () => {
        const active = getActiveAuth();
        if (active?.mode !== "tenant") {
          return Promise.reject(new Error("Session expired"));
        }
        return refresh();
      },
      forceLogout: () => logout(),
    });

    const saved = getActiveAuth();

    (async () => {
      if (!saved?.accessToken) {
        setStatus("guest");
        return;
      }

      if (saved.mode === "platform") {
        setAuthMode("platform");
        setAccessToken(saved.accessToken);
        setRefreshToken(null);
        setIspId(null);
        setUser(saved.user ?? normalizePlatformUser(null, saved.accessToken));

        try {
          const { data } = await platformApi.get("/auth/verify");
          if (!data?.ok) throw new Error("Platform session verification failed");
          setAuthState({
            mode: "platform",
            access: saved.accessToken,
            refresh: null,
            isp: null,
            usr: normalizePlatformUser(data.user, saved.accessToken, saved.user ?? null),
          });
          setStatus("auth");
        } catch {
          await logout();
        }
        return;
      }

      if (saved.mode === "customer") {
        setAuthMode("customer");
        setAccessToken(saved.accessToken);
        setRefreshToken(null);
        setIspId(null);
        setUser(saved.user ?? normalizeCustomerPortalUser(null, saved.accessToken));

        try {
          const { data } = await portalApi.get("/auth/verify");
          if (!data?.ok) throw new Error("Customer portal session verification failed");
          setAuthState({
            mode: "customer",
            access: saved.accessToken,
            refresh: null,
            isp: null,
            usr: normalizeCustomerPortalUser(data.user, saved.accessToken, saved.user ?? null),
          });
          setStatus("auth");
        } catch {
          await logout();
        }
        return;
      }

      const decoded = decodeToken(saved.accessToken);
      const hasRefresh = Boolean(saved.refreshToken);
      if (!hasRefresh) {
        if (saved.ispId) removeTenantSession(saved.ispId);
        setStatus("guest");
        return;
      }

      setAuthMode("tenant");
      setIspId(saved.ispId ?? decoded?.ispId ?? null);
      setAccessToken(saved.accessToken);
      setRefreshToken(saved.refreshToken);
      setUser(saved.user ?? userFromToken(saved.accessToken));

      const nearExpiry = !decoded?.exp || msUntil(decoded.exp) < 30_000;

      try {
        if (nearExpiry) {
          await refresh();
        } else {
          try {
            const { data } = await api.get("/auth/me");
            setAuthState({
              mode: "tenant",
              access: saved.accessToken,
              refresh: saved.refreshToken,
              isp: data?.ispId ?? saved.ispId ?? decoded?.ispId ?? null,
              usr: data?.user ?? saved.user ?? userFromToken(saved.accessToken) ?? null,
            });
            scheduleRefresh(decoded);
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

  const isAuthed = status === "auth";
  const role =
    user?.role ||
    (authMode === "platform" ? "platform-admin" : authMode === "customer" ? "customer" : null);
  const isPlatformAdmin = role === "platform-admin";

  const value = useMemo(
    () => ({
      status,
      isAuthed,
      isAuthenticated: isAuthed,
      user,
      role,
      authMode,
      isPlatformAdmin,
      ispId,
      token: accessToken,
      login,
      loginCustomer,
      loginPlatform,
      register,
      refresh,
      logout,
    }),
    [
      accessToken,
      authMode,
      isAuthed,
      isPlatformAdmin,
      ispId,
      login,
      loginCustomer,
      loginPlatform,
      logout,
      refresh,
      register,
      role,
      status,
      user,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
