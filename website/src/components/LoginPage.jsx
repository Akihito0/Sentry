import React, { useState } from 'react';
import '../css/LoginPage.css'; // imported CSS file
import { useNavigate } from 'react-router-dom';
import welcomeBot from '../image/welcome-robot.png';
import google from '../image/google.png';
import Logo from '../image/logo.png';
import {
  auth,
  db,
  GoogleAuthProvider,
  fetchSignInMethodsForEmail,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup,
  setPersistence,
  browserSessionPersistence,
  doc,
  setDoc
} from '../database/firebase';

const LoginPage = ({ toggleMode }) => {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const handleGoogleLogin = async (e) => {
        e.preventDefault();
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });

        try {
            await setPersistence(auth, browserSessionPersistence);

            const result = await signInWithPopup(auth, provider);
            const user = result.user;

            const existingMethods = await fetchSignInMethodsForEmail(auth, user.email);

            if (
            existingMethods.length > 0 &&
            !existingMethods.includes('google.com')
            ) {
            alert(
                `This email is already registered using another method (e.g., Email & Password). Please log in using that method.`
            );
            return;
            }

            await setDoc(
            doc(db, 'Sentry-User', user.uid),
            {
                name: user.displayName?.split(' ')[0] || '',
                surname: user.displayName?.split(' ')[1] || '',
                email: user.email,
                uid: user.uid,
                provider: 'google',
                createdAt: new Date().toISOString(),
            },
            { merge: true }
            );

            navigate('/dashboard');
            } catch (error) {
                if (error.code !== 'auth/popup-closed-by-user') {
                alert('Google Login Failed: ' + error.message);
                }
            }
        };

    const handleFormSubmit = async(e) => {
            e.preventDefault();
                try {
                    await signInWithEmailAndPassword(auth, email, password);
                    navigate('/dashboard');
                } catch (error) {
                    if (error.code === 'auth/invalid-credential') {
                        alert('Incorrect email or password. Please try again.');
                    } else if (error.code === 'auth/user-not-found') {
                        alert('No account found with this email.');
                    } else {
                        alert('Login Failed: ' + error.message);
                    }
                }
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
                                src={welcomeBot}
                                alt="Sentry AI Robot Guardian"
                                className="robot-image"
                                onError={(e) => {
                                    e.target.onerror = null;
                                    e.target.src = "https://placehold.co/300x300/003681/FFC000?text=Sentry+Robot";
                                }}
                            />
                        </div>
                          <div className="sentry-logo-footer">
                            <img
                                src={Logo}
                                alt="Sentry Logo"
                                className="sentry-footer-logo"
                                onError={(e) => {
                                    e.target.onerror = null;
                                    e.target.src = "https://placehold.co/100x100?text=Logo";
                                }}
                            />
                            <span className="sentry-footer-text">Sentry</span>
                        </div>
                    </div>

                    {/* Login Form Area */}
                    <div className="auth-form-area">
                        <h2>Welcome Back!</h2>
                        <p>Sign in to manage your family's safety settings.</p>

                        <button type="button" className="google-button" onClick={handleGoogleLogin}>
                            <img
                                src={google}
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
                                    placeholder="name@gmail.com"
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
