import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SentryRobot from '../image/Robot.png';
import '../css/LandingPage.css';
import Logo from '../image/logo.png';
import RobotSentry from '../image/SentryBot.png';
import BlurImageGif from '../image/blur_image.gif';
import BlurTextGif from '../image/blur_text.gif';
import PhishingGif from '../image/phishing.gif';
import ProtectGif from '../image/protect.gif';
import ScamGif from '../image/scam.gif';
import GeminiPng from '../image/gemini.png';

const LandingPage = () => {
  const navigate = useNavigate();
  const [selectedFeature, setSelectedFeature] = useState(null);

  const openModal = (feature) => {
    setSelectedFeature(feature);
  };

  const closeModal = () => {
    setSelectedFeature(null);
  };

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
            <img src={RobotSentry} alt="Sentry AI Robot Guardian" />
          </div>
        </div>

        <div className="hero-wave-bg"></div>
      </section>

      <section className="features-section">
        <h2 className="section-title">Key Features</h2>
        <div className="features-scroll-wrapper">
          <div className="features-scroll-container">
            <div className="feature-card-scroll" onClick={() => openModal({
              title: 'Blocking Visual Images',
              description: 'Automatically detects and blurs inappropriate images to keep browsing safe for all family members.',
              details: ' AI technology scans images in real-time as they load on web pages. Using sophisticated machine learning algorithms, Sentry identifies potentially inappropriate content and automatically applies a blur effect. Family members can click to reveal images if needed, and all actions are logged for parental review.'
            })}>
              <div className="card-gif-container">
                <img src={BlurImageGif} alt="Visual Blocking Demo" className="card-gif" />
              </div>
              <h3>Blocking Visual (Images)</h3>
              <p className="card-text">
                Automatically detects and blurs inappropriate images to keep browsing safe for all family members.
              </p>
            </div>

            <div className="feature-card-scroll" onClick={() => openModal({
              title: 'Blocking Texts',
              description: 'Filters harmful or offensive text content in real-time across websites to maintain a safe browsing experience.',
              details: 'Sentry analyzes text content across all websites, identifying and filtering harmful language, offensive terms, and inappropriate messages. The system uses natural language processing to understand context and prevent false positives while maintaining comprehensive protection.'
            })}>
              <div className="card-gif-container">
                <img src={BlurTextGif} alt="Text Blocking Demo" className="card-gif" />
              </div>
              <h3>Blocking Texts</h3>
              <p className="card-text">
                Filters harmful or offensive text content in real-time across websites to maintain a safe browsing experience.
              </p>
            </div>

            <div className="feature-card-scroll" onClick={() => openModal({
              title: 'Blocking Scam Texts',
              description: 'Identifies and blocks fraudulent messages and deceptive content before they reach users.',
              details: 'Our AI-powered scam detection identifies fraudulent schemes, fake offers, and deceptive content patterns. The system continuously learns from global threat databases to stay ahead of evolving scam tactics, protecting your family from financial fraud and identity theft attempts.'
            })}>
              <div className="card-gif-container">
                <img src={ScamGif} alt="Scam Blocking Demo" className="card-gif" />
              </div>
              <h3>Blocking Scam Texts</h3>
              <p className="card-text">
                Identifies and blocks fraudulent messages and deceptive content before they reach users.
              </p>
            </div>

            <div className="feature-card-scroll" onClick={() => openModal({
              title: 'AI Overview',
              description: 'Gemini AI continuously analyzes browsing patterns to provide intelligent threat detection and real-time protection.',
              details: 'Powered by Google\'s advanced Gemini AI, Sentry provides state-of-the-art protection with continuous learning capabilities. The AI analyzes patterns, adapts to new threats, and provides personalized protection based on your family\'s browsing habits while maintaining privacy and security.'
            })}>
              <div className="card-gif-container">
                <img src={GeminiPng} alt="AI Analysis Demo" className="card-gif" />
              </div>
              <h3>AI Overview</h3>
              <p className="card-text">
                Gemini AI continuously analyzes browsing patterns to provide intelligent threat detection and real-time protection.
              </p>
            </div>

            <div className="feature-card-scroll" onClick={() => openModal({
              title: 'Parental Guidance',
              description: 'Parents receive blocked content and can monitor family browsing activity through a comprehensive dashboard.',
              details: 'The parental dashboard provides complete visibility into your family\'s online activity. Receive instant notification when content is blocked, view detailed activity reports, customize protection levels for each family member, and access insights about browsing patterns—all from one centralized, easy-to-use interface.'
            })}>
              <div className="card-gif-container">
                <img src={ProtectGif} alt="Parental Guidance Demo" className="card-gif" />
              </div>
              <h3>Parental Guidance</h3>
              <p className="card-text">
                Parents receive real-time notifications about blocked content and can monitor family browsing activity through a comprehensive dashboard.
              </p>
            </div>

            {/* Duplicate for infinite scroll effect */}
            <div className="feature-card-scroll" onClick={() => openModal({
              title: 'Blocking Explicit Visual Images',
              description: 'Automatically detects and blurs inappropriate images to keep browsing safe for all family members.',
              details: 'Our advanced AI technology scans images in real-time as they load on web pages. Using  machine learning algorithms, Sentry identifies potentially inappropriate content and automatically applies a blur effect. Family members can click to reveal images if needed, and all actions are logged for parental review.'
            })}>
              <div className="card-gif-container">
                <img src={BlurImageGif} alt="Visual Blocking Demo" className="card-gif" />
              </div>
              <h3>Blocking Visual (Images)</h3>
              <p className="card-text">
                Automatically detects and blurs inappropriate images to keep browsing safe for all family members.
              </p>
            </div>


            <div className="feature-card-scroll" onClick={() => openModal({
              title: 'Blocking Scam Texts',
              description: 'Identifies and blocks fraudulent messages and deceptive content before they reach users.',
              details: 'Our AI-powered scam detection identifies fraudulent schemes, fake offers, and deceptive content patterns. The system continuously learns from global threat databases to stay ahead of evolving scam tactics, protecting your family from financial fraud and identity theft attempts.'
            })}>
              <div className="card-gif-container">
                <img src={ScamGif} alt="Scam Blocking Demo" className="card-gif" />
              </div>
              <h3>Blocking Scam Texts</h3>
              <p className="card-text">
                Identifies and blocks fraudulent messages and deceptive content before they reach users.
              </p>
            </div>


            <div className="feature-card-scroll" onClick={() => openModal({
              title: 'Blocking Potential Phishing Texts',
              description: 'Detects and prevents phishing attempts to protect sensitive information and personal data.',
              details: 'Sentry guards against phishing attacks by analyzing URLs, email patterns, and suspicious requests for personal information. The system identifies fake login pages, spoofed websites, and social engineering attempts, alerting users before they can compromise their security.'
            })}>
              <div className="card-gif-container">
                <img src={PhishingGif} alt="Phishing Protection Demo" className="card-gif" />
              </div>
              <h3>Blocking Potential Phishing Texts</h3>
              <p className="card-text">
                Detects and prevents phishing attempts to protect sensitive information and personal data.
              </p>
            </div>

            <div className="feature-card-scroll" onClick={() => openModal({
              title: 'AI Overview',
              description: 'Gemini AI continuously analyzes browsing patterns to provide intelligent threat detection and real-time protection.',
              details: 'Powered by Google\'s advanced Gemini AI, Sentry provides state-of-the-art protection with continuous learning capabilities. The AI analyzes patterns, adapts to new threats, and provides personalized protection based on your family\'s browsing habits while maintaining privacy and security.'
            })}>
              <div className="card-gif-container">
                <img src={GeminiPng} alt="AI Analysis Demo" className="card-gif" />
              </div>
              <h3>AI Overview</h3>
              <p className="card-text">
                Gemini AI continuously analyzes browsing patterns to provide intelligent threat detection and real-time protection.
              </p>
            </div>

            <div className="feature-card-scroll" onClick={() => openModal({
              title: 'Parental Guidance',
              description: 'Parents receive real-time notifications about blocked content and can monitor family browsing activity through a comprehensive dashboard.',
              details: 'The parental dashboard provides complete visibility into your family\'s online activity. Receive instant notifications when content is blocked, view detailed activity reports, customize protection levels for each family member, and access insights about browsing patterns—all from one centralized, easy-to-use interface.'
            })}>
              <div className="card-gif-container">
                <img src={ProtectGif} alt="Parental Guidance Demo" className="card-gif" />
              </div>
              <h3>Parental Guidance</h3>
              <p className="card-text">
                Parents receive real-time notifications about blocked content and can monitor family browsing activity through a comprehensive dashboard.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="sentry-footer">
        <p>Copyright 2025 Sentry. All Rights Reserved.</p>
      </footer>

      {/* Modal */}
      {selectedFeature && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>&times;</button>
            <h2>{selectedFeature.title}</h2>
            <p className="modal-description">{selectedFeature.description}</p>
            <div className="modal-divider"></div>
            <p className="modal-details">{selectedFeature.details}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandingPage;
