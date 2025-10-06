import React, { useState } from 'react';
import '../css/LoginPage.css'; // imported CSS file
import RobotImage from '../image/Robot.png'; // your robot image
import { useNavigate } from 'react-router-dom';

const LoginPage = ({ toggleMode }) => {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const handleGoogleSignIn = () => {
        console.log('Login: Google Sign-In initiated...');
    };

    const handleFormSubmit = (e) => {
        e.preventDefault();
        console.log('Logging in with:', { email, password });
        // Placeholder for Login logic

        // ✅ Added line: Go directly to Dashboard after form submission
        navigate('/dashboard');
    };

    const handleSwitchToSignup = () => {
        if (toggleMode) {
            toggleMode();
        } else {
            console.log('Switched to Sign Up (standalone mode)');
        }
    };

    return (
        <div className="login-container">
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

                    {/* Login Form Area */}
                    <div className="auth-form-area">
                        <h2>Welcome Back!</h2>
                        <p>Sign in to manage your family's safety settings.</p>

                        <button type="button" className="google-button" onClick={handleGoogleSignIn}>
                            <img
                                src="google_logo.png"
                                alt="Google Logo"
                                className="google-icon"
                                onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                            />
                            Sign in with Google
                        </button>

                        <div className="separator"><span>OR</span></div>

                        <form className="auth-form" onSubmit={handleFormSubmit}>
                            <div className="input-group">
                                <label htmlFor="login-email">Email Address</label>
                                <input
                                    type="email"
                                    id="login-email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="name@example.com"
                                    required
                                />
                            </div>
                            <div className="input-group">
                                <label htmlFor="login-password">Password</label>
                                <input
                                    type="password"
                                    id="login-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                />
                            </div>
                            <button type="submit" className="submit-button">
                                Login Securely
                            </button>
                        </form>

                        <div className="mode-switch-container">
                            Need an account?
                            <span className="mode-switch-link" onClick={() => { navigate('/signup'); handleSwitchToSignup(); }}>
                                Sign Up
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
