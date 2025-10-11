import React from 'react';
import { useNavigate } from 'react-router-dom';
import SentryRobot from '../image/Robot.png';
import '../css/LandingPage.css';
import Logo from '../image/logo.png';

const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div className="sentry-page">
      <header className="sentry-header">
        <div className="logo-container">
          <div className="logo-image-shield">
            <img src={Logo} alt="Sentry Logo" />
          </div>
          <span className="logo-text">Sentry</span>
        </div>
        <nav className="header-nav">
          <button
            className="nav-btn login-button"
            onClick={() => navigate('/login')}
          >
            Login
          </button>
          <button
            className="nav-btn sign-up-button"
            onClick={() => navigate('/signup')}
          >
            Sign Up
          </button>
        </nav>
      </header>

      <section className="hero-section">
        <div className="hero-grid-container">
          <div className="hero-content">
            <h1>Sentry: Your Family's Online Guardian</h1>
            <p>
              Safe & Fun Browsing with <strong>AI Protection</strong>. Automatically blur content,
              block scams, and keep parents in the loop.
            </p>
            <div className="hero-actions">
              <button className="btn-primary">Add to Chrome</button>
              <button className="btn-secondary">Learn More</button>
            </div>
          </div>

          <div className="hero-image-bot">
            <img src={SentryRobot} alt="Sentry AI Robot Guardian" />
          </div>
        </div>

        <div className="feature-badges-container">
          <div className="badge">
            <div className="icon">👁️‍🗨️</div>
            Blur Content
          </div>
          <div className="badge">
            <div className="icon">🚫</div>
            Block Scams
          </div>
          <div className="badge">
            <div className="icon">👨‍👩‍👧‍👦</div>
            Family Alerts
          </div>
        </div>

        <div className="hero-wave-bg"></div>
      </section>

      <section className="features-section">
        <h2 className="section-title">Key Features</h2>
        <div className="features-grid-container">
          <div className="feature-card">
            <h3>Easy Installation</h3>
            <p className="subtitle">Sentry</p>
            <p className="card-text">
              First step yeahhh babooo!@
            </p>
            <div className="card-visual-placeholder">
              <img src="placeholder_installation_visual.png" alt="Installation Visual" />
            </div>
          </div>

          <div className="ai-power-box">
            <div className="shield-icon">
              <span className="gemini-text">GEMINI</span>
            </div>
            <p>Powered <br /> Gemini AI</p>
          </div>

          <div className="feature-card">
            <h3>Family Dashboard</h3>
            <p className="card-text">
              Parents receive real-time notifications about blocked content and
              scam attempts on their devices.
            </p>
            <div className="card-visual-placeholder">
              <img src="placeholder_phone_image.png" alt="Phone Mockup" />
            </div>
          </div>
        </div>
      </section>

      <footer className="sentry-footer">
        <p>Copyright 2025 Sentry. All Rights Reserved.</p>
        <div className="social-links">
          <a href="#facebook">f</a>
          <a href="#twitter">t</a>
          <a href="#instagram">i</a>
          <a href="#youtube">y</a>
          <a href="#linkedin">l</a>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
