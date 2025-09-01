// src/utils/storage.js
const KEY = "auth";

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
  catch { return {}; }
}
function write(obj) {
  if (!obj) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(obj));
}

export const storage = {
  getAll: read,
  setAll: write,
  clear: () => localStorage.removeItem(KEY),
  getAccess: () => read().accessToken || null,
  getRefresh: () => read().refreshToken || null,
  getIspId: () => read().ispId || null,
  getUser: () => read().user || null,
  setAuth: ({ accessToken, refreshToken, ispId, user }) =>
    write({ accessToken, refreshToken, ispId, user }),
};
