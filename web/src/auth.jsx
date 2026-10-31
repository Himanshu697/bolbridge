import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setUsage(null);
      setLoading(false);
      return null;
    }
    try {
      const [me, u] = await Promise.all([api('/api/me'), api('/api/usage')]);
      setUser(me);
      setUsage(u);
      return me;
    } catch (err) {
      if (err.status === 401) setToken(null);
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      user,
      usage,
      loading,
      refresh,
      async login(email, password) {
        const res = await api('/api/auth/login', { method: 'POST', body: { email, password }, auth: false });
        setToken(res.token);
        setUser(res.user);
        await refresh();
        return res.user;
      },
      async signup(data) {
        const res = await api('/api/auth/signup', { method: 'POST', body: data, auth: false });
        setToken(res.token);
        setUser(res.user);
        await refresh();
        return res.user;
      },
      logout() {
        setToken(null);
        setUser(null);
        setUsage(null);
      },
    }),
    [user, usage, loading, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
