import React from 'react';
import './App.css';
/*global chrome*/
function App() {
  return (
    <div className="sentry-popup">
      <div className="sentry-logo-section">
        <img
          src="/images/NOBG/Sentry_Logo-removebg-preview.png"
          alt="Sentry Logo"
          className="sentry-logo"
        />
      </div>
      <h2 className="sentry-title">Sentry</h2>
      <div className="sentry-status">
        <p className="status-text">Protection is <span className="sentry-status-on">OFF</span></p>
      </div>
      <div className="sentry-info-section">
        <p className="info-text">Secure your family using SENTRY</p>
      </div>
      <div className="sentry-connect-section">
        <button
          className="sentry-connect-button"
          onClick={() => {
            chrome.tabs.create({ url: 'http://localhost:5173/dashboard' });
          }}
        >
          To Dashboard
        </button>
      </div>
    </div>
  );
}

export default App;