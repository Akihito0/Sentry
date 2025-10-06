import React, { useState } from 'react';
import '../css/SignUpPage.css';
import RobotImage from '../image/Robot.png'; // your robot image
import { useNavigate } from 'react-router-dom';

const SignupPage = ({ toggleMode }) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleGoogleSignIn = () => {
    console.log('Signup: Google Sign-Up initiated...');
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      console.error('Error: Passwords do not match!');
      return;
    }
    console.log('Signing up with:', { email, password });
  };

  const handleSwitchToLogin = () => {
    if (toggleMode) toggleMode();
    else console.log('Switched to Login (standalone mode)');
  };

  return (
    <div className="sentry-app-container">
      <div className="auth-card-container">
        {/* Visual Side */}
        <div className="auth-visual-side">
          <h3>Sentry Protection</h3>
          <p>Your AI Guardian is ready to secure your family's online world.</p>
          <div className="robot-image-container">
            <img
              src={RobotImage}
              alt="Sentry AI Robot Guardian"
              className="robot-image"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = "https://placehold.co/300x300/003681/FFC000?text=Sentry+Robot";
              }}
            />
          </div>
          <div className="sentry-logo-footer">🛡️ Sentry</div>
        </div>

        {/* Sign Up Form Area */}
        <div className="auth-form-area">
          <h2>Join Sentry Today!</h2>
          <p>Create your free account and start protecting your loved ones.</p>

          <button type="button" className="google-button" onClick={handleGoogleSignIn}>
            <img
              src="google_logo.png"
              alt="Google Logo"
              className="google-icon"
              onError={(e) => {
                e.target.onerror = null;
                e.target.style.display = 'none';
              }}
            />
            Sign up with Google
          </button>

          <div className="separator"><span>OR</span></div>

          <form className="auth-form" onSubmit={handleFormSubmit}>
            <div className="input-group">
              <label htmlFor="signup-email">Email Address</label>
              <input
                type="email"
                id="signup-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
              />
            </div>
            <div className="input-group">
              <label htmlFor="signup-password">Password</label>
              <input
                type="password"
                id="signup-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <div className="input-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                type="password"
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            <button type="submit" className="submit-button">
              Create Account
            </button>
          </form>

          <div className="mode-switch-container">
            Already a member?
            <span className="mode-switch-link" onClick={() => { navigate('/login'); handleSwitchToLogin(); }}>
              Login
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;
