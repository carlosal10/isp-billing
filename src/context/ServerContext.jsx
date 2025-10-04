import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setApiAccessors } from '../lib/apiClient';

const Ctx = createContext({
  servers: [],
  selected: '',
  setSelected: () => {},
  reload: () => {},
});

function readSelected() {
  try { return localStorage.getItem('serverId') || ''; } catch { return ''; }
}
function writeSelected(id) {
  try { if (id) localStorage.setItem('serverId', id); else localStorage.removeItem('serverId'); } catch {}
}

export function ServerProvider({ children }) {
  const [servers, setServers] = useState([]);
  const [selected, setSelected] = useState(readSelected());

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/mikrotik/servers');
      setServers(Array.isArray(data) ? data : []);
      // auto-select primary if none
      if (!selected && Array.isArray(data) && data.length) {
        const primary = data.find(s => s.primary) || data[0];
        if (primary?.id) setSelected(primary.id);
      }
    } catch {}
  }, [selected]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { writeSelected(selected); }, [selected]);

  // feed header accessor
  useEffect(() => {
    setApiAccessors({ getServerId: () => selected || null });
  }, [selected]);

  const ctx = useMemo(() => ({ servers, selected, setSelected, reload: load }), [servers, selected, load]);
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useServer() {
  return useContext(Ctx);
}

