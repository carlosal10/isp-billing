// src/lib/apiClient.js
import axios from "axios";

/** ================================
 *  Config
 *  ================================ */
export const API_BASE =
  process.env.REACT_APP_API_URL ||
  (typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:5000/api"
    : "https://isp-billing-server.onrender.com/api");

// Enable cookie-based auth transport so the server can fall back to cookies
// if Authorization header is briefly missing.
const USE_COOKIES = true;

/** ================================
 *  Minimal local storage helpers
 *  (kept here so api works before AuthContext mounts)
 *  ================================ */
const SESSIONS_KEY = "auth.sessions.v1";
const ACTIVE_SESSION_KEY = "auth.active.tenant";
const LAST_TENANT_KEY = "auth.last.tenant";

const safeParse = (value) => {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
};

const loadSessions = () => safeParse(localStorage.getItem(SESSIONS_KEY)) || {};

const ensureActiveTenant = (sessions) => {
  const all = sessions || loadSessions();
  let tenantId = null;
  try {
    tenantId = sessionStorage.getItem(ACTIVE_SESSION_KEY);
  } catch {}
  if (tenantId && all[tenantId]) return { tenantId, sessions: all };

  let last = null;
  try {
    last = localStorage.getItem(LAST_TENANT_KEY);
  } catch {}
  if (last && all[last]) {
    try { sessionStorage.setItem(ACTIVE_SESSION_KEY, last); } catch {}
    return { tenantId: last, sessions: all };
  }

  const keys = Object.keys(all);
  if (keys.length) {
    const first = keys[0];
    try {
      sessionStorage.setItem(ACTIVE_SESSION_KEY, first);
      localStorage.setItem(LAST_TENANT_KEY, first);
    } catch {}
    return { tenantId: first, sessions: all };
  }

  return { tenantId: null, sessions: all };
};

const getActiveSession = () => {
  const { tenantId, sessions } = ensureActiveTenant();
  if (!tenantId) return null;
  return sessions[tenantId] || null;
};

const getAccess = () => getActiveSession()?.accessToken || null;
const getIspId = () => getActiveSession()?.ispId ?? null;

/** ================================
 *  Axios instance
 *  ================================ */
export const api = axios.create({
  baseURL: API_BASE,
  // Increase default timeout to accommodate slow router-backed endpoints
  // (some MikroTik calls can take >20s under load). Individual requests
  // may still override this via config.timeout.
  timeout: 60000,
  withCredentials: USE_COOKIES, // only true if using cookies
  headers: {
    "X-Requested-With": "XMLHttpRequest",
  },
});

/** ================================
 *  Pluggable accessors (wired once by AuthContext)
 *  ================================ */
let accessors = {
  getAccessToken: () => getAccess(),
  getIspId: () => getIspId(),
  getServerId: () => null,
  tryRefresh: null,  // async () => string (newAccessToken)
  forceLogout: null, // () => void
};

export function setApiAccessors(a = {}) {
  accessors = { ...accessors, ...a };
}

/** ================================
 *  Request interceptor — attach headers
 *  ================================ */
api.interceptors.request.use((config) => {
  const token = accessors.getAccessToken?.();
  if (token) {
    // Ensure headers object exists
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  const isp = accessors.getIspId?.();
  if (isp) {
    config.headers = config.headers || {};
    config.headers["x-isp-id"] = isp;
  }
  const server = accessors.getServerId?.();
  if (server) {
    config.headers = config.headers || {};
    config.headers["x-isp-server"] = server;
  }
  return config;
});

/** ================================
 *  Refresh single-flight queue
 *  ================================ */
let isRefreshing = false;
let queue = []; // [{ resolve, reject, resume }]
const enqueue = (resume) =>
  new Promise((resolve, reject) => queue.push({ resolve, reject, resume }));
const flushQueue = (error, newToken = null) => {
  queue.forEach(({ resolve, reject, resume }) => {
    if (error) reject(error);
    else resolve(resume(newToken));
  });
  queue = [];
};

/** ================================
 *  Error shaping — keep UI messages tight
 *  ================================ */
function annotateAxiosError(err) {
  try {
    const cfg = err?.config || {};
    const method = (cfg.method || "GET").toUpperCase();
    const url = (cfg.baseURL || "") + (cfg.url || "");
    const status = err?.response?.status;
    const serverMsg =
      err?.response?.data?.error ||
      err?.response?.data?.message ||
      err?.message ||
      "Request failed";
    err.message = status ? `[${status}] ${serverMsg}` : `${serverMsg}`;
    err.__debug = {
      status,
      url,
      method,
      data: err?.response?.data,
      headers: err?.response?.headers,
    };
  } catch {}
  return err;
}

/** ================================
 *  401/419 handling + refresh
 *  ================================ */
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error?.config || {};
    const status = error?.response?.status;

    // Treat 401 (unauth) and 419/440 (session expired) similarly
    const isAuthExpired = status === 401 || status === 419 || status === 440;

    // If not auth error or we've already retried once, surface the error
    if (!isAuthExpired || original._retry) {
      throw annotateAxiosError(error);
    }

    // Never try to refresh while calling login/refresh/logout endpoints
    const url = String(original.url || "");
    if (url.includes("/auth/login") || url.includes("/auth/refresh") || url.includes("/auth/logout")) {
      throw annotateAxiosError(error);
    }

    // If a refresh is in-flight, queue and resume once done
    if (isRefreshing) {
      return enqueue((token) => {
        const headers = { ...(original.headers || {}) };
        if (token) headers.Authorization = `Bearer ${token}`;
        const retried = { ...original, headers, _retry: true };
        return api(retried);
      });
    }

    // Start a new refresh
    original._retry = true;
    isRefreshing = true;

    try {
      if (!accessors.tryRefresh) throw annotateAxiosError(error);
      const newToken = await accessors.tryRefresh();
      flushQueue(null, newToken);

      const headers = { ...(original.headers || {}) };
      if (newToken) headers.Authorization = `Bearer ${newToken}`;
      const retried = { ...original, headers };
      return api(retried);
    } catch (e) {
      flushQueue(e, null);
      // Force logout if refresh failed (session is dead)
      accessors.forceLogout && accessors.forceLogout();
      throw annotateAxiosError(e);
    } finally {
      isRefreshing = false;
    }
  }
);
