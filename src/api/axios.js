import axios from "axios";
import { getToken } from "./token";

const api = axios.create({
  baseURL: "https://isp-billing-uq58.onrender.com", // adjust if needed
});

// attach token automatically
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
