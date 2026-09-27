// src/context/ServerContext.jsx
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState
} from "react";
import { api, setApiAccessors } from "../lib/apiClient";
import { useAuth } from "./AuthContext";

const SERVER_SELECTION_PREFIX = "serverId:";

export function readSelectedServerId(tenantId) {
  if (!tenantId) return "";
  try {
    return localStorage.getItem(`${SERVER_SELECTION_PREFIX}${String(tenantId)}`) || "";
  } catch {
    return "";
  }
}

export function writeSelectedServerId(tenantId, id) {
  if (!tenantId) return;
  try {
    const key = `${SERVER_SELECTION_PREFIX}${String(tenantId)}`;
    if (id) localStorage.setItem(key, String(id));
    else localStorage.removeItem(key);
  } catch {}
}

function serverIdOf(server) {
  const id = server?.id || server?._id || server?.serverId || "";
  return id ? String(id) : "";
}

const Ctx = createContext({
  servers: [],
  selected: "",
  setSelected: (_id) => {},
  reload: () => {},
});

export function ServerProvider({ children }) {
  const { status, ispId } = useAuth(); // ← know when auth is ready and tenant changes
  const activeTenant = status === "auth" && ispId ? String(ispId) : null;
  const activeTenantRef = useRef(activeTenant);
  activeTenantRef.current = activeTenant;
  const [servers, setServers] = useState([]);
  const [selection, setSelection] = useState({ tenantId: null, id: "" });
  const selected = activeTenant && selection.tenantId === activeTenant ? selection.id : "";

  const setSelected = useCallback((id) => {
    const tenantId = ispId ? String(ispId) : null;
    const nextId = id ? String(id) : "";
    setSelection({ tenantId, id: nextId });
    writeSelectedServerId(tenantId, nextId);
  }, [ispId]);

  const load = useCallback(async () => {
    // Only fetch when authenticated and we have a tenant id
    if (status !== "auth" || !ispId) {
      setServers([]);
      return;
    }
    try {
      const { data } = await api.get("/mikrotik/servers");
      if (activeTenantRef.current !== String(ispId)) return;
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.servers)
          ? data.servers
          : [];
      setServers(list);

      // Auto-select a valid server for this tenant. Never carry an ID across tenants.
      const ids = new Set(list.map(serverIdOf).filter(Boolean));
      const storedId = readSelectedServerId(ispId);
      const currentId = selected && ids.has(selected)
        ? selected
        : storedId && ids.has(String(storedId))
          ? String(storedId)
          : "";
      if (currentId) {
        if (currentId !== selected) setSelected(currentId);
      } else {
        const primary = list.find(s => s.primary || s.isPrimary);
        const first = list[0];
        const next = serverIdOf(primary) || serverIdOf(first);
        setSelected(next);
      }
    } catch (e) {
      if (activeTenantRef.current !== String(ispId)) return;
      // If we hit 401 due to a race, let auth layer handle refresh; just clear for now
      if ((e?.response?.status ?? 0) === 401) setServers([]);
      else console.error("Failed to load servers:", e);
    }
  }, [status, ispId, selected, setSelected]);

  // Provide x-isp-server header to all requests (merges with existing accessors)
  useEffect(() => {
    setApiAccessors({ getServerId: () => (selected || null) });
  }, [selected]);

  // Load whenever auth becomes ready, the tenant changes, or the selection changes.
  // This effect follows the accessor reset above so a tenant switch cannot send
  // the previous tenant's server ID on the first request for the new tenant.
  useEffect(() => { load(); }, [load]);

  const ctx = useMemo(
    () => ({ servers, selected, setSelected, reload: load }),
    [servers, selected, setSelected, load]
  );

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useServer() {
  return useContext(Ctx);
}
