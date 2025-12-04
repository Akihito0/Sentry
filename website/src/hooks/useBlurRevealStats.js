import { useCallback, useEffect, useState } from 'react';

const DEFAULT_BACKEND = 'http://localhost:8000';
const backendFromEnv = (import.meta.env?.VITE_BACKEND_URL || '').trim();
const BACKEND_BASE_URL = backendFromEnv || DEFAULT_BACKEND;

const useBlurRevealStats = ({ autoRefreshMs = 60000 } = {}) => {
  const [revealStats, setRevealStats] = useState({
    total: 0,
    categories: {},
    sources: {},
    items: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const fetchRevealStats = useCallback(async (withLoader = false) => {
    if (withLoader) setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/blur-reveals?limit=100`);
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      
      const data = await response.json();
      setRevealStats({
        total: data.total || 0,
        categories: data.categories || {},
        sources: data.sources || {},
        items: data.items || []
      });
      setLastSyncedAt(new Date().toISOString());
    } catch (err) {
      console.error('Unable to fetch blur reveal stats', err);
      setError(err.message || 'Unable to sync blur reveal statistics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRevealStats(true);

    if (autoRefreshMs > 0) {
      const interval = setInterval(() => {
        fetchRevealStats(false);
      }, autoRefreshMs);

      return () => clearInterval(interval);
    }
  }, [fetchRevealStats, autoRefreshMs]);

  return {
    revealStats,
    loading,
    error,
    lastSyncedAt,
    refreshStats: fetchRevealStats
  };
};

export default useBlurRevealStats;
