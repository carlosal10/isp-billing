// src/lib/apiClient.js
import axios from "axios";
import { storage } from "../utils/storage";

const API_BASE =
  process.env.REACT_APP_API_URL ||
  import.meta?.env?.VITE_API_URL || // if you switch to Vite later
  "/api";

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
  withCredentials: false,
});

let accessors = {
  getAccessToken: () => storage.getAccess(),
  getIspId: () => storage.getIspId(),
  tryRefresh: null,   // set by AuthContext
  forceLogout: null,  // set by AuthContext
};

export function setApiAccessors(a) {
  accessors = { ...accessors, ...a };
}

// --- Attach auth headers before each request ---
api.interceptors.request.use((config) => {
  const token = accessors.getAccessToken?.();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const ispId = accessors.getIspId?.();
  if (ispId) config.headers["x-isp-id"] = ispId;
  return config;
});

// --- Single-flight refresh queue ---
let isRefreshing = false;
let queue = [];

function enqueueRequest(cb) {
  return new Promise((resolve, reject) => {
    queue.push({ resolve, reject, cb });
  });
}

function processQueue(error, token = null) {
  queue.forEach(({ resolve, reject, cb }) => {
    if (error) reject(error);
    else resolve(cb(token));
  });
  queue = [];
}

// --- Response interceptor: handle 401 ---
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error?.response?.status;

    if (status !== 401 || original?._retry) {
      return Promise.reject(error);
    }

    if (original.url?.includes("/auth/login") || original.url?.includes("/auth/refresh")) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return enqueueRequest((token) => {
        original.headers.Authorization = `Bearer ${token}`;
        original._retry = true;
        return api(original);
      });
    }

    original._retry = true;
    isRefreshing = true;
    try {
      if (!accessors.tryRefresh) throw new Error("No refresh handler");
      const newToken = await accessors.tryRefresh();
      processQueue(null, newToken);
      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);
    } catch (e) {
      processQueue(e, null);
      if (accessors.forceLogout) accessors.forceLogout();
      return Promise.reject(e);
    } finally {
      isRefreshing = false;
    }
  }
);
