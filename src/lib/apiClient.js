// src/lib/apiClient.js
import axios from "axios";

// ---- local storage (minimal)
const KEY = "auth";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
const getAccess = () => read()?.accessToken || null;
const getIspId  = () => read()?.ispId || null;

// ---- API base URL
export const API_BASE =
  process.env.REACT_APP_API_URL ||
  (typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:5000/api"
    : "https://isp-billing-uq58.onrender.com/api");

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
  withCredentials: false,
});

// ---- pluggable accessors wired by AuthContext
let accessors = {
  getAccessToken: () => getAccess(),
  getIspId: () => getIspId(),
  tryRefresh: null,
  forceLogout: null,
};
export function setApiAccessors(a) {
  accessors = { ...accessors, ...a };
}

// ---- auth headers
api.interceptors.request.use((config) => {
  const token = accessors.getAccessToken?.();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const isp = accessors.getIspId?.();
  if (isp) config.headers["x-isp-id"] = isp;
  return config;
});

// ---- single-flight refresh queue
let isRefreshing = false;
let queue = [];
const enqueue = (cb) => new Promise((resolve, reject) => queue.push({ resolve, reject, cb }));
const flushQueue = (error, token = null) => {
  queue.forEach(({ resolve, reject, cb }) => (error ? reject(error) : resolve(cb(token))));
  queue = [];
};

// ---- shape Axios errors so UI always gets a helpful message
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
    err.message = status ? `[${status}] ${method} ${url} → ${serverMsg}` : `${method} ${url} → ${serverMsg}`;
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

// ---- 401 handling + refresh
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    if (error?.response?.status !== 401 || original?._retry) {
      throw annotateAxiosError(error);
    }
    if (original.url?.includes("/auth/login") || original.url?.includes("/auth/refresh")) {
      throw annotateAxiosError(error);
    }

    if (isRefreshing) {
      return enqueue((token) => {
        original.headers = { ...(original.headers || {}), Authorization: `Bearer ${token}` };
        original._retry = true;
        return api(original);
      });
    }

    original._retry = true;
    isRefreshing = true;
    try {
      if (!accessors.tryRefresh) throw annotateAxiosError(error);
      const newToken = await accessors.tryRefresh();
      flushQueue(null, newToken);
      original.headers = { ...(original.headers || {}), Authorization: `Bearer ${newToken}` };
      return api(original);
    } catch (e) {
      flushQueue(e, null);
      accessors.forceLogout && accessors.forceLogout();
      throw annotateAxiosError(e);
    } finally {
      isRefreshing = false;
    }
  }
);
