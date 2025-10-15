// src/firestore-database/firebase.js
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserSessionPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup,
  onAuthStateChanged,
  sendPasswordResetEmail,
  confirmPasswordReset,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser
} from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  onSnapshot,
  query,
  where
} from "firebase/firestore";

//not the official one - this is just a read-only config, shall change later
const firebaseConfig = {
  apiKey: "AIzaSyB1tR-ROctZg23DF0pssz8HJiv4gPRPxRg",
  authDomain: "sentry-9d594.firebaseapp.com",
  projectId: "sentry-9d594",
  storageBucket: "sentry-9d594.firebasestorage.app",
  messagingSenderId: "286452982653",
  appId: "1:286452982653:web:93a86dcb623d534cc62214",
  measurementId: "G-ESH4XLTXZH"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);

export {
  auth,
  db,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup,
  setPersistence,
  onAuthStateChanged,
  browserSessionPersistence,
  sendPasswordResetEmail,
  confirmPasswordReset,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser,
  doc,
  setDoc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  onSnapshot,
  query,
  where
};
