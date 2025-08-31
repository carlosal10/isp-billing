// src/lib/apiClient.js
import axios from "axios";
import { storage } from "../utils/storage";

export const api = axios.create({
  baseURL: "https://isp-billing-uq58.onrender.com/api",
  timeout: 20000,
  withCredentials: false,
});

let accessors = {
  getAccessToken: () => storage.getAccess(),
  getIspId: () => storage.getIspId(),
  tryRefresh: null,  // set by AuthContext
  forceLogout: null, // set by AuthContext
};

export function setApiAccessors(a) {
  accessors = { ...accessors, ...a };
}

// Attach auth headers
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

// Response interceptor: handle 401
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error?.response?.status;

    // If request already retried, or endpoint is auth itself, give up
    if (status !== 401 || original?._retry) {
      // Bubble up other errors (502 RouterOS etc.)
      return Promise.reject(error);
    }

    // Avoid refresh loops on auth routes
    if (original.url?.includes("/auth/login") || original.url?.includes("/auth/refresh")) {
      return Promise.reject(error);
    }

    // Queue requests while refreshing
    if (isRefreshing) {
      return enqueueRequest((token) => {
        original.headers.Authorization = `Bearer ${token}`;
        original._retry = true;
        return api(original);
      });
    }

    // Start refresh flow
    original._retry = true;
    isRefreshing = true;
    try {
      if (!accessors.tryRefresh) throw new Error("No refresh handler");
      const newToken = await accessors.tryRefresh();
      processQueue(null, newToken);
      // replay original
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
