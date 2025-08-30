// src/hooks/useStats.js
import { useCallback, useEffect, useRef, useState } from "react";

export default function useStats({
  endpoint = "https://isp-billing-uq58.onrender.com/api/stats",
  intervalMs = 60000,
  enabled = true, // turn fetching on/off from the caller
} = {}) {
  const [stats, setStats] = useState({ totalCustomers: 0, activePlans: 0, pendingInvoices: 0 });
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const fetchOnce = useCallback(async () => {
    setLoading(true);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const r = await fetch(endpoint, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const data = await r.json();
      setStats(data || {});
      setError(null);
    } catch (e) {
      if (e.name !== "AbortError") setError(e);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    if (!enabled) return; // no-op when disabled
    let timerId;
    fetchOnce();
    if (intervalMs > 0) timerId = setInterval(fetchOnce, intervalMs);
    return () => {
      if (timerId) clearInterval(timerId);
      abortRef.current?.abort();
    };
  }, [enabled, intervalMs, fetchOnce]);

  return { stats, loading, error, refresh: fetchOnce };
}
