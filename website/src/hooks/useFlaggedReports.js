import { useCallback, useEffect, useMemo, useState } from 'react';

const DEFAULT_BACKEND = 'http://localhost:8000';
const backendFromEnv = (import.meta.env?.VITE_BACKEND_URL || '').trim();
const BACKEND_BASE_URL = backendFromEnv || DEFAULT_BACKEND;

export const FALLBACK_FLAGGED_REPORTS = [
  {
    id: 'demo-report-1',
    category: 'potential scam',
    summary: 'Suspicious recruitment offer blocked',
    reason: 'Detected WhatsApp contact request plus guaranteed salary in message thread.',
    what_to_do: 'Ignore and report the sender if possible.',
    severity: 'high',
    detected_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    page_url: 'https://messenger.com/t/12345',
    source: 'messenger.com',
    content_excerpt: 'Congratulations! You have been selected for a remote job opportunity...'
  },
  {
    id: 'demo-report-2',
    category: 'explicit_content',
    summary: 'Explicit image blurred on instagram.com',
    reason: 'Image metadata and caption referenced explicit material.',
    what_to_do: 'Only reveal if you trust the account.',
    severity: 'medium',
    detected_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    page_url: 'https://instagram.com/p/xyz',
    source: 'instagram.com',
    content_excerpt: 'Tap to reveal blurred image…'
  }
];

export const severityCopy = {
  high: 'High',
  medium: 'Medium',
  low: 'Low'
};

export const formatRelativeTime = (timestamp) => {
  if (!timestamp) return 'just now';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60 * 1000) return 'just now';
  if (diffMs < 60 * 60 * 1000) return `${Math.floor(diffMs / (60 * 1000))}m ago`;
  if (diffMs < 24 * 60 * 60 * 1000) return `${Math.floor(diffMs / (60 * 60 * 1000))}h ago`;
  return date.toLocaleDateString();
};

export const truncate = (text = '', max = 160) => {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export const getSourceLabel = (report = {}) => {
  if (report.source) return report.source;
  if (!report.page_url) return 'Unknown source';
  try {
    const url = new URL(report.page_url);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return report.page_url;
  }
};

const buildEndpoint = (limit) => {
  const safeLimit = Math.max(1, Math.min(limit, 250));
  return `${BACKEND_BASE_URL.replace(/\/$/, '')}/flagged-events?limit=${safeLimit}`;
};

const useFlaggedReports = ({ limit = 40, autoRefreshMs = 45000 } = {}) => {
  const [flaggedReports, setFlaggedReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [reportError, setReportError] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const fetchFlaggedReports = useCallback(
    async (withLoader = false) => {
      if (withLoader) setLoadingReports(true);
      setReportError(null);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const response = await fetch(buildEndpoint(limit), {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const payload = await response.json();
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setFlaggedReports(items);
        setLastSyncedAt(new Date().toISOString());
      } catch (error) {
        console.error('Unable to fetch flagged events', error);
        const errorMsg = error.name === 'AbortError' 
          ? 'Backend connection timeout - is the server running?' 
          : error.message || 'Unable to sync flagged notifications';
        setReportError(errorMsg);
        setFlaggedReports((prev) => (prev.length ? prev : FALLBACK_FLAGGED_REPORTS));
      } finally {
        setLoadingReports(false);
      }
    },
    [limit]
  );

  useEffect(() => {
    fetchFlaggedReports(true);
  }, [fetchFlaggedReports]);

  useEffect(() => {
    if (!autoRefreshMs) return undefined;
    const intervalId = setInterval(() => {
      fetchFlaggedReports(false);
    }, autoRefreshMs);
    return () => clearInterval(intervalId);
  }, [fetchFlaggedReports, autoRefreshMs]);

  const categoryFilters = useMemo(() => {
    const unique = new Set();
    flaggedReports.forEach((report) => {
      if (report.category) {
        // Capitalize category names for display
        const formatted = report.category
          .split('_')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        unique.add(formatted);
      }
    });
    return Array.from(unique);
  }, [flaggedReports]);

  const severityStats = useMemo(() => {
    const base = { high: 0, medium: 0, low: 0, total: flaggedReports.length };
    flaggedReports.forEach((report) => {
      const key = (report.severity || 'medium').toLowerCase();
      if (base[key] !== undefined) {
        base[key] += 1;
      }
    });
    return base;
  }, [flaggedReports]);

  return {
    flaggedReports,
    loadingReports,
    reportError,
    lastSyncedAt,
    severityStats,
    categoryFilters,
    refreshReports: fetchFlaggedReports,
  };
};

export default useFlaggedReports;


