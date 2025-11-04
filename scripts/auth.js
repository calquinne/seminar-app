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

// ✅ ADDED: Keep track of the snapshot listener
let unsubscribeUserSnap = null;

/**
 * A shared function to handle all the logic when a user is found.
 * This sets up their profile, loads their data, and shows the main app.
 */
async function handleUserFound(user) {
  console.log("handleUserFound: User found", user.uid);
  
  // ✅ ADDED: Unsubscribe from any previous user's listener
  if (unsubscribeUserSnap) {
    console.log("Unsubscribing from old user snapshot.");
    unsubscribeUserSnap();
  }

  const ref = doc(UI.db, `artifacts/${UI.getAppId()}/users/${user.uid}`);
  
  // ✅ ADDED: Store the new unsubscribe function
  unsubscribeUserSnap = onSnapshot(ref, async (snap) => {
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
        await setDoc(ref, profileData, { merge: true }); // Use merge for safety
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
 * It checks for the redirect *first*, then sets up the listener.
 */
export async function onAuthReady() {
  console.log("Auth initializing...");

  // 1️⃣ Small delay to ensure Firebase + SW fully loaded
  await new Promise(res => setTimeout(res, 300));

  // 2️⃣ Finish any pending redirect first
  try {
    const result = await getRedirectResult(UI.auth);
    if (result?.user) {
      console.log("Redirect sign-in completed:", result.user.uid);
      UI.toast("Signed in with Google!", "success");
      // handleUserFound() will run automatically via onAuthStateChanged
    }
  } catch (e) {
    console.error("Google redirect error:", e);
    UI.toast(e.message, "error");
  }

  // 3️⃣ Now attach the auth state listener
  onAuthStateChanged(UI.auth, async (user) => {
    if (user) {
      // A user is signed in (either from redirect or session).
      console.log("onAuthStateChanged: User is signed in:", user.uid);
      await handleUserFound(user);
    } else {
      // No user is signed in.
      console.log("onAuthStateChanged: No user signed in.");
      // ✅ ADDED: Unsubscribe listener on sign out
      if (unsubscribeUserSnap) {
        console.log("User signed out, unsubscribing from snapshot.");
        unsubscribeUserSnap();
        unsubscribeUserSnap = null;
      }
      UI.updateUIAfterAuth(null, { role: "user", activeSubscription: false, storageUsedBytes: 0, planStorageLimit: 1 });
      UI.showScreen("auth-screen");
    }
  });
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
      // Listener will catch this
      UI.toast("Account created! Signing in...", "success");
    } else {
      await signInWithEmailAndPassword(UI.auth, email, password);
      // Listener will catch this
      UI.toast("Signed in!", "success");
    }
  } catch (e) {
    console.error("Auth error:", e);
    UI.toast(e.message, "error");
  }
}

export async function handleGoogleSignIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" }); // Good for UX

  try {
    if (location.hostname === "localhost" || location.protocol === "file:") {
      // 🧩 Use popup locally (redirect often fails in dev)
      const result = await signInWithPopup(UI.auth, provider);
      if (result?.user) {
        UI.toast("Signed in with Google!", "success");
      }
    } else {
      // 🌐 Use redirect in production (for GitHub Pages)
      UI.toast("Redirecting to Google...", "info");
      await signInWithRedirect(UI.auth, provider);
    }
  } catch (e) {
    console.error("Google sign-in error:", e);
    UI.toast(e.message, "error");
  }
}

export function handleSignOut() {
    if (UI.auth) {
        signOut(UI.auth).catch(e => console.error("Sign out error", e));
        // The onAuthStateChanged listener will handle cleanup
    }
}