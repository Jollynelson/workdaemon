import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { brainApi } from '../lib/brainApi';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [profile, setProfile] = useState(null);
  const [token, setToken]     = useState(() => sessionStorage.getItem('wd-token'));
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (accessToken) => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const body = await res.json();
        setUser(body.user);
        setProfile(body.profile);
        return true;
      }
    } catch {}
    return false;
  }, []);

  const storeSession = useCallback((accessToken) => {
    sessionStorage.setItem('wd-token', accessToken);
    setToken(accessToken);
  }, []);

  const clearSession = useCallback(() => {
    sessionStorage.removeItem('wd-token');
    setToken(null);
    setUser(null);
    setProfile(null);
  }, []);

  // On mount: restore session from storage or Supabase OAuth callback
  useEffect(() => {
    async function init() {
      // Check for OAuth session (after Google/GitHub redirect)
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        storeSession(session.access_token);
        // Prewarm the company GPU model the moment we have a session (non-blocking).
        brainApi.warm({ token: session.access_token }).catch(() => {});
        await fetchProfile(session.access_token);
        setLoading(false);
        return;
      }

      // Restore from sessionStorage
      const stored = sessionStorage.getItem('wd-token');
      if (stored) {
        const ok = await fetchProfile(stored);
        if (!ok) clearSession();
      }
      setLoading(false);
    }
    init();

    // Listen for OAuth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.access_token) {
        setLoading(true);
        storeSession(session.access_token);
        // Prewarm the company GPU model on sign-in (non-blocking).
        brainApi.warm({ token: session.access_token }).catch(() => {});
        await fetchProfile(session.access_token);
        setLoading(false);
      }
      if (event === 'SIGNED_OUT') clearSession();
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile, storeSession, clearSession]);

  const login = useCallback(async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      throw new Error(error || 'Login failed');
    }
    const { user: u, access_token } = await res.json();
    setLoading(true);
    storeSession(access_token);
    setUser(u);
    await fetchProfile(access_token);
    setLoading(false);
  }, [storeSession, fetchProfile]);

  const signup = useCallback(async (email, password) => {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      throw new Error(error || 'Could not create account. Please try again.');
    }
    const body = await res.json();
    if (body.requiresConfirmation) {
      throw new Error('__confirm__');
    }
    storeSession(body.access_token);
    setUser(body.user);
  }, [storeSession]);

  const loginWithGoogle = useCallback(() =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/app` },
    }), []);

  const loginWithGitHub = useCallback(() =>
    supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: `${window.location.origin}/app` },
    }), []);

  const refreshProfile = useCallback(async () => {
    const stored = sessionStorage.getItem('wd-token');
    if (stored) await fetchProfile(stored);
  }, [fetchProfile]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    clearSession();
  }, [clearSession]);

  return (
    <AuthContext.Provider value={{
      user, profile, token, loading,
      login, signup, logout,
      loginWithGoogle, loginWithGitHub,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
