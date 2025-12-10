// Firebase configuration for the Sentry extension
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  addDoc
} from "firebase/firestore";

// Firebase config - same as website
const firebaseConfig = {
  apiKey: "AIzaSyBHHl6UvVyyIg3a04sqL-Yg9HmsXhQVlHE",
  authDomain: "sentry-project-8f412.firebaseapp.com",
  projectId: "sentry-project-8f412",
  storageBucket: "sentry-project-8f412.firebasestorage.app",
  messagingSenderId: "768177512844",
  appId: "1:768177512844:web:57793f2876caea896cb6a9",
  measurementId: "G-FLDVYHHY4Z"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export {
  auth,
  db,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  addDoc
};
