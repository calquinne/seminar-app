/* ========================================================================== */
/* MODULE: auth.js
/* Exports all authentication UI and state logic.
/* ========================================================================== */

// Firebase SDK Imports
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp
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

/**
 * Sends a password reset email to the specified address using Firebase Auth.
 * @param {string} email - The email address to send the password reset link to.
 * @returns {Promise<boolean>} Resolves to true if the email was sent successfully.
 * @throws Will throw an error if sending the password reset email fails (for UI.toast display).
 */
export async function sendPasswordReset(email) {
  try {
    // ✅ Import Firebase Auth functions dynamically (v11.6.1)
    const { getAuth, sendPasswordResetEmail } = await import(
      "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js"
    );

    const auth = getAuth();
    await sendPasswordResetEmail(auth, email);

    console.log(`Password reset email sent to ${email}`);
    return true;
  } catch (error) {
    console.error("Error sending password reset:", error);
    throw error; // rethrow so UI.toast in main.js can display error message
  }
}
