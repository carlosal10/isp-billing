// src/context/ServerContext.jsx
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState
} from "react";
import { api, setApiAccessors } from "../lib/apiClient";
import { useAuth } from "./AuthContext";

function readSelected() {
  try { return localStorage.getItem("serverId") || ""; } catch { return ""; }
}
function writeSelected(id) {
  try { id ? localStorage.setItem("serverId", id) : localStorage.removeItem("serverId"); } catch {}
}

const Ctx = createContext({
  servers: [],
  selected: "",
  setSelected: (_id) => {},
  reload: () => {},
});

export function ServerProvider({ children }) {
  const { status, ispId } = useAuth(); // ← know when auth is ready and tenant changes
  const [servers, setServers] = useState([]);
  const [selected, setSelected] = useState(readSelected());

  const load = useCallback(async () => {
    // Only fetch when authenticated and we have a tenant id
    if (status !== "auth" || !ispId) {
      setServers([]);
      return;
    }
    try {
      const { data } = await api.get("/mikrotik/servers");
      const list = Array.isArray(data) ? data : [];
      setServers(list);

      // Auto-select: prefer primary; else first; reset if previous selection vanished
      const ids = new Set(list.map(s => s.id || s._id || s.serverId));
      const currentId = selected && ids.has(selected) ? selected : "";
      if (!currentId) {
        const primary = list.find(s => s.primary || s.isPrimary);
        const first = list[0];
        const next = (primary && (primary.id || primary._id || primary.serverId))
          || (first && (first.id || first._id || first.serverId))
          || "";
        if (next) setSelected(String(next));
      }
    } catch (e) {
      // If we hit 401 due to a race, let auth layer handle refresh; just clear for now
      if ((e?.response?.status ?? 0) === 401) setServers([]);
      else console.error("Failed to load servers:", e);
    }
  }, [status, ispId, selected]);

  // Load whenever auth becomes ready or tenant changes
  useEffect(() => { load(); }, [load]);

  // Persist selection
  useEffect(() => { writeSelected(selected); }, [selected]);

  // Provide x-isp-server header to all requests (merges with existing accessors)
  useEffect(() => {
    setApiAccessors({ getServerId: () => (selected || null) });
  }, [selected]);

  const ctx = useMemo(
    () => ({ servers, selected, setSelected, reload: load }),
    [servers, selected, load]
  );

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useServer() {
  return useContext(Ctx);
}
