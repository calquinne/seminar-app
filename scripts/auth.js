/* ========================================================================== */
/* MODULE: auth.js
/* Exports all authentication UI and state logic.
/* ========================================================================== */

// Firebase SDK Imports
import {
  onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut
  // Removed redirect imports
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

let unsubscribeUserSnap = null;

async function handleUserFound(user) {
  console.log("handleUserFound: User found", user.uid);
  
  if (unsubscribeUserSnap) {
    console.log("Unsubscribing from old user snapshot.");
    unsubscribeUserSnap();
  }

  const ref = doc(UI.db, `artifacts/${UI.getAppId()}/users/${user.uid}`);
  
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
        await setDoc(ref, profileData, { merge: true });
      } catch (e) {
        console.error("Failed to create profile doc:", e);
        UI.toast("Failed to create user profile.", "error");
      }
    }
    
    UI.updateUIAfterAuth(user, profileData);
    UI.showScreen("main-app");
    
    const manageTabButton = UI.$(".app-tab[data-tab='tab-manage']");
    if (manageTabButton) {
        manageTabButton.click();
    }

    flushOfflineQueue();
    
  }, (error) => {
    console.error("Profile snapshot error:", error);
    UI.toast("Failed to load user profile.", "error");
    signOut(UI.auth);
  });
}

/**
 * This is the main auth entry point.
 * It now *only* sets up the listener.
 */
export async function onAuthReady() {
  console.log("Auth initializing...");

 // Set up the auth state listener
onAuthStateChanged(UI.auth, async (user) => {
  if (user) {
    console.log("onAuthStateChanged: User is signed in:", user.uid);

    // ✅ Show toast with user name or email
    UI.toast(`Signed in as ${user.displayName || user.email}`, "success");

    await handleUserFound(user);
  } else {
    console.log("onAuthStateChanged: No user signed in.");

    if (unsubscribeUserSnap) {
      console.log("User signed out, unsubscribing from snapshot.");
      unsubscribeUserSnap();
      unsubscribeUserSnap = null;
    }

    UI.updateUIAfterAuth(null, { 
      role: "user", 
      activeSubscription: false, 
      storageUsedBytes: 0, 
      planStorageLimit: 1 
    });
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
      UI.toast("Account created! Signing in...", "success");
    } else {
      await signInWithEmailAndPassword(UI.auth, email, password);
      UI.toast("Signed in!", "success");
    }
  } catch (e) {
    console.error("Auth error:", e);
    UI.toast(e.message, "error");
  }
}

// ✅ UPDATED: Reverted to signInWithPopup
export async function handleGoogleSignIn() {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(UI.auth, provider);
    if (result?.user) {
      UI.toast("Signed in with Google!", "success");
      // The onAuthStateChanged listener will handle the rest.
    }
  } catch (e) {
    console.error("Google sign-in error:", e);
    // This will show the "auth/popup-blocked-by-browser" error if it happens
    UI.toast(`Error: ${e.code}`, "error");
  }
}

export function handleSignOut() {
    if (UI.auth) {
        signOut(UI.auth).catch(e => console.error("Sign out error", e));
    }
}