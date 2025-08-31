// src/utils/storage.js
const KEY_ACCESS = "access_token";
const KEY_REFRESH = "refresh_token";
const KEY_ISP = "isp_id";
const KEY_USER = "user_json";

export const storage = {
  getAccess: () => localStorage.getItem(KEY_ACCESS),
  setAccess: (t) => localStorage.setItem(KEY_ACCESS, t),
  getRefresh: () => localStorage.getItem(KEY_REFRESH),
  setRefresh: (t) => localStorage.setItem(KEY_REFRESH, t),
  getIspId: () => localStorage.getItem(KEY_ISP),
  setIspId: (id) => localStorage.setItem(KEY_ISP, id),
  getUser: () => {
    try { return JSON.parse(localStorage.getItem(KEY_USER) || "null"); }
    catch { return null; }
  },
  setUser: (u) => localStorage.setItem(KEY_USER, JSON.stringify(u || null)),
  clearAll: () => {
    localStorage.removeItem(KEY_ACCESS);
    localStorage.removeItem(KEY_REFRESH);
    localStorage.removeItem(KEY_ISP);
    localStorage.removeItem(KEY_USER);
  },
};
