import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore } from '../services/api.js';

const AuthContext = createContext(null);

export const FARM_SIDE_ROLES = ['platform_admin', 'farm_admin', 'farm_staff'];

export function homePathFor(user) {
  if (!user) return '/login';
  if (FARM_SIDE_ROLES.includes(user.role)) return '/farm/overview';
  if (user.role === 'business_buyer') return '/buyer/dashboard';
  return '/consumer';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) return;
    api
      .get('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onUnauthorized = () => logout();
    window.addEventListener('tyllage:unauthorized', onUnauthorized);
    return () => window.removeEventListener('tyllage:unauthorized', onUnauthorized);
  }, [logout]);

  const login = useCallback(async (email, password) => {
    const d = await api.post('/auth/login', { email, password });
    tokenStore.set(d.token);
    setUser(d.user);
    return d.user;
  }, []);

  const register = useCallback(async (payload) => {
    const d = await api.post('/auth/register', payload);
    tokenStore.set(d.token);
    setUser(d.user);
    return d.user;
  }, []);

  const value = useMemo(() => {
    const role = user?.role;
    return {
      user,
      loading,
      login,
      register,
      logout,
      isFarmSide: FARM_SIDE_ROLES.includes(role),
      isFarmAdmin: role === 'farm_admin' || role === 'platform_admin',
      isPlatformAdmin: role === 'platform_admin',
    };
  }, [user, loading, login, register, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
