import React, { useState } from 'react';
import '../css/Settings.css';
import { useNavigate } from 'react-router-dom';
import { auth } from '../database/firebase';

const ToggleSwitch = ({ checked, onChange, label, subLabel }) => {
  return (
    <div className="toggle-item">
      <div className="toggle-info">
        <span className="label">{label}</span>
        <span className="sublabel">{subLabel}</span>
      </div>
      <div className="relative-toggle" onClick={onChange}>
        <div
          className={`toggle-label ${checked ? 'checked' : ''}`}
          style={{ backgroundColor: checked ? '#4f46e5' : '#d1d5db' }}
        ></div>
      </div>
    </div>
  );
};

const Settings = () => {
  // Mock user settings
  const navigate = useNavigate();
  const [user, setUser] = useState({
    name: 'Jordan Parent',
    email: 'jordan.p@example.com',
    subscription: 'Sentry Plus (Yearly)',
  });

  const [notifications, setNotifications] = useState({
    emailAlerts: true,
    realtimeApp: true,
    weeklySummary: false,
  });

  const handleNotificationToggle = (key) => {
    setNotifications((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleLogout = async () => {
    const confirmLogout = window.confirm('Are you sure you want to log out?');
    
    if (!confirmLogout) return;

    try{
        await auth.signOut();
        navigate('/login');
    }
    catch (error) {
      console.error('Error during logout:', error);
      alert('Logout failed. Please try again.');
    }
  };

  const handleAccountUpdate = () => {
    alert('Account settings updated!');
  };

  const handleSubscriptionChange = () => {
    alert('Redirecting to billing portal...');
  };

  return (
    <div className="settings-view">
      <div className="view-content">
        <h2 className="section-title">⚙️ General Settings</h2>
        <p className="section-description">
          Manage your account credentials, notification preferences, and subscription plan.
        </p>

        {/* Account Settings */}
        <div className="card">
          <h3 className="card-title">Account Information</h3>
          <p className="card-description">
            Update your name, email, and password associated with your Sentry account.
          </p>

          <div className="setting-group">
            {/* Name */}
            <div className="setting-item">
              <div className="setting-info">
                <span className="label">Name</span>
                <span className="value">{user.name}</span>
              </div>
              <button className="action-button" onClick={handleAccountUpdate}>
                Edit
              </button>
            </div>

            {/* Email */}
            <div className="setting-item">
              <div className="setting-info">
                <span className="label">Email Address</span>
                <span className="value">{user.email}</span>
              </div>
              <button className="action-button" onClick={handleAccountUpdate}>
                Change
              </button>
            </div>

            {/* Password */}
            <div className="setting-item">
              <div className="setting-info">
                <span className="label">Password</span>
                <span className="value">••••••••</span>
              </div>
              <button className="action-button" onClick={handleAccountUpdate}>
                Change Password
              </button>
            </div>

            {/* Logout */}
            <div className="setting-item">
              <div className="setting-info">
                <span className="label text-red">Session</span>
                <span className="value">Sign out of all devices.</span>
              </div>
              <button className="action-button danger-button" onClick={handleLogout}>
                Log Out
              </button>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="card">
          <h3 className="card-title">Notification Preferences</h3>
          <p className="card-description">
            Choose how you want to receive alerts about your family's activity and safety status.
          </p>

          <div className="setting-group">
            <ToggleSwitch
              checked={notifications.realtimeApp}
              onChange={() => handleNotificationToggle('realtimeApp')}
              label="Real-time App Alerts"
              subLabel="Instant notifications within the Sentry Dashboard."
            />
            <ToggleSwitch
              checked={notifications.emailAlerts}
              onChange={() => handleNotificationToggle('emailAlerts')}
              label="Email Alerts for Critical Events"
              subLabel="Receive an email for blocked malicious activity."
            />
            <ToggleSwitch
              checked={notifications.weeklySummary}
              onChange={() => handleNotificationToggle('weeklySummary')}
              label="Weekly Safety Summary"
              subLabel="A detailed report on Monday mornings."
            />
          </div>
        </div>

        {/* Subscription */}
        <div className="card">
          <h3 className="card-title">Subscription & Billing</h3>
          <p className="card-description">Manage your current plan and view billing history.</p>

          <div className="setting-group">
            <div className="setting-item">
              <div className="setting-info">
                <span className="label">Current Plan</span>
                <span className="value">{user.subscription}</span>
              </div>
              <button className="action-button" onClick={handleSubscriptionChange}>
                Manage Plan
              </button>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <span className="label">Next Billing Date</span>
                <span className="value">October 26, 2026</span>
              </div>
              <button className="action-button" onClick={() => alert('Viewing history...')}>
                Billing History
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
