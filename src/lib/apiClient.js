import axios from "axios";

/** ================================
 *  Config
 *  ================================ */
export const API_BASE =
  process.env.REACT_APP_API_URL ||
  (typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:5000/api"
    : "https://isp-billing-server.onrender.com/api");

export const PLATFORM_API_BASE = API_BASE.replace(/\/api\/?$/, "/platform-api");
export const PORTAL_API_BASE = API_BASE.replace(/\/api\/?$/, "/portal-api");

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

const getStoredActiveMode = () => {
  try {
    return sessionStorage.getItem(ACTIVE_MODE_KEY) || null;
  } catch {
    return null;
  }
};

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
    try {
      sessionStorage.setItem(ACTIVE_SESSION_KEY, last);
    } catch {}
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

const getActiveTenantSession = () => {
  const { tenantId, sessions } = ensureActiveTenant();
  if (!tenantId) return null;
  const session = sessions[tenantId] || null;
  return session ? { ...session, ispId: session.ispId ?? tenantId, tenantId } : null;
};

const getActiveSession = () => {
  const activeMode = getStoredActiveMode();
  const tenantSession = getActiveTenantSession();
  const platformSession = loadPlatformSession();
  const customerSession = loadCustomerSession();

  if (activeMode === "platform" && platformSession?.accessToken) {
    return { ...platformSession, mode: "platform" };
  }
  if (activeMode === "customer" && customerSession?.accessToken) {
    return { ...customerSession, mode: "customer" };
  }
  if (activeMode === "tenant" && tenantSession?.accessToken) {
    return { ...tenantSession, mode: "tenant" };
  }
  if (tenantSession?.accessToken) {
    return { ...tenantSession, mode: "tenant" };
  }
  if (platformSession?.accessToken) {
    return { ...platformSession, mode: "platform" };
  }
  if (customerSession?.accessToken) {
    return { ...customerSession, mode: "customer" };
  }
  return null;
};

const getAccess = () => getActiveSession()?.accessToken || null;
const getIspId = () => {
  const session = getActiveSession();
  return session?.mode === "tenant" ? session?.ispId ?? null : null;
};

/** ================================
 *  Axios instances
 *  ================================ */
function createClient(baseURL) {
  return axios.create({
    baseURL,
    timeout: 60000,
    withCredentials: USE_COOKIES,
    headers: {
      "X-Requested-With": "XMLHttpRequest",
    },
  });
}

export const api = createClient(API_BASE);
export const platformApi = createClient(PLATFORM_API_BASE);
export const portalApi = createClient(PORTAL_API_BASE);

/** ================================
 *  Pluggable accessors (wired once by AuthContext)
 *  ================================ */
let accessors = {
  getAccessToken: () => getAccess(),
  getIspId: () => getIspId(),
  getServerId: () => null,
  tryRefresh: null,
  forceLogout: null,
};

export function setApiAccessors(a = {}) {
  accessors = { ...accessors, ...a };
}

/** ================================
 *  Error shaping - keep UI messages tight
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
let isRefreshing = false;
let queue = [];
const enqueue = (resume) =>
  new Promise((resolve, reject) => queue.push({ resolve, reject, resume }));
const flushQueue = (error, newToken = null) => {
  queue.forEach(({ resolve, reject, resume }) => {
    if (error) reject(error);
    else resolve(resume(newToken));
  });
  queue = [];
};

function shouldSkipAuthRetry(url) {
  return (
    url.includes("/auth/login") ||
    url.includes("/auth/register") ||
    url.includes("/auth/refresh") ||
    url.includes("/auth/logout")
  );
}

function attachInterceptors(client, { includeTenantHeader }) {
  client.interceptors.request.use((config) => {
    const token = accessors.getAccessToken?.();
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    if (includeTenantHeader) {
      const isp = accessors.getIspId?.();
      if (isp) {
        config.headers = config.headers || {};
        config.headers["x-isp-id"] = isp;
      }
    }
    const server = accessors.getServerId?.();
    if (server) {
      config.headers = config.headers || {};
      config.headers["x-isp-server"] = server;
    }
    return config;
  });

  client.interceptors.response.use(
    (res) => res,
    async (error) => {
      const original = error?.config || {};
      const status = error?.response?.status;
      const isAuthExpired = status === 401 || status === 419 || status === 440;

      if (!isAuthExpired || original._retry) {
        throw annotateAxiosError(error);
      }

      const url = String(original.url || "");
      if (shouldSkipAuthRetry(url)) {
        throw annotateAxiosError(error);
      }

      if (isRefreshing) {
        return enqueue((token) => {
          const headers = { ...(original.headers || {}) };
          if (token) headers.Authorization = `Bearer ${token}`;
          const retried = { ...original, headers, _retry: true };
          return client(retried);
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        if (!accessors.tryRefresh) throw annotateAxiosError(error);
        const newToken = await accessors.tryRefresh();
        flushQueue(null, newToken);

        const headers = { ...(original.headers || {}) };
        if (newToken) headers.Authorization = `Bearer ${newToken}`;
        const retried = { ...original, headers };
        return client(retried);
      } catch (e) {
        flushQueue(e, null);
        accessors.forceLogout && accessors.forceLogout();
        throw annotateAxiosError(e);
      } finally {
        isRefreshing = false;
      }
    }
  );
}

attachInterceptors(api, { includeTenantHeader: true });
attachInterceptors(platformApi, { includeTenantHeader: false });
attachInterceptors(portalApi, { includeTenantHeader: false });
