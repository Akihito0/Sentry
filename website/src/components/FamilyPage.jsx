import React, { useMemo, useState } from 'react';
import '../css/FamilyPage.css';
import useFlaggedReports, {
  formatRelativeTime,
  truncate,
  severityCopy,
  getSourceLabel
} from '../hooks/useFlaggedReports';

const FamilyPage = () => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [familyMembers, setFamilyMembers] = useState([
    { id: 1, name: 'Jordan', role: 'child', parentId: null, status: 'Offline', lastSeen: '1 hour ago' },
    { id: 2, name: 'Sarah', role: 'child', parentId: null, status: 'Offline', lastSeen: '1 hour ago' }
  ]);
  const [editingMemberId, setEditingMemberId] = useState(null);
  const [selectedRole, setSelectedRole] = useState('all');
  
  const {
    flaggedReports,
    loadingReports,
    reportError,
    lastSyncedAt,
    severityStats,
    categoryFilters,
    refreshReports
  } = useFlaggedReports();

  const filteredReports = useMemo(() => {
    if (selectedCategory === 'all') return flaggedReports;
    return flaggedReports.filter((report) => (report.category || '').toLowerCase() === selectedCategory.toLowerCase());
  }, [flaggedReports, selectedCategory]);

  const handleRoleChange = (memberId, newRole) => {
    setFamilyMembers(members =>
      members.map(member =>
        member.id === memberId
          ? { ...member, role: newRole, parentId: newRole === 'parent' ? null : member.parentId }
          : member
      )
    );
    setEditingMemberId(null);
  };

  const handleParentAssignment = (childId, parentId) => {
    setFamilyMembers(members =>
      members.map(member =>
        member.id === childId ? { ...member, parentId: parentId || null } : member
      )
    );
  };

  const filteredMembers = useMemo(() => {
    if (selectedRole === 'all') return familyMembers;
    return familyMembers.filter(member => member.role === selectedRole);
  }, [familyMembers, selectedRole]);

  const parents = useMemo(() => 
    familyMembers.filter(member => member.role === 'parent'),
    [familyMembers]
  );

  const getParentName = (parentId) => {
    const parent = familyMembers.find(m => m.id === parentId);
    return parent ? parent.name : 'None';
  };

  const categoryStats = useMemo(() => {
    const flaggedTextFields = flaggedReports.map((report) =>
      `${report.category || ''} ${report.summary || ''} ${report.reason || ''}`.toLowerCase()
    );

    const scamCount = flaggedTextFields.filter((text) =>
      ['scam', 'fraud', 'suspicious', 'spam', 'lottery', 'crypto'].some((keyword) => text.includes(keyword))
    ).length;

    const explicitCount = flaggedTextFields.filter((text) =>
      ['explicit', 'adult', 'sexual', 'nsfw', 'inappropriate'].some((keyword) => text.includes(keyword))
    ).length;

    const phishingCount = flaggedTextFields.filter((text) =>
      ['phish', 'credential', 'login', 'password', 'bank', 'fake'].some((keyword) => text.includes(keyword))
    ).length;

    return {
      scam: scamCount,
      explicit: explicitCount,
      phishing: phishingCount
    };
  }, [flaggedReports]);

  return (
    <div className="family-page">
      <div className="family-content-only-container">
        <div className="family-section-grid">

          <div className="card family-members-card">
            <div className="family-members-header">
              <h3>Family Members</h3>
              <select 
                value={selectedRole} 
                onChange={(e) => setSelectedRole(e.target.value)}
                className="role-filter"
              >
                <option value="all">All Roles</option>
                <option value="parent">Parents</option>
                <option value="child">Children</option>
              </select>
            </div>
            <div className="member-list">
              {filteredMembers.map((member) => (
                <div key={member.id} className="member-item">
                  <div className={`member-avatar avatar-${member.name.toLowerCase()}`}>
                    {member.name.charAt(0)}
                  </div>
                  <div className="member-info">
                    <div className="member-name-row">
                      <h4>{member.name}</h4>
                      <span className={`role-badge role-${member.role}`}>
                        {member.role === 'parent' ? 'Parent' : 'Child'}
                      </span>
                    </div>
                    <span>{member.status} - Last seen {member.lastSeen}</span>
                    {member.role === 'child' && member.parentId && (
                      <span className="parent-info"> Parent: {getParentName(member.parentId)}</span>
                    )}
                  </div>
                  <div className="member-actions">
                    <button 
                      className="edit-role-button"
                      onClick={() => setEditingMemberId(editingMemberId === member.id ? null : member.id)}
                    >
                      {editingMemberId === member.id ? '✕' : 'Edit Role'}
                    </button>
                    <button className="view-report-button">View Report</button>
                  </div>
                  
                  {editingMemberId === member.id && (
                    <div className="role-editor">
                      <div className="role-selector">
                        <label>Role:</label>
                        <select 
                          value={member.role}
                          onChange={(e) => handleRoleChange(member.id, e.target.value)}
                        >
                          <option value="parent">Parent</option>
                          <option value="child">Child</option>
                        </select>
                      </div>
                      
                      {member.role === 'child' && (
                        <div className="parent-selector">
                          <label>Assign to Parent:</label>
                          <select
                            value={member.parentId || ''}
                            onChange={(e) => handleParentAssignment(member.id, e.target.value ? parseInt(e.target.value) : null)}
                          >
                            <option value="">No parent assigned</option>
                            {parents.map(parent => (
                              <option key={parent.id} value={parent.id}>
                                {parent.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="card critical-alerts-card">
            <h3>Critical Alerts (Last 24h)</h3>
            <div className="alert-item">
              <span className="alert-icon">❗️</span>
              <p>
                <b>Jordan</b>: Potential Phishing Attempt™ blocked on
                <a href="http://goo.gl.scam-site" target="_blank" rel="noopener noreferrer"> goo.gl.scam-site</a>
                <span className="alert-time">13h 11min ago</span>
              </p>
              <span className="help-icon">❓</span>
            </div>

            <div className="alert-item">
              <span className="alert-icon">💬</span>
              <p>
                <b>Sarah</b>: Suspicious text detected in "Discord" from user `Unknown#9876`
                <span className="alert-time">13h 1min ago</span>
              </p>
              <span className="help-icon">❓</span>
            </div>
          </div>

          <div className="card flagged-report-card">
            <div className="flagged-report-header">
              <div>
                <h3>Flagged Content Report</h3>
                <p>Live summary of everything the browser extension has blurred.</p>
              </div>
              <div className="flagged-report-controls">
                <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
                  <option value="all">All Categories</option>
                  {categoryFilters.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <button
                  className="refresh-button"
                  onClick={() => refreshReports(true)}
                  disabled={loadingReports}
                >
                  {loadingReports ? 'Syncing…' : 'Refresh'}
                </button>
              </div>
            </div>

            <div className="flagged-report-meta">
              <span>{filteredReports.length || 0} alert{filteredReports.length === 1 ? '' : 's'} shown</span>
              {lastSyncedAt && <span>Updated {formatRelativeTime(lastSyncedAt)}</span>}
            </div>

            <div className="flagged-report-stats">
              <div className="flagged-report-stat stat-medium">
                <span>Scam</span>
                <strong>{categoryStats.scam}</strong>
              </div>
              <div className="flagged-report-stat stat-high">
                <span>Explicit</span>
                <strong>{categoryStats.explicit}</strong>
              </div>
              <div className="flagged-report-stat stat-low">
                <span>Phishing</span>
                <strong>{categoryStats.phishing}</strong>
              </div>
              <div className="flagged-report-stat stat-total">
                <span>Total</span>
                <strong>{categoryStats.scam + categoryStats.explicit + categoryStats.phishing}</strong>
              </div>
            </div>

            {reportError && (
              <div className="flagged-report-error">
                {reportError}. Showing the most recent cached data.
              </div>
            )}

            <div className="flagged-report-list">
              {loadingReports ? (
                <div className="flagged-report-empty">Syncing flagged notifications…</div>
              ) : filteredReports.length === 0 ? (
                <div className="flagged-report-empty">No flagged notifications yet. Great job staying safe!</div>
              ) : (
                filteredReports.slice(0, 5).map((report, index) => {
                  const key = report.id || `${report.detected_at || 'report'}-${index}`;
                  return (
                    <div className="flagged-report-item" key={key}>
                      <div className="flagged-report-item-header">
                        <span className="flagged-report-category">{(report.category || 'unsafe content').split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}</span>
                        <span className="flagged-report-time">{formatRelativeTime(report.detected_at)}</span>
                      </div>
                      <p className="flagged-report-summary">
                        {truncate(report.summary || report.reason || report.content_excerpt || 'Flagged content detected')}
                      </p>
                      <div className="flagged-report-footer">
                        <a
                          href={report.page_url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flagged-report-source"
                        >
                          {getSourceLabel(report)}
                        </a>
                        <span className="flagged-report-guidance">
                          {report.what_to_do || 'Review before sharing.'}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="card activity-report-card">
            <h3>Activity Report - Past 7 Days</h3>
            <div className="report-charts">
              <div className="chart-container">
                <h4>Incidents by Category</h4>
                <div className="bar-chart">
                  <div className="bar bar-tall" style={{ height: '80%' }}></div>
                  <div className="bar bar-medium" style={{ height: '60%' }}></div>
                  <div className="bar bar-short" style={{ height: '30%' }}></div>
                </div>

                <div className="chart-legend">
                  <span className="legend-item"><span className="legend-color legend-sexual"></span> Sexual (12)</span>
                  <span className="legend-item"><span className="legend-color legend-hatespeech"></span> Hate Speech</span>
                  <span className="legend-item"><span className="legend-color legend-violence"></span> Violence</span>
                </div>
              </div>

              <div className="chart-container">
                <h4>Blocked Attempts Trend</h4>
                <div className="line-chart">
                  <img src="https://via.placeholder.com/200x100/e0e7ff/666666?text=Line+Chart" alt="Blocked Attempts Trend" />
                </div>
                <div className="chart-labels">
                  <span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                </div>
              </div>
            </div>

            <div className="report-actions">
              <button className="link-button">View Full Activity Log</button>
              <div className="report-details-buttons">
                <button className="small-button">Details</button>
                <button className="small-button">Details</button>
              </div>
            </div>
          </div>


        </div>
      </div>
    </div>
  );
};

export default FamilyPage;
