/* ========================================================================== */
/* MODULE: auth.js
/* Exports all authentication UI and state logic.
/* ========================================================================== */

// Firebase SDK Imports
import {
  onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut
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
/* -------------------------------------------------------------------------- */
export async function onAuthReady() {
  onAuthStateChanged(UI.auth, async (user) => {
    if (user) {
      console.log("onAuthStateChanged: User found", user.uid);
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
      
    } else {
      console.log("onAuthStateChanged: No user");
      UI.updateUIAfterAuth(null, { role: "user", activeSubscription: false, storageUsedBytes: 0, planStorageLimit: 1 });
      UI.showScreen("auth-screen");
      UI.$("#signout-btn").classList.add("hidden");
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Auth UI Handlers
/* -------------------------------------------------------------------------- */
export async function handleAuthFormSubmit(e) {
  e.preventDefault();
  const isSignUp = e.submitter?.id === 'auth-signup-btn'; // Use safe navigation
  const email = UI.$("#auth-email").value;
  const password = UI.$("#auth-password").value;
  
  try {
    if (isSignUp) {
      console.log("Attempting sign up...");
      await createUserWithEmailAndPassword(UI.auth, email, password);
      UI.toast("Account created! Please sign in.", "success");
    } else {
      console.log("Attempting sign in...");
      await signInWithEmailAndPassword(UI.auth, email, password);
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
    await signInWithPopup(UI.auth, provider);
    UI.toast("Signed in with Google!", "success");
  } catch (e) {
    console.error("Google sign-in error:", e);
    UI.toast(e.message, "error");
  }
}

export function handleSignOut() {
    if (UI.auth) {
        signOut(UI.auth).catch(e => console.error("Sign out error", e));
    }
}