import React from 'react';
import '../css/SafeBrowsing.css';

const SafeBrowsing = () => {
  return (
    <div className="safe-browsing-container">
      <div className="header-section">
        <div className="icon-wrapper">
          <div className="wot-icon">🛡️</div>
        </div>
        <div className="header-text">
          <h1>Safe Browsing</h1>
          <p>Sentry keeps you vigilant online by scanning every site, page and service that you visit with real time alerts.</p>
        </div>
      </div>

      <div className="section">
        <h2>Security</h2>
        <div className="grid-container">
          <div className="card security-card">
            <div className="card-content">
              <h3>Block Harmful Websites</h3>
              <p>Advanced protection that keeps you safe from cyber threats and attacks that aim to steal your personal information. <a href="#">Learn more</a></p>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" defaultChecked aria-label="Block Harmful Websites" />
              <span className="slider"></span> {/* Removed 'round' if not needed */}
            </label>
          </div>

          <div className="card security-card">
            <div className="card-content">
              <h3>Safe Search</h3>
              <p>Icons will be displayed next to your search results to let you know if a website is safe or not before you click on it. <a href="#">Edit Safe Search</a></p>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" defaultChecked aria-label="Safe Search" />
              <span className="slider"></span>
            </label>
          </div>

          <div className="card security-card">
            <div className="card-content">
              <h3>Warning alerts</h3>
              <p>Show warnings when visiting suspicious websites.</p>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" defaultChecked aria-label="Warning Alerts" />
              <span className="slider"></span>
            </label>
          </div>

          <div className="card security-card">
            <div className="card-content">
              <h3>Chatbots</h3>
              <p>Icons will be displayed next to links inside chatbots to let you know if a website is safe or not before you click on it. <a href="#">Edit Chatbots</a></p>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" defaultChecked aria-label="Chatbots Safety" />
              <span className="slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div className="section">
        <h2>Content Filtering</h2>
        <div className="grid-container">
          <div className="card content-card">
            <div className="card-content">
              <h3>Block Adult Content</h3>
              <p>Prevent access to websites with explicit content.</p>
            </div>
            <label className="toggle-switch disabled-toggle">
              <input type="checkbox" disabled aria-label="Block Adult Content (Disabled)" />
              <span className="slider"></span>
            </label>
          </div>

          <div className="card content-card">
            <div className="card-content">
              <h3>Block Gambling Websites</h3>
              <p>Prevent access to gambling websites.</p>
            </div>
            <label className="toggle-switch disabled-toggle">
              <input type="checkbox" disabled aria-label="Block Gambling Websites (Disabled)" />
              <span className="slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div className="section trusted-list-section">
        <h2>Your Trusted URL List</h2>
        <p className="trusted-list-text">To avoid being notified about certain websites, add their URL to your Trusted URL List</p>
        <div className="url-input-group">
          <input type="text" placeholder="Enter a URI address" className="url-input" />
          <button className="add-button">ADD</button>
        </div>
      </div>
    </div>
  );
};

export default SafeBrowsing;