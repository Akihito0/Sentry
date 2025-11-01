import React from 'react';
import '../css/FamilyPage.css';

const FamilyPage = () => {
  return (
    <div className="family-page">
      {/* Main container for family cards */}
      <div className="family-content-only-container">

        <div className="family-section-grid">

          {/* Notification Center */}
          <div className="card notification-center-card">
            <h3>Notification Center</h3>
            <div className="setting-row">
              <span className="icon">🚨</span> Receive Real-time alerts
              <label className="switch">
                <input type="checkbox" defaultChecked />
                <span className="slider round"></span>
              </label>
            </div>
            <div className="setting-row sub-setting">
              Explicit Content Blurs
              <label className="switch">
                <input type="checkbox" defaultChecked />
                <span className="slider round"></span>
              </label>
            </div>
            <div className="setting-row sub-setting">
              Scam Link Blocks
              <label className="switch">
                <input type="checkbox" />
                <span className="slider round"></span>
              </label>
            </div>
            <button className="link-button">Customize Alert Settings</button>
          </div>

          {/* Family Members */}
          <div className="card family-members-card">
            <h3>Family Members</h3>
            <div className="member-list">
              <div className="member-item">
                <div className="member-avatar avatar-jordan">J</div>
                <div className="member-info">
                  <h4>Jordan</h4>
                  <span>Offline - Last seen 1 hour ago</span>
                </div>
                <button className="view-report-button">View Report</button>
              </div>

              <div className="member-item">
                <div className="member-avatar avatar-sarah">S</div>
                <div className="member-info">
                  <h4>Sarah</h4>
                  <span>Offline - Last seen 1 hour ago</span>
                </div>
                <button className="view-report-button">View Report</button>
              </div>
            </div>
          </div>

          {/* Critical Alerts */}
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

          {/* Activity Report */}
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

          {/* Content Filtering */}
          <div className="card content-filtering-card">
            <h3>Content Filtering</h3>

            <p>Custom Keywords to Block</p>
            <div className="keyword-tags">
              <span className="tag">bomb <span className="tag-close">x</span></span>
              <span className="tag">drugs <span className="tag-close">x</span></span>
              <span className="tag">gore <span className="tag-close">x</span></span>
            </div>

            <div className="add-keyword-input">
              <input type="text" placeholder="Add custom keyword..." />
              <button className="add-button">Add</button>
            </div>

            <p>Whitelisted Websites</p>
            <div className="whitelisted-sites">
              <span className="tag">google.com <span className="tag-close">x</span></span>
            </div>

            <div className="add-site-input">
              <input type="text" placeholder="Add website to whitelist..." />
              <button className="add-button">Add Website</button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default FamilyPage;
