// src/utils/storage.js
const KEY = "auth_v1";

function safeParse(s) {
  try { return JSON.parse(s || "{}"); } catch { return {}; }
}
function read() { return safeParse(localStorage.getItem(KEY)); }

function write(obj) {
  // Only remove when the object is truly empty/nullish
  if (!obj || (typeof obj === "object" && Object.keys(obj).length === 0)) {
    localStorage.removeItem(KEY);
  } else {
    localStorage.setItem(KEY, JSON.stringify(obj));
  }
}

/** Merge patch into existing state (atomic-ish) */
function update(patch = {}) {
  const cur = read();
  const next = { ...cur, ...patch };
  write(next);
  return next;
}

export const storage = {
  // — raw —
  getAll: read,
  setAll: write,          // keep for legacy, but avoid calling this in app code
  clear: () => localStorage.removeItem(KEY),

  // — getters —
  getAccess: () => read().accessToken ?? null,
  getRefresh: () => read().refreshToken ?? null,
  getIspId:   () => read().ispId ?? null,
  getUser:    () => read().user ?? null,

  // — granular setters (prefer these) —
  setAccess:  (accessToken) => update({ accessToken }),
  setRefresh: (refreshToken) => update({ refreshToken }),
  setIspId:   (ispId) => update({ ispId }),
  setUser:    (user) => update({ user }),

  /**
   * Merge-style setAuth.
   * Only fields explicitly provided are updated; others are preserved.
   */
  setAuth: ({ accessToken, refreshToken, ispId, user } = {}) => {
    const patch = {};
    if (accessToken !== undefined) patch.accessToken = accessToken;
    if (refreshToken !== undefined) patch.refreshToken = refreshToken;
    if (ispId !== undefined) patch.ispId = ispId;
    if (user !== undefined) patch.user = user;
    return update(patch);
  },

  /** Optional: listen for changes from other tabs/windows */
  onChange: (handler) => {
    const listener = (e) => { if (e.key === KEY) handler(read()); };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  },
};
