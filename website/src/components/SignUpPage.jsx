import React, { useState } from 'react';
import '../css/SignUpPage.css';
import { useNavigate } from 'react-router-dom';
import welcomeBot from '../image/welcome-robot.png';
import {
  auth,
  db,
  GoogleAuthProvider,
  fetchSignInMethodsForEmail,
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup,
  setPersistence,
  browserSessionPersistence,
  doc,
  getDoc,
  setDoc
} from '../database/firebase';

const SignupPage = ({ toggleMode }) => {
  const navigate = useNavigate();
  const [name, setName] = useState(''); 
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

   const handleGoogleLogin = async (e) => {
      e.preventDefault();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      try {
        await setPersistence(auth, browserSessionPersistence);

        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        const userRef = doc(db, 'Sentry-User', user.uid);
        const userSnap = await getDoc(userRef);

        const existingMethods = await fetchSignInMethodsForEmail(auth, user.email);

        if (existingMethods.length > 0 || userSnap.exists()) {
          alert('This Google account is already registered. Please log in instead.');
          await auth.signOut(); 
          navigate('/login');
          return;
        }

        await setDoc(
          userRef,
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

        alert('Google Sign-Up successful! Redirecting to dashboard...');
        navigate('/dashboard');
      } catch (error) {
        if (error.code !== 'auth/popup-closed-by-user') {
          alert('Google Login Failed: ' + error.message);
        }
      }
    };


   const handleFormSubmit = async (e) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      alert('Passwords do not match!');
      return;
    }

    try {
      const existingMethods = await fetchSignInMethodsForEmail(auth, email);

      if (existingMethods.length > 0) {
        const message =
          existingMethods.includes('google.com')
            ? `This email is already registered using Google Sign-In. Please log in using Google.`
            : `This email is already registered. Please log in instead.`;

        alert(message);
        return;
      }

      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await updateProfile(user, { displayName: name });

      await setDoc(doc(db, 'Sentry-User', user.uid), {
        name,
        email,
        uid: user.uid,
        provider: 'email',
        createdAt: new Date().toISOString(),
      });

      alert('Account successfully created! Please log in.');
      navigate('/login');
    } catch (error) {
      alert('Registration Failed: ' + error.message);
    }
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
              src={welcomeBot}
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

          <button type="button" className="google-button" onClick={handleGoogleLogin}>
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
            {/* NEW: Name Input Group */}
            <div className="input-group">
              <label htmlFor="signup-name">Parent/Guardian Name</label>
              <input
                type="text"
                id="signup-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                required
              />
            </div>
            {/* End NEW Name Input Group */}

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