// Sentry Extension Popup - Authentication
/*global chrome*/

// Import Firebase modules
import { 
  auth, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  db,
  doc,
  getDoc,
  setDoc
} from '../src/firebase.js';

// DOM Elements
const signedOutView = document.getElementById('signedOutView');
const signedInView = document.getElementById('signedInView');
const emailSignInForm = document.getElementById('emailSignInForm');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const signOutBtn = document.getElementById('signOutBtn');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const signInText = document.getElementById('signInText');
const signInSpinner = document.getElementById('signInSpinner');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const userEmail = document.getElementById('userEmail');

// Show error message
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
  setTimeout(() => {
    errorMessage.classList.remove('show');
  }, 5000);
}

// Show success message
function showSuccess(message) {
  successMessage.textContent = message;
  successMessage.classList.add('show');
  setTimeout(() => {
    successMessage.classList.remove('show');
  }, 3000);
}

// Update UI based on auth state
async function updateUI(user) {
  if (user) {
    // User is signed in
    signedOutView.classList.remove('active');
    signedInView.classList.add('active');
    
    // Fetch user data from Firestore
    try {
      const userDoc = await getDoc(doc(db, 'Sentry-User', user.uid));
      const userData = userDoc.exists() ? userDoc.data() : {};
      
      const displayName = userData.name || user.displayName || user.email.split('@')[0];
      const userEmailText = user.email;
      
      // Update UI
      userName.textContent = displayName;
      userEmail.textContent = userEmailText;
      userAvatar.textContent = displayName.charAt(0).toUpperCase();
      
      // Store in Chrome storage for extension use
      await chrome.runtime.sendMessage({
        type: 'SET_CURRENT_USER',
        email: userEmailText,
        displayName: displayName,
        familyId: userData.familyId || ''
      });
      
      console.log('Sentry: User signed in:', displayName);
    } catch (error) {
      console.error('Sentry: Error fetching user data:', error);
      showError('Could not load user profile');
    }
  } else {
    // User is signed out
    signedOutView.classList.add('active');
    signedInView.classList.remove('active');
    
    // Clear Chrome storage
    await chrome.runtime.sendMessage({
      type: 'SET_CURRENT_USER',
      email: '',
      displayName: '',
      familyId: ''
    });
  }
}

// Email/Password Sign In
emailSignInForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  
  if (!email || !password) {
    showError('Please enter both email and password');
    return;
  }
  
  // Show loading
  signInText.style.display = 'none';
  signInSpinner.style.display = 'inline-block';
  
  try {
    await signInWithEmailAndPassword(auth, email, password);
    showSuccess('Signed in successfully!');
  } catch (error) {
    console.error('Sign in error:', error);
    
    if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
      showError('Invalid email or password');
    } else if (error.code === 'auth/user-not-found') {
      showError('No account found with this email');
    } else if (error.code === 'auth/invalid-email') {
      showError('Invalid email address');
    } else {
      showError('Failed to sign in. Please try again.');
    }
  } finally {
    // Hide loading
    signInText.style.display = 'inline';
    signInSpinner.style.display = 'none';
  }
});

// Google Sign In
googleSignInBtn.addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    
    // Check if user exists in Firestore, if not create profile
    const userDoc = await getDoc(doc(db, 'Sentry-User', user.uid));
    
    if (!userDoc.exists()) {
      // Create new user profile
      await setDoc(doc(db, 'Sentry-User', user.uid), {
        name: user.displayName || user.email.split('@')[0],
        email: user.email,
        createdAt: new Date().toISOString(),
        accountType: 'parent' // Default to parent account
      });
    }
    
    showSuccess('Signed in with Google successfully!');
  } catch (error) {
    console.error('Google sign in error:', error);
    
    if (error.code === 'auth/popup-closed-by-user') {
      // User closed popup, no error message needed
      return;
    }
    
    showError('Failed to sign in with Google. Please try again.');
  }
});

// Sign Out
signOutBtn.addEventListener('click', async () => {
  try {
    await signOut(auth);
    showSuccess('Signed out successfully');
  } catch (error) {
    console.error('Sign out error:', error);
    showError('Failed to sign out');
  }
});

// Listen for auth state changes
onAuthStateChanged(auth, (user) => {
  updateUI(user);
});

// Check current user on popup open
chrome.runtime.sendMessage({ type: 'GET_CURRENT_USER' }, (response) => {
  if (response && response.email) {
    console.log('Sentry: User already signed in:', response.email);
  }
});
