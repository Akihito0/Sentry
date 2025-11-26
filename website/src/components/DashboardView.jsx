import React, { useMemo, useState, useEffect } from 'react';
import '../css/Dashboard.css';
import logo from '../image/logo.png';
import profile from '../image/profile.png';
import { auth, db, doc, getDoc } from '../database/firebase';
import SafeBrowsing from './SafeBrowsing.jsx';
import Settings from './Settings.jsx';
import FamilyPage from './FamilyPage.jsx';
import useFlaggedReports, {
  formatRelativeTime,
  truncate,
  severityCopy,
  getSourceLabel
} from '../hooks/useFlaggedReports';

const FAMILY_MEMBERS = ['Noah Gabby', 'Jordii Cabs', 'Karlo Gon'];

const Sidebar = ({ active, setActive, isOpen, close }) => {
  const items = useMemo(() => [
    { icon: 'bx bx-home-alt-2', label: 'Overview' },
    { icon: 'bx bx-group', label: 'Family' },
    { icon: 'bx bx-shield-quarter', label: 'Safe Browsing' },
    { icon: 'bx bx-cog', label: 'Setting' },
  ], []);

  return (
    <aside className="left-section" style={{ top: isOpen ? '0' : undefined }}>
      <div className="logo">
        <button className="menu-btn" id="menu-close" onClick={close}>
          <i className='bx bx-log-out-circle'></i>
        </button>
        <img src={logo} alt="Logo" />
        <a href="#">Sentry</a>
      </div>

      <div className="sidebar">
        {items.map((item, idx) => (
          <div
            key={item.label}
            className="item"
            id={active === idx ? 'active' : undefined}
            onClick={() => setActive(idx)}
          >
            <i className={item.icon}></i>
            <a href="#">{item.label}</a>
          </div>
        ))}
      </div>
    </aside>
  );
};

