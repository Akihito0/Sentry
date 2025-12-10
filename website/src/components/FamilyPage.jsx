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
  onSnapshot,
  orderBy,
  limit
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
  
  // Expanded child card state (only one card expanded at a time)
  const [expandedChildId, setExpandedChildId] = useState(null);
  const [activeSettingsTab, setActiveSettingsTab] = useState('nsfw');
  
  // Child blocking settings (per child)
  const [childSettings, setChildSettings] = useState({});

  // Get current user's family ID (using their UID as family identifier)
  const currentUser = auth.currentUser;
  const familyId = currentUser?.uid;

  // Real-time listener for activity logs from Firestore
  useEffect(() => {
    if (!familyId) return;

    const logsRef = collection(db, 'families', familyId, 'activity_logs');
    const q = query(logsRef, orderBy('timestamp', 'desc'), limit(50));

    setLoadingLogs(true);
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const logs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setActivityLogs(logs);
        setLoadingLogs(false);
        
        // Auto-add members who appear in logs but aren't in the family yet
        if (logs.length > 0) {
          autoAddNewMembers(logs);
        }
      },
      (error) => {
        console.error('Error listening to activity logs:', error);
        setLoadingLogs(false);
        // Fallback to HTTP fetch if Firestore fails
        fetchActivityLogs();
      }
    );

    return () => unsubscribe();
  }, [familyId]);

  // Fallback: Fetch activity logs from backend (HTTP)
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
    
    // Filter out 'unknown' emails
    const validEmails = logEmails.filter(email => email !== 'unknown');
    
    if (validEmails.length === 0) return;
    
    // Get current member emails from Firestore (fresh query to avoid race conditions)
    try {
      const membersRef = collection(db, 'families', familyId, 'members');
      const snapshot = await getDocs(membersRef);
      const existingEmails = new Set(snapshot.docs.map(doc => doc.data().email?.toLowerCase()));
      
      // Find emails that are in logs but not in members
      const newEmails = validEmails.filter(email => !existingEmails.has(email));
      
      // Add each new member with atomic check
      for (const email of newEmails) {
        // Double-check this email doesn't exist using query
        const existingQuery = query(membersRef, where('email', '==', email));
        const existingDocs = await getDocs(existingQuery);
        
        if (existingDocs.empty) {
          // Use email as document ID to prevent race condition duplicates
          const safeDocId = email.replace('@', '_at_').replace(/\./g, '_dot_');
          const memberDocRef = doc(db, 'families', familyId, 'members', safeDocId);
          
          const { setDoc } = await import('../database/firebase');
          await setDoc(memberDocRef, {
            email: email,
            name: email.split('@')[0],
            role: 'child',
            parentId: null,
            status: 'Online',
            lastSeen: new Date().toISOString(),
            addedAt: new Date().toISOString(),
            addedBy: 'auto-detected',
            autoAdded: true
          }, { merge: true });
          console.log('Auto-added family member:', email);
        }
      }
    } catch (error) {
      console.error('Error in autoAddNewMembers:', error);
    }
  };

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

  // Add new family member to Firestore (with duplicate prevention)
  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!newMemberEmail.trim() || !familyId) return;

    setAddingMember(true);
    try {
      const emailLower = newMemberEmail.trim().toLowerCase();
      const membersRef = collection(db, 'families', familyId, 'members');
      
      // Check if member already exists
      const existingQuery = query(membersRef, where('email', '==', emailLower));
      const existingDocs = await getDocs(existingQuery);
      
      if (!existingDocs.empty) {
        alert('This member already exists in your family!');
        setAddingMember(false);
        return;
      }
      
      // Use email as document ID to prevent race condition duplicates
      const safeDocId = emailLower.replace('@', '_at_').replace(/\./g, '_dot_');
      const memberDocRef = doc(db, 'families', familyId, 'members', safeDocId);
      
      const { setDoc } = await import('../database/firebase');
      await setDoc(memberDocRef, {
        email: emailLower,
        name: newMemberName.trim() || emailLower.split('@')[0],
        role: 'child',
        parentId: null,
        status: 'Offline',
        lastSeen: 'Never',
        addedAt: new Date().toISOString(),
        addedBy: currentUser.email
      }, { merge: true });
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

  // Default NSFW keywords
  const DEFAULT_NSFW_KEYWORDS = ['porn', 'xxx', 'nude', 'naked', 'sex', 'nsfw', 'adult content', 'explicit', 'pornhub', 'xvideos'];
  const DEFAULT_SCAM_KEYWORDS = ['free money', 'you won', 'claim prize', 'lottery winner', 'nigerian prince', 'wire transfer'];

  // Get child settings (with defaults) - nested structure
  const getChildSettings = (childId) => {
    return childSettings[childId] || {
      nsfw: {
        blockImages: true,
        blockKeywords: true,
        keywords: [...DEFAULT_NSFW_KEYWORDS]
      },
      scams: {
        blockPhishing: true,
        blockKeywords: true,
        keywords: [...DEFAULT_SCAM_KEYWORDS]
      },
      custom: {
        enabled: false,
        websites: []
      }
    };
  };

  // Toggle child card expansion (only one at a time)
  const toggleChildExpanded = (childId) => {
    if (expandedChildId === childId) {
      setExpandedChildId(null); // Close if same card clicked
    } else {
      setExpandedChildId(childId); // Open new card, close previous
      setActiveSettingsTab('nsfw'); // Reset to first tab
    }
  };

  // Get active tab
  const getActiveTab = () => activeSettingsTab;

  // Set active tab
  const setActiveTabForChild = (childId, tab) => {
    setActiveSettingsTab(tab);
  };

  // Update child setting (nested structure: category.setting)
  const updateChildSetting = (childId, category, setting, value) => {
    const currentSettings = getChildSettings(childId);
    const newSettings = {
      ...childSettings,
      [childId]: {
        ...currentSettings,
        [category]: {
          ...currentSettings[category],
          [setting]: value
        }
      }
    };
    setChildSettings(newSettings);
  };

  // Add keyword to a category
  const addKeyword = (childId, category, keyword) => {
    if (!keyword.trim()) return;
    const currentSettings = getChildSettings(childId);
    const keywordKey = category === 'custom' ? 'websites' : 'keywords';
    const currentList = currentSettings[category]?.[keywordKey] || [];
    
    if (!currentList.includes(keyword.trim().toLowerCase())) {
      const newList = [...currentList, keyword.trim().toLowerCase()];
      updateChildSetting(childId, category, keywordKey, newList);
    }
  };

  // Remove keyword from a category
  const removeKeyword = (childId, category, keywordToRemove) => {
    const currentSettings = getChildSettings(childId);
    const keywordKey = category === 'custom' ? 'websites' : 'keywords';
    const currentList = currentSettings[category]?.[keywordKey] || [];
    const newList = currentList.filter(k => k !== keywordToRemove);
    updateChildSetting(childId, category, keywordKey, newList);
  };

  // Save child settings to Firestore
  const saveChildSettings = async (childId) => {
    if (!familyId) return;
    
    try {
      const memberRef = doc(db, 'families', familyId, 'members', childId);
      await updateDoc(memberRef, {
        blockingSettings: getChildSettings(childId)
      });
      alert('Settings saved successfully!');
    } catch (error) {
      console.error('Error saving child settings:', error);
      alert('Failed to save settings. Please try again.');
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

  const filteredMembers = useMemo(() => {
    if (selectedRole === 'all') return familyMembers;
    return familyMembers.filter(member => member.role === selectedRole);
  }, [familyMembers, selectedRole]);

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
                <div key={member.id} className="member-card-wrapper">
                  <div className="member-item">
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
                    </div>
                    <div className="member-actions">
                      {member.role === 'child' && (
                        <button 
                          className={`settings-toggle-btn ${expandedChildId === member.id ? 'active' : ''}`}
                          onClick={() => toggleChildExpanded(member.id)}
                          title="Content Blocking Settings"
                        >
                          ⚙️
                        </button>
                      )}
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
                    </div>
                  )}
                  
                  {/* Expandable Child Settings Panel */}
                  {member.role === 'child' && expandedChildId === member.id && (
                        <div className="child-settings-expanded">
                          {/* Settings Tabs */}
                          <div className="settings-tabs">
                            <button 
                              className={`settings-tab ${activeSettingsTab === 'nsfw' ? 'active' : ''}`}
                              onClick={() => setActiveSettingsTab('nsfw')}
                            >
                              🔞 Blocking NSFW
                            </button>
                            <button 
                              className={`settings-tab ${activeSettingsTab === 'scams' ? 'active' : ''}`}
                              onClick={() => setActiveSettingsTab('scams')}
                            >
                              ⚠️ Blocking Scams & Phishing
                            </button>
                            <button 
                              className={`settings-tab ${activeSettingsTab === 'custom' ? 'active' : ''}`}
                              onClick={() => setActiveSettingsTab('custom')}
                            >
                              🌐 Blocking Custom Websites
                            </button>
                          </div>
                          
                          {/* NSFW Settings Tab */}
                          {activeSettingsTab === 'nsfw' && (
                            <div className="settings-panel nsfw-panel">
                              <h4>NSFW Content Blocking</h4>
                              
                              <div className="toggle-setting">
                                <label className="toggle-label">
                                  <span>Block NSFW Images</span>
                                  <span className="toggle-description">Automatically detect and blur explicit images</span>
                                </label>
                                <label className="toggle-switch">
                                  <input 
                                    type="checkbox"
                                    checked={getChildSettings(member.id).nsfw?.blockImages || false}
                                    onChange={(e) => updateChildSetting(member.id, 'nsfw', 'blockImages', e.target.checked)}
                                  />
                                  <span className="toggle-slider"></span>
                                </label>
                              </div>
                              
                              <div className="toggle-setting">
                                <label className="toggle-label">
                                  <span>Block NSFW Keywords</span>
                                  <span className="toggle-description">Block pages containing explicit keywords</span>
                                </label>
                                <label className="toggle-switch">
                                  <input 
                                    type="checkbox"
                                    checked={getChildSettings(member.id).nsfw?.blockKeywords || false}
                                    onChange={(e) => updateChildSetting(member.id, 'nsfw', 'blockKeywords', e.target.checked)}
                                  />
                                  <span className="toggle-slider"></span>
                                </label>
                              </div>
                              
                              {getChildSettings(member.id).nsfw?.blockKeywords && (
                                <div className="keyword-section">
                                  <h5>Blocked Keywords</h5>
                                  <div className="keyword-input-row">
                                    <input 
                                      type="text"
                                      placeholder="Add a keyword..."
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' && e.target.value.trim()) {
                                          addKeyword(member.id, 'nsfw', e.target.value.trim());
                                          e.target.value = '';
                                        }
                                      }}
                                    />
                                    <button 
                                      className="add-keyword-btn"
                                      onClick={(e) => {
                                        const input = e.target.previousSibling;
                                        if (input.value.trim()) {
                                          addKeyword(member.id, 'nsfw', input.value.trim());
                                          input.value = '';
                                        }
                                      }}
                                    >
                                      + Add
                                    </button>
                                  </div>
                                  <div className="keyword-tags">
                                    {(getChildSettings(member.id).nsfw?.keywords || []).map((keyword, index) => (
                                      <span key={index} className="keyword-tag">
                                        {keyword}
                                        <button 
                                          className="remove-keyword-btn"
                                          onClick={() => removeKeyword(member.id, 'nsfw', keyword)}
                                        >
                                          ×
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              <button 
                                className="save-settings-btn"
                                onClick={() => saveChildSettings(member.id)}
                              >
                                💾 Save NSFW Settings
                              </button>
                            </div>
                          )}
                          
                          {/* Scams & Phishing Settings Tab */}
                          {activeSettingsTab === 'scams' && (
                            <div className="settings-panel scams-panel">
                              <h4>Scams & Phishing Protection</h4>
                              
                              <div className="toggle-setting">
                                <label className="toggle-label">
                                  <span>Block Phishing Websites</span>
                                  <span className="toggle-description">Detect and block known phishing sites</span>
                                </label>
                                <label className="toggle-switch">
                                  <input 
                                    type="checkbox"
                                    checked={getChildSettings(member.id).scams?.blockPhishing || false}
                                    onChange={(e) => updateChildSetting(member.id, 'scams', 'blockPhishing', e.target.checked)}
                                  />
                                  <span className="toggle-slider"></span>
                                </label>
                              </div>
                              
                              <div className="toggle-setting">
                                <label className="toggle-label">
                                  <span>Block Scam Keywords</span>
                                  <span className="toggle-description">Block pages with suspicious scam patterns</span>
                                </label>
                                <label className="toggle-switch">
                                  <input 
                                    type="checkbox"
                                    checked={getChildSettings(member.id).scams?.blockKeywords || false}
                                    onChange={(e) => updateChildSetting(member.id, 'scams', 'blockKeywords', e.target.checked)}
                                  />
                                  <span className="toggle-slider"></span>
                                </label>
                              </div>
                              
                              {getChildSettings(member.id).scams?.blockKeywords && (
                                <div className="keyword-section">
                                  <h5>Scam Keywords to Block</h5>
                                  <div className="keyword-input-row">
                                    <input 
                                      type="text"
                                      placeholder="Add a scam keyword..."
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' && e.target.value.trim()) {
                                          addKeyword(member.id, 'scams', e.target.value.trim());
                                          e.target.value = '';
                                        }
                                      }}
                                    />
                                    <button 
                                      className="add-keyword-btn"
                                      onClick={(e) => {
                                        const input = e.target.previousSibling;
                                        if (input.value.trim()) {
                                          addKeyword(member.id, 'scams', input.value.trim());
                                          input.value = '';
                                        }
                                      }}
                                    >
                                      + Add
                                    </button>
                                  </div>
                                  <div className="keyword-tags">
                                    {(getChildSettings(member.id).scams?.keywords || []).map((keyword, index) => (
                                      <span key={index} className="keyword-tag scam-tag">
                                        {keyword}
                                        <button 
                                          className="remove-keyword-btn"
                                          onClick={() => removeKeyword(member.id, 'scams', keyword)}
                                        >
                                          ×
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              <button 
                                className="save-settings-btn"
                                onClick={() => saveChildSettings(member.id)}
                              >
                                💾 Save Scam Settings
                              </button>
                            </div>
                          )}
                          
                          {/* Custom Websites Settings Tab */}
                          {activeSettingsTab === 'custom' && (
                            <div className="settings-panel custom-panel">
                              <h4>Custom Website Blocking</h4>
                              
                              <div className="toggle-setting">
                                <label className="toggle-label">
                                  <span>Enable Custom Blocking</span>
                                  <span className="toggle-description">Block specific websites you add to the list</span>
                                </label>
                                <label className="toggle-switch">
                                  <input 
                                    type="checkbox"
                                    checked={getChildSettings(member.id).custom?.enabled || false}
                                    onChange={(e) => updateChildSetting(member.id, 'custom', 'enabled', e.target.checked)}
                                  />
                                  <span className="toggle-slider"></span>
                                </label>
                              </div>
                              
                              {getChildSettings(member.id).custom?.enabled && (
                                <div className="keyword-section">
                                  <h5>Blocked Websites</h5>
                                  <div className="keyword-input-row">
                                    <input 
                                      type="text"
                                      placeholder="Enter website URL (e.g., facebook.com)..."
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' && e.target.value.trim()) {
                                          addKeyword(member.id, 'custom', e.target.value.trim());
                                          e.target.value = '';
                                        }
                                      }}
                                    />
                                    <button 
                                      className="add-keyword-btn"
                                      onClick={(e) => {
                                        const input = e.target.previousSibling;
                                        if (input.value.trim()) {
                                          addKeyword(member.id, 'custom', input.value.trim());
                                          input.value = '';
                                        }
                                      }}
                                    >
                                      + Add
                                    </button>
                                  </div>
                                  <div className="keyword-tags">
                                    {(getChildSettings(member.id).custom?.websites || []).map((website, index) => (
                                      <span key={index} className="keyword-tag website-tag">
                                        🌐 {website}
                                        <button 
                                          className="remove-keyword-btn"
                                          onClick={() => removeKeyword(member.id, 'custom', website)}
                                        >
                                          ×
                                        </button>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              <button 
                                className="save-settings-btn"
                                onClick={() => saveChildSettings(member.id)}
                              >
                                💾 Save Custom Settings
                              </button>
                            </div>
                          )}
                        </div>
                  )}
                </div>
              ))
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default FamilyPage;
