// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useState, useEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// DATA FETCHING
// ─────────────────────────────────────────────────────────────────────────────

export function useFetch(url, token) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
      .then(d  => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(()=> { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url, token]);

  return { data, loading, error };
}

// Fetch from the new Brain backend (VITE_BRAIN_API_URL) when configured, else the
// legacy same-origin path. `adapt` maps the backend shape to what the UI expects.
export function useBrainFetch({ brainPath, legacyPath, adapt }, token) {
  const brainUrl = (import.meta.env.VITE_BRAIN_API_URL || '').replace(/\/$/, '');
  const url = brainUrl ? `${brainUrl}${brainPath}` : legacyPath;
  const { data, loading, error } = useFetch(url, token);
  const mapped = brainUrl && data && adapt ? adapt(data) : data;
  return { data: mapped, loading, error };
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED UI
// ─────────────────────────────────────────────────────────────────────────────

