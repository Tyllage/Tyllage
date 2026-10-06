import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';
import { useAuth } from './AuthContext.jsx';

const FarmContext = createContext(null);
const ACTIVE_FARM_KEY = 'tyllage_active_farm';

/**
 * Active farm for farm-side users. The MVP UI defaults to one farm, but platform admins
 * (and future multi-farm staff) can switch. The server re-checks access on every request.
 */
export function FarmProvider({ children }) {
  const { user, isFarmSide } = useAuth();
  const [farms, setFarms] = useState([]);
  const [activeFarmId, setActiveFarmIdState] = useState(() => {
    try {
      return Number(localStorage.getItem(ACTIVE_FARM_KEY)) || null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user || !isFarmSide) {
      setFarms([]);
      return;
    }
    setLoading(true);
    api
      .get('/farms')
      .then((list) => {
        setFarms(list);
        setActiveFarmIdState((current) => (list.some((f) => f.id === current) ? current : list[0]?.id ?? null));
      })
      .finally(() => setLoading(false));
  }, [user, isFarmSide]);

  const setActiveFarmId = (id) => {
    setActiveFarmIdState(id);
    try {
      localStorage.setItem(ACTIVE_FARM_KEY, String(id));
    } catch {
      /* ignore */
    }
  };

  const value = useMemo(
    () => ({
      farms,
      farmId: activeFarmId,
      farm: farms.find((f) => f.id === activeFarmId) || null,
      setActiveFarmId,
      loading,
      refreshFarms: () => api.get('/farms').then(setFarms),
    }),
    [farms, activeFarmId, loading]
  );

  return <FarmContext.Provider value={value}>{children}</FarmContext.Provider>;
}

export const useFarm = () => useContext(FarmContext);
