/* ========================================================================== */
/* MODULE: auth.js
/* Exports all authentication UI and state logic.
/* ========================================================================== */

// Firebase SDK Imports
import {
  onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  signInWithRedirect, getRedirectResult
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  doc, getDoc, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Import UI module for state and utils
import * as UI from './ui.js';
// Import Firestore module for db operations
import { flushOfflineQueue } from './firestore.js';

/* -------------------------------------------------------------------------- */
/* Auth State Management
/* ========================================================================== */

/**
 * A shared function to handle all the logic when a user is found.
 * This sets up their profile, loads their data, and shows the main app.
 */
async function handleUserFound(user) {
  console.log("handleUserFound: User found", user.uid);
  const ref = doc(UI.db, `artifacts/${UI.getAppId()}/users/${user.uid}`);
  
  onSnapshot(ref, async (snap) => {
    let profileData;
    if (snap.exists()) {
      profileData = snap.data();
      console.log("Profile snapshot loaded:", profileData);
    } else {
      console.log("No profile doc, creating one.");
      profileData = { 
        role: "user", 
        activeSubscription: false,
        storageUsedBytes: 0,
        planStorageLimit: 10 * 1e9,
        createdAt: serverTimestamp(),
        organizationName: "Default Organization",
        instructorName: user.email || "Instructor"
      };
      try {
        await setDoc(ref, profileData);
      } catch (e) {
        console.error("Failed to create profile doc:", e);
        UI.toast("Failed to create user profile.", "error");
      }
    }
    
    UI.updateUIAfterAuth(user, profileData);
    UI.showScreen("main-app");
    
    // Find the "Manage" tab button and simulate a click to set it as default
    const manageTabButton = UI.$(".app-tab[data-tab='tab-manage']");
    if (manageTabButton) {
        manageTabButton.click();
    }

    // Flush offline queue *after* auth is confirmed
    flushOfflineQueue();
    
  }, (error) => {
    console.error("Profile snapshot error:", error);
    UI.toast("Failed to load user profile.", "error");
    signOut(UI.auth);
  });
}

/**
 * This is the main auth entry point, called when the app boots.
 * It sets up the *listener* first, then checks for a redirect.
 */
export async function onAuthReady() {
  
  // 1. SET UP THE LISTENER FIRST
  // This is the single source of truth for auth state.
  onAuthStateChanged(UI.auth, async (user) => {
    if (user) {
      // A user is signed in (either from redirect or session).
      await handleUserFound(user);
    } else {
      // No user is signed in.
      console.log("onAuthStateChanged: No user");
      UI.updateUIAfterAuth(null, { role: "user", activeSubscription: false, storageUsedBytes: 0, planStorageLimit: 1 });
      UI.showScreen("auth-screen");
    }
  });
  
  // 2. NOW, CHECK FOR THE REDIRECT RESULT
  // This will complete the sign-in and trigger the listener above.
  try {
    const result = await getRedirectResult(UI.auth);
    if (result) {
      // A redirect just completed.
      // The listener above will handle the user.
      UI.toast("Signed in with Google!", "success");
    }
    // If result is null, it means no redirect happened,
    // and the listener above has already handled the "no user" case.
  } catch (e) {
    console.error("Google redirect error:", e);
    UI.toast(e.message, "error");
  }
}

/* -------------------------------------------------------------------------- */
/* Auth UI Handlers
/* ========================================================================== */

export async function handleAuthFormSubmit(e) {
  e.preventDefault();
  const isSignUp = e.submitter?.id === 'auth-signup-btn';
  const email = UI.$("#auth-email").value;
  const password = UI.$("#auth-password").value;
  
  try {
    if (isSignUp) {
      await createUserWithEmailAndPassword(UI.auth, email, password);
      // We don't need to do anything else.
      // The onAuthStateChanged listener will see the new user and run handleUserFound.
      UI.toast("Account created! Signing in...", "success");
    } else {
      await signInWithEmailAndPassword(UI.auth, email, password);
      // The onAuthStateChanged listener will see the user and run handleUserFound.
      UI.toast("Signed in!", "success");
    }
  } catch (e) {
    console.error("Auth error:", e);
    UI.toast(e.message, "error");
  }
}

export async function handleGoogleSignIn() {
  const provider = new GoogleAuthProvider();
  try {
    // This will redirect the user to Google, then bring them back
    await signInWithRedirect(UI.auth, provider);
  } catch (e) {
    console.error("Google sign-in error:", e);
    UI.toast(e.message, "error");
  }
}

export function handleSignOut() {
    if (UI.auth) {
        signOut(UI.auth).catch(e => console.error("Sign out error", e));
        // The onAuthStateChanged listener will see the user is null and show the auth-screen.
    }
}