const RightSection = ({ userName, openFamilyView, reportsData }) => {
  const {
    flaggedReports = [],
    loadingReports = false,
    reportError = null,
    lastSyncedAt = null,
    severityStats = {},
    refreshReports = () => {}
  } = reportsData || {};

  const topReports = useMemo(() => flaggedReports.slice(0, 3), [flaggedReports]);
  const totalAlerts = severityStats.total || flaggedReports.length;
  const flaggedTextFields = useMemo(
    () =>
      flaggedReports.map((report) =>
        `${report.category || ''} ${report.summary || ''} ${report.reason || ''}`.toLowerCase()
      ),
    [flaggedReports]
  );

  const explicitCount = useMemo(() => {
    const keywords = ['explicit', 'adult', 'sexual', 'nsfw'];
    return flaggedTextFields.filter((text) => keywords.some((keyword) => text.includes(keyword))).length;
  }, [flaggedTextFields]);

  const scamCount = useMemo(() => {
    const keywords = ['scam', 'phish', 'fraud', 'suspicious', 'spam'];
    return flaggedTextFields.filter((text) => keywords.some((keyword) => text.includes(keyword))).length;
  }, [flaggedTextFields]);

  return (
    <aside className="right-section">

      <div className="flagged-alert-card">
        <div className="flagged-alert-card-header">
          <div>
            <h4>Flagged Notifications</h4>
            <p>Live feed from the Sentry browser extension</p>
          </div>
          <button
            className="flagged-alert-refresh"
            onClick={() => refreshReports(true)}
            disabled={loadingReports}
          >
            {loadingReports ? 'Syncing…' : 'Refresh'}
          </button>
        </div>

        <div className="flagged-alert-card-meta">
          <span>
            {totalAlerts ? `${totalAlerts} alert${totalAlerts === 1 ? '' : 's'} tracked` : 'No alerts yet'}
          </span>
          {lastSyncedAt && <span>Updated {formatRelativeTime(lastSyncedAt)}</span>}
        </div>

        <div className="flagged-alert-stats">
          {['high', 'medium', 'low'].map((level) => (
            <div key={level} className={`flagged-alert-stat stat-${level}`}>
              <span>{severityCopy[level]}</span>
              <strong>{severityStats[level] || 0}</strong>
            </div>
          ))}
        </div>

        {reportError && (
          <div className="flagged-alert-error">
            {reportError}. Showing the most recent cached data.
          </div>
        )}

        <div className="flagged-alert-list">
          {loadingReports ? (
            <div className="flagged-alert-empty">Syncing flagged notifications…</div>
          ) : !topReports.length ? (
            <div className="flagged-alert-empty">No flagged notifications yet. Great job staying safe!</div>
          ) : (
            topReports.map((report, index) => {
              const key = report.id || `${report.detected_at || 'report'}-${index}`;
              const formattedCategory = (report.category || 'unsafe content').split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
              return (
                <div className="flagged-alert-item" key={key}>
                  <div className="flagged-alert-item-header">
                    <span className="flagged-alert-category">{formattedCategory}</span>
                    <span className="flagged-alert-time">{formatRelativeTime(report.detected_at)}</span>
                  </div>
                  <p className="flagged-alert-summary">
                    {truncate(report.summary || report.reason || report.content_excerpt || 'Flagged content detected', 140)}
                  </p>
                  <div className="flagged-alert-footer">
                    <a
                      href={report.page_url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {getSourceLabel(report)}
                    </a>
                    <span>{report.what_to_do || 'Review before sharing.'}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {typeof openFamilyView === 'function' && (
          <button className="flagged-alert-link" onClick={openFamilyView}>
            View full report
          </button>
        )}
      </div>
    </aside>
  );
};

const Main = ({ openMenu, userName, analyticsData = {}, familyMembers = FAMILY_MEMBERS, reportsData }) => {
  const {
    blockedWebsites = 0,
    phishingAttempts = 0,
    familyCount = familyMembers.length,
    blockedScams = 0
  } = analyticsData;

  const {
    flaggedReports = [],
    loadingReports = false,
    reportError = null,
    lastSyncedAt = null,
    severityStats = {},
    refreshReports = () => {}
  } = reportsData || {};

  const topReports = useMemo(() => flaggedReports.slice(0, 3), [flaggedReports]);
  const totalAlerts = severityStats.total || flaggedReports.length;

  const categoryStats = useMemo(() => {
    const flaggedTextFields = flaggedReports.map((report) =>
      `${report.category || ''} ${report.summary || ''} ${report.reason || ''}`.toLowerCase()
    );

    const explicitCount = flaggedTextFields.filter((text) =>
      ['explicit', 'adult', 'sexual', 'nsfw', 'inappropriate'].some((keyword) => text.includes(keyword))
    ).length;

    const scamCount = flaggedTextFields.filter((text) =>
      ['scam', 'fraud', 'suspicious', 'spam', 'lottery', 'crypto'].some((keyword) => text.includes(keyword))
    ).length;

    const phishingCount = flaggedTextFields.filter((text) =>
      ['phish', 'credential', 'login', 'password', 'bank', 'fake'].some((keyword) => text.includes(keyword))
    ).length;

    return {
      explicit: explicitCount,
      scam: scamCount,
      phishing: phishingCount
    };
  }, [flaggedReports]);

  return (
    <main>
      <header>
        <button className="menu-btn" id="menu-open" onClick={openMenu}>
          <i className='bx bx-menu'></i>
        </button>
        <h5>Hello <b>{userName}</b>, Welcome Back!</h5>
      </header>

      <div className="flagged-alert-card">
        <div className="flagged-alert-card-header">
          <div>
            <h4>Flagged Notifications</h4>
            <p>Live feed from the Sentry browser extension</p>
          </div>
          <button
            className="flagged-alert-refresh"
            onClick={() => refreshReports(true)}
            disabled={loadingReports}
          >
            {loadingReports ? 'Syncing…' : 'Refresh'}
          </button>
        </div>

        <div className="flagged-alert-card-meta">
          <span>
            {totalAlerts ? `${totalAlerts} alert${totalAlerts === 1 ? '' : 's'} tracked` : 'No alerts yet'}
          </span>
          {lastSyncedAt && <span>Updated {formatRelativeTime(lastSyncedAt)}</span>}
        </div>

        <div className="flagged-alert-stats">
          <div className="flagged-alert-stat stat-high">
            <span>Explicit</span>
            <strong>{categoryStats.explicit}</strong>
          </div>
          <div className="flagged-alert-stat stat-medium">
            <span>Scam</span>
            <strong>{categoryStats.scam}</strong>
          </div>
          <div className="flagged-alert-stat stat-low">
            <span>Phishing</span>
            <strong>{categoryStats.phishing}</strong>
          </div>
        </div>

        {reportError && (
          <div className="flagged-alert-error">
            {reportError}. Showing the most recent cached data.
          </div>
        )}

        <div className="flagged-alert-list">
          {loadingReports ? (
            <div className="flagged-alert-empty">Syncing flagged notifications…</div>
          ) : !topReports.length ? (
            <div className="flagged-alert-empty">No flagged notifications yet. Great job staying safe!</div>
          ) : (
            topReports.map((report, index) => {
              const key = report.id || `${report.detected_at || 'report'}-${index}`;
              const formattedCategory = (report.category || 'unsafe content').split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
              return (
                <div className="flagged-alert-item" key={key}>
                  <div className="flagged-alert-item-header">
                    <span className="flagged-alert-category">{formattedCategory}</span>
                    <span className="flagged-alert-time">{formatRelativeTime(report.detected_at)}</span>
                  </div>
                  <p className="flagged-alert-summary">
                    {truncate(report.summary || report.reason || report.content_excerpt || 'Flagged content detected', 140)}
                  </p>
                  <div className="flagged-alert-footer">
                    <a
                      href={report.page_url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {getSourceLabel(report)}
                    </a>
                    <span>{report.what_to_do || 'Review before sharing.'}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

    </main>
  );
};

const DashboardView = () => {
  const [active, setActive] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userName, setUserName] = useState('UserName');
  const reportsData = useFlaggedReports({ limit: 12, autoRefreshMs: 60000 });

  const analyticsData = useMemo(() => {
    const flagged = reportsData.flaggedReports || [];
    if (!flagged.length) {
      return {
        blockedWebsites: 0,
        phishingAttempts: 0,
        familyCount: FAMILY_MEMBERS.length,
        blockedScams: 0
      };
    }

    const flaggedTextFields = flagged.map(
      (report) =>
        `${report.category || ''} ${report.summary || ''} ${report.reason || ''} ${report.what_to_do || ''}`.toLowerCase()
    );

    const phishingKeywords = ['phish', 'credential', 'login', 'password', 'bank'];
    const scamKeywords = ['scam', 'fraud', 'suspicious', 'spam', 'lottery', 'crypto'];

    const phishingAttempts = flaggedTextFields.filter((text) =>
      phishingKeywords.some((keyword) => text.includes(keyword))
    ).length;

    const blockedScams = flaggedTextFields.filter((text) =>
      scamKeywords.some((keyword) => text.includes(keyword))
    ).length;

    const uniqueSources = flagged.reduce((acc, report) => {
      const label = getSourceLabel(report);
      if (label) acc.add(label.toLowerCase());
      return acc;
    }, new Set());

    return {
      blockedWebsites: uniqueSources.size || flagged.length,
      phishingAttempts,
      familyCount: FAMILY_MEMBERS.length,
      blockedScams
    };
  }, [reportsData.flaggedReports]);

  useEffect(() => {
    const fetchUserName = async () => {
      const user = auth.currentUser;
      if (user) {
        try {
          const docRef = doc(db, 'Sentry-User', user.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            setUserName(data.name || 'UserName');
          } else {
            console.warn('No user document found for:', user.uid);
          }
        } catch (error) {
          console.error('Error fetching user data:', error);
        }
      }
    };

    fetchUserName();
  }, []);

  return (
    <div className="container no-right-panel">
      <Sidebar
        active={active}
        setActive={setActive}
        isOpen={sidebarOpen}
        close={() => setSidebarOpen(false)}
      />

      {/* ✅ Render center content based on selected sidebar item */}
      <div className="main-section">
        {active === 0 && (
          <Main
            openMenu={() => setSidebarOpen(true)}
            userName={userName}
            analyticsData={analyticsData}
            familyMembers={FAMILY_MEMBERS}
            reportsData={reportsData}
          />
        )}
        {active === 1 && <FamilyPage />}
        {active === 2 && <SafeBrowsing />}
        {active === 3 && <Settings />}
      </div>
    </div>
  );
};

export default DashboardView;