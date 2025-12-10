import React, { useState, useEffect } from 'react';
import './App.css';
import {
  auth,
  db,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  doc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  addDoc
} from './firebase';

/*global chrome*/

function App() {
  // Auth state
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // App state
  const [activeTab, setActiveTab] = useState('home');
  const [familyId, setFamilyId] = useState('');
  const [familyIdInput, setFamilyIdInput] = useState('');
  const [logs, setLogs] = useState([]);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [isFamilyMember, setIsFamilyMember] = useState(false);

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      
      if (currentUser) {
        // Save user email to chrome.storage for background script
        await chrome.runtime.sendMessage({
          type: 'SET_CURRENT_USER',
          email: currentUser.email,
          displayName: currentUser.displayName || currentUser.email.split('@')[0],
          familyId: ''
        });
        
        // Load stored data
        loadData();
      }
    });

    return () => unsubscribe();
  }, []);

  const loadData = async () => {
    try {
      const userResponse = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_USER' });
      if (userResponse.success) {
        setFamilyId(userResponse.familyId || '');
        setFamilyIdInput(userResponse.familyId || '');
        if (userResponse.familyId) {
          setIsFamilyMember(true);
        }
      }

      const logsResponse = await chrome.runtime.sendMessage({ type: 'GET_LOGS' });
      if (logsResponse.success) {
        setLogs(logsResponse.logs);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const showMessage = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 3000);
  };

  // Handle login
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);

    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      showMessage('Signed in successfully!');
    } catch (error) {
      console.error('Login error:', error);
      if (error.code === 'auth/user-not-found') {
        setLoginError('No account found with this email');
      } else if (error.code === 'auth/wrong-password') {
        setLoginError('Incorrect password');
      } else if (error.code === 'auth/invalid-email') {
        setLoginError('Invalid email address');
      } else if (error.code === 'auth/invalid-credential') {
        setLoginError('Invalid email or password');
      } else {
        setLoginError('Failed to sign in. Please try again.');
      }
    } finally {
      setLoggingIn(false);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      await signOut(auth);
      // Clear chrome.storage
      await chrome.runtime.sendMessage({
        type: 'SET_CURRENT_USER',
        email: '',
        displayName: '',
        familyId: ''
      });
      setFamilyId('');
      setFamilyIdInput('');
      setIsFamilyMember(false);
      showMessage('Signed out');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Join a family with Family ID
  const handleJoinFamily = async () => {
    if (!familyIdInput.trim()) {
      showMessage('Please enter the Family ID from your parent', 'error');
      return;
    }

    try {
      const familyIdTrimmed = familyIdInput.trim();
      const emailLower = user.email.toLowerCase();
      
      console.log('Attempting to join family:', familyIdTrimmed);
      console.log('User email:', emailLower);
      console.log('User authenticated:', !!user);
      
      // Register member directly to Firestore (prevents duplicates using email as doc ID)
      const safeDocId = emailLower.replace('@', '_at_').replace(/\./g, '_dot_');
      const memberRef = doc(db, 'families', familyIdTrimmed, 'members', safeDocId);
      
      console.log('Writing to path:', `families/${familyIdTrimmed}/members/${safeDocId}`);
      
      await setDoc(memberRef, {
        email: emailLower,
        name: user.displayName || emailLower.split('@')[0],
        role: 'child',
        parentId: null,
        status: 'Online',
        lastSeen: new Date().toISOString(),
        addedAt: new Date().toISOString(),
        addedBy: 'extension-auto',
        autoAdded: true
      }, { merge: true }); // merge: true prevents overwriting existing data
      
      console.log('✅ Member registered to Firestore successfully!');

      // Also notify background script to store locally
      const response = await chrome.runtime.sendMessage({
        type: 'SET_CURRENT_USER',
        email: user.email,
        displayName: user.displayName || user.email.split('@')[0],
        familyId: familyIdTrimmed
      });

      if (response.success) {
        setFamilyId(familyIdTrimmed);
        setIsFamilyMember(true);
        showMessage('Joined family successfully! You now appear on the dashboard.');
      } else {
        // Still show success since Firestore write worked
        setFamilyId(familyIdTrimmed);
        setIsFamilyMember(true);
        showMessage('Joined family successfully!');
      }
    } catch (error) {
      console.error('❌ Error joining family:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      showMessage('Failed to join family: ' + error.message, 'error');
    }
  };

  // Loading state
  if (authLoading) {
    return (
      <div className="sentry-popup">
        <div className="sentry-header">
          <div className="sentry-logo-section">
            <img
              src="/images/NOBG/Sentry_Logo-removebg-preview.png"
              alt="Sentry Logo"
              className="sentry-logo"
            />
          </div>
          <h2 className="sentry-title">Sentry</h2>
        </div>
        <div className="loading-state">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // Login screen (not authenticated)
  if (!user) {
    return (
      <div className="sentry-popup">
        <div className="sentry-header">
          <div className="sentry-logo-section">
            <img
              src="/images/NOBG/Sentry_Logo-removebg-preview.png"
              alt="Sentry Logo"
              className="sentry-logo"
            />
          </div>
          <h2 className="sentry-title">Sentry</h2>
        </div>

        <div className="login-section">
          <h3>Sign In</h3>
          <p className="tab-description">Sign in with your Sentry account</p>

          <form onSubmit={handleLogin}>
            <div className="input-group">
              <label>Email</label>
              <input
                type="email"
                placeholder="your-email@gmail.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
              />
            </div>

            <div className="input-group">
              <label>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </div>

            {loginError && (
              <div className="message-box error">
                {loginError}
              </div>
            )}

            <button type="submit" className="save-btn" disabled={loggingIn}>
              {loggingIn ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="signup-link">
            <p>Don't have an account?</p>
            <button
              className="link-btn"
              onClick={() => chrome.tabs.create({ url: 'http://localhost:5173/signup' })}
            >
              Create account on website
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main app (authenticated)
  return (
    <div className="sentry-popup">
      {/* Header */}
      <div className="sentry-header">
        <div className="sentry-logo-section">
          <img
            src="/images/NOBG/Sentry_Logo-removebg-preview.png"
            alt="Sentry Logo"
            className="sentry-logo"
          />
        </div>
        <h2 className="sentry-title">Sentry</h2>
      </div>

      {/* User Badge */}
      <div className="current-user-badge">
        👤 {user.email}
        <button className="logout-btn" onClick={handleLogout} title="Sign out">
          ↪
        </button>
      </div>

      {/* Message Display */}
      {message.text && (
        <div className={`message-box ${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="tab-nav">
        <button 
          className={`tab-btn ${activeTab === 'home' ? 'active' : ''}`}
          onClick={() => setActiveTab('home')}
          title="Home"
        >
          🏠
        </button>
        <button 
          className={`tab-btn ${activeTab === 'family' ? 'active' : ''}`}
          onClick={() => setActiveTab('family')}
          title="Family"
        >
          👨‍👩‍👧
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {/* Home Tab */}
        {activeTab === 'home' && (
          <div className="home-tab">
            <div className="sentry-status">
              <p className="status-text">
                Protection is <span className="sentry-status-active">ON</span>
              </p>
            </div>
            <div className="sentry-info-section">
              <p className="info-text">Secure your family using SENTRY</p>
              <p className="info-subtext">
                {logs.length} detection(s) logged
              </p>
              {familyId && (
                <p className="info-subtext" style={{ color: '#52c41a' }}>
                  ✓ Connected to family
                </p>
              )}
            </div>
            <div className="sentry-connect-section">
              <button
                className="sentry-connect-button"
                onClick={() => chrome.tabs.create({ url: 'http://localhost:5173/dashboard' })}
              >
                To Dashboard
              </button>
            </div>
          </div>
        )}

        {/* Family Tab */}
        {activeTab === 'family' && (
          <div className="user-tab">
            {isFamilyMember ? (
              <>
                <h3>✓ Family Connected</h3>
                <div className="current-user-info">
                  <p>You are connected to a family group</p>
                  <p className="info-small">Family ID: {familyId.substring(0, 12)}...</p>
                  <p className="info-small">Your activity is synced to the parent dashboard</p>
                </div>
                <button 
                  className="leave-family-btn"
                  onClick={() => {
                    setFamilyId('');
                    setFamilyIdInput('');
                    setIsFamilyMember(false);
                    chrome.runtime.sendMessage({
                      type: 'SET_CURRENT_USER',
                      email: user.email,
                      displayName: user.displayName || user.email.split('@')[0],
                      familyId: ''
                    });
                    showMessage('Left family group');
                  }}
                >
                  Leave Family
                </button>
              </>
            ) : (
              <>
                <h3>Join a Family</h3>
                <p className="tab-description">
                  Enter the Family ID given by your parent
                </p>
                
                <div className="input-group">
                  <label>Family ID</label>
                  <input
                    type="text"
                    placeholder="Paste Family ID here..."
                    value={familyIdInput}
                    onChange={(e) => setFamilyIdInput(e.target.value)}
                  />
                </div>

                <button className="save-btn" onClick={handleJoinFamily}>
                  Join Family
                </button>

                <div className="info-box">
                  <p>📌 Ask your parent for the Family ID from their Sentry dashboard</p>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;