import React, { useMemo, useState, useEffect } from 'react';
import '../css/FamilyPage.css';
import useFlaggedReports, {
  formatRelativeTime,
  truncate,
  severityCopy,
  getSourceLabel
} from '../hooks/useFlaggedReports';
import {
  db,
  auth,
  collection,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  onSnapshot
} from '../database/firebase';

const FamilyPage = () => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [familyMembers, setFamilyMembers] = useState([]);
  const [editingMemberId, setEditingMemberId] = useState(null);
  const [selectedRole, setSelectedRole] = useState('all');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [activityLogs, setActivityLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [showFamilyId, setShowFamilyId] = useState(false);
  const [copiedFamilyId, setCopiedFamilyId] = useState(false);

  // Get current user's family ID (using their UID as family identifier)
  const currentUser = auth.currentUser;
  const familyId = currentUser?.uid;

  // Fetch activity logs from backend
  const fetchActivityLogs = async () => {
    if (!familyId) return;
    
    setLoadingLogs(true);
    try {
      const response = await fetch(`http://localhost:8000/activity-logs/${familyId}?limit=50`);
      if (response.ok) {
        const data = await response.json();
        const logs = data.logs || [];
        setActivityLogs(logs);
        
        // Auto-add members who appear in logs but aren't in the family yet
        autoAddNewMembers(logs);
      }
    } catch (error) {
      console.error('Error fetching activity logs:', error);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Automatically add new members discovered from activity logs
  const autoAddNewMembers = async (logs) => {
    if (!familyId || !logs.length) return;
    
    // Get unique emails from logs
    const logEmails = [...new Set(logs.map(log => log.userEmail?.toLowerCase()).filter(Boolean))];
    
    // Get current member emails from Firestore (fresh query to avoid race conditions)
    try {
      const membersRef = collection(db, 'families', familyId, 'members');
      const snapshot = await getDocs(membersRef);
      const existingEmails = snapshot.docs.map(doc => doc.data().email?.toLowerCase());
      
      // Find emails that are in logs but not in members
      const newEmails = logEmails.filter(email => 
        email !== 'unknown' && !existingEmails.includes(email)
      );
      
      // Add each new member (only if not already exists)
      for (const email of newEmails) {
        // Double-check this email doesn't exist (query by email)
        const existingQuery = query(membersRef, where('email', '==', email));
        const existingDocs = await getDocs(existingQuery);
        
        if (existingDocs.empty) {
          await addDoc(membersRef, {
            email: email,
            name: email.split('@')[0],
            role: 'child',
            parentId: null,
            status: 'Online',
            lastSeen: new Date().toISOString(),
            addedAt: new Date().toISOString(),
            addedBy: 'auto-detected',
            autoAdded: true
          });
          console.log('Auto-added family member:', email);
        }
      }
    } catch (error) {
      console.error('Error in autoAddNewMembers:', error);
    }
  };

  // Fetch logs on mount and periodically
  useEffect(() => {
    fetchActivityLogs();
    const interval = setInterval(fetchActivityLogs, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [familyId]);

  // Copy Family ID to clipboard
  const copyFamilyId = () => {
    if (familyId) {
      navigator.clipboard.writeText(familyId);
      setCopiedFamilyId(true);
      setTimeout(() => setCopiedFamilyId(false), 2000);
    }
  };

  // Fetch family members from Firestore
  useEffect(() => {
    if (!familyId) {
      setLoadingMembers(false);
      return;
    }

    const membersRef = collection(db, 'families', familyId, 'members');
    const unsubscribe = onSnapshot(membersRef, (snapshot) => {
      const members = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        lastSeen: doc.data().lastSeen || 'Never'
      }));
      setFamilyMembers(members);
      setLoadingMembers(false);
    }, (error) => {
      console.error('Error fetching family members:', error);
      setLoadingMembers(false);
    });

    return () => unsubscribe();
  }, [familyId]);

  // Add new family member to Firestore
  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!newMemberEmail.trim() || !familyId) return;

    setAddingMember(true);
    try {
      const membersRef = collection(db, 'families', familyId, 'members');
      await addDoc(membersRef, {
        email: newMemberEmail.trim().toLowerCase(),
        name: newMemberName.trim() || newMemberEmail.split('@')[0],
        role: 'child',
        parentId: null,
        status: 'Offline',
        lastSeen: 'Never',
        addedAt: new Date().toISOString(),
        addedBy: currentUser.email
      });
      setNewMemberEmail('');
      setNewMemberName('');
      setShowAddForm(false);
    } catch (error) {
      console.error('Error adding family member:', error);
      alert('Failed to add family member. Please try again.');
    } finally {
      setAddingMember(false);
    }
  };

  // Remove family member from Firestore
  const handleRemoveMember = async (memberId) => {
    if (!familyId || !window.confirm('Are you sure you want to remove this member?')) return;

    try {
      const memberRef = doc(db, 'families', familyId, 'members', memberId);
      await deleteDoc(memberRef);
    } catch (error) {
      console.error('Error removing family member:', error);
      alert('Failed to remove family member. Please try again.');
    }
  };
  
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

  const handleRoleChange = async (memberId, newRole) => {
    if (!familyId) return;
    
    try {
      const memberRef = doc(db, 'families', familyId, 'members', memberId);
      await updateDoc(memberRef, {
        role: newRole,
        parentId: newRole === 'parent' ? null : familyMembers.find(m => m.id === memberId)?.parentId
      });
      setEditingMemberId(null);
    } catch (error) {
      console.error('Error updating role:', error);
      alert('Failed to update role. Please try again.');
    }
  };

  const handleParentAssignment = async (childId, parentId) => {
    if (!familyId) return;
    
    try {
      const memberRef = doc(db, 'families', familyId, 'members', childId);
      await updateDoc(memberRef, {
        parentId: parentId || null
      });
    } catch (error) {
      console.error('Error assigning parent:', error);
      alert('Failed to assign parent. Please try again.');
    }
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

          {/* Family ID Card - Share with family members */}
          <div className="card family-id-card">
            <h3>🔗 Family ID</h3>
            <p className="card-description">Share this ID with family members so their browser activity syncs here.</p>
            
            <div className="family-id-display">
              <code className={showFamilyId ? 'visible' : 'hidden'}>
                {showFamilyId ? familyId : '••••••••••••••••••••'}
              </code>
              <div className="family-id-actions">
                <button onClick={() => setShowFamilyId(!showFamilyId)}>
                  {showFamilyId ? '👁️ Hide' : '👁️ Show'}
                </button>
                <button onClick={copyFamilyId} className={copiedFamilyId ? 'copied' : ''}>
                  {copiedFamilyId ? '✓ Copied!' : '📋 Copy'}
                </button>
              </div>
            </div>
            <p className="family-id-hint">
              Family members enter this ID in the Sentry browser extension (👤 tab) to sync their activity.
            </p>
          </div>

          <div className="card family-members-card">
            <div className="family-members-header">
              <h3>Family Members</h3>
              <div className="header-controls">
                <button 
                  className="add-member-btn"
                  onClick={() => setShowAddForm(!showAddForm)}
                >
                  {showAddForm ? '✕ Cancel' : '+ Add Member'}
                </button>
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
            </div>

            {showAddForm && (
              <form className="add-member-form" onSubmit={handleAddMember}>
                <div className="form-row">
                  <input
                    type="email"
                    placeholder="Email address (Gmail)"
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    required
                  />
                  <input
                    type="text"
                    placeholder="Name (optional)"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                  />
                </div>
                <button type="submit" disabled={addingMember || !newMemberEmail.trim()}>
                  {addingMember ? 'Adding...' : 'Add as Child'}
                </button>
                <p className="form-hint">New members are added as "child" by default. You can change their role after adding.</p>
              </form>
            )}

            <div className="member-list">
              {loadingMembers ? (
                <div className="loading-members">Loading family members...</div>
              ) : filteredMembers.length === 0 ? (
                <div className="no-members">
                  {familyMembers.length === 0 
                    ? 'No family members yet. Click "Add Member" to get started!'
                    : 'No members match the selected filter.'}
                </div>
              ) : (
                filteredMembers.map((member) => (
                <div key={member.id} className="member-item">
                  <div className={`member-avatar avatar-${(member.name || 'u').toLowerCase().charAt(0)}`}>
                    {(member.name || member.email || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div className="member-info">
                    <div className="member-name-row">
                      <h4>{member.name || member.email}</h4>
                      <span className={`role-badge role-${member.role}`}>
                        {member.role === 'parent' ? 'Parent' : 'Child'}
                      </span>
                    </div>
                    <span className="member-email">{member.email}</span>
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
                    <button 
                      className="remove-member-button"
                      onClick={() => handleRemoveMember(member.id)}
                    >
                      Remove
                    </button>
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
                            onChange={(e) => handleParentAssignment(member.id, e.target.value || null)}
                          >
                            <option value="">No parent assigned</option>
                            {parents.map(parent => (
                              <option key={parent.id} value={parent.id}>
                                {parent.name || parent.email}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
              )}
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

          {/* Activity Logs from Family Members */}
          <div className="card activity-logs-card">
            <div className="activity-logs-header">
              <h3>📋 Family Activity Logs</h3>
              <button 
                className="refresh-button"
                onClick={fetchActivityLogs}
                disabled={loadingLogs}
              >
                {loadingLogs ? 'Loading...' : '🔄 Refresh'}
              </button>
            </div>
            <p className="card-description">
              Real-time activity detections from family members' browsers
            </p>

            <div className="activity-logs-list">
              {loadingLogs ? (
                <div className="loading-logs">Loading activity logs...</div>
              ) : activityLogs.length === 0 ? (
                <div className="no-logs">
                  No activity logs yet. Make sure family members have:
                  <ol>
                    <li>Installed the Sentry extension</li>
                    <li>Entered the Family ID in the extension</li>
                    <li>Set their email address</li>
                  </ol>
                </div>
              ) : (
                activityLogs.slice(0, 10).map((log) => (
                  <div key={log.id} className="activity-log-item">
                    <div className="log-header">
                      <span className={`log-type-badge ${log.type}`}>
                        {log.type === 'search' ? '🔍 Search' : '📄 Content'}
                      </span>
                      <span className="log-time">{formatRelativeTime(log.timestamp)}</span>
                    </div>
                    <div className="log-user">
                      👤 {log.userEmail}
                    </div>
                    <div className="log-excerpt">
                      "{truncate(log.excerpt, 100)}"
                    </div>
                    <div className="log-url">
                      🔗 {new URL(log.url).hostname}
                    </div>
                    {log.matchedKeywords?.length > 0 && (
                      <div className="log-keywords">
                        Matched: {log.matchedKeywords.join(', ')}
                      </div>
                    )}
                  </div>
                ))
              )}
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
