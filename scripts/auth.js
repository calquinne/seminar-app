/* ========================================================================== */
/* MODULE: auth.js (v2.1)
/* Authentication + profile wiring for Seminar Cloud App.
/* ========================================================================== */

// Firebase SDK Imports
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
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
import * as UI from "./ui.js";

// Import Firestore module for db operations
import { flushOfflineQueue } from "./firestore.js";

/* -------------------------------------------------------------------------- */
/* Internal State
/* -------------------------------------------------------------------------- */

let unsubscribeUserSnap = null;
let currentUserUid = null;

/* -------------------------------------------------------------------------- */
/* Helpers
/* -------------------------------------------------------------------------- */

function buildDefaultProfile(user) {
  const email = user?.email || "";
  const displayName = user?.displayName || "";

  return {
    role: "user",
    activeSubscription: false,
    storageUsedBytes: 0,
    planStorageLimit: 10 * 1e9,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),

    email,
    displayName,

    organizationName: "Default Organization",
    instructorName: displayName || email || "Instructor",

    planTier: "free",
    isAdmin: false
  };
}

function cleanupUserSnapshotListener() {
  if (unsubscribeUserSnap) {
    try {
      unsubscribeUserSnap();
    } catch (err) {
      console.warn("[Auth] Error while unsubscribing user snapshot:", err);
    }
    unsubscribeUserSnap = null;
  }
}

/* -------------------------------------------------------------------------- */
/* User Profile Handling
/* -------------------------------------------------------------------------- */

async function handleUserFound(user) {
  console.log("[Auth] handleUserFound: User found", user.uid);

  currentUserUid = user.uid;
  cleanupUserSnapshotListener();

  const appId = typeof UI.getAppId === "function" ? UI.getAppId() : "default-app";

  const ref = doc(UI.db, `artifacts/${appId}/users/${user.uid}`);

  try {
    const existing = await getDoc(ref);

    if (!existing.exists()) {
      console.log("[Auth] No profile doc, creating default profile.");
      const defaultProfile = buildDefaultProfile(user);
      await setDoc(ref, defaultProfile, { merge: true });
    } else {
      await setDoc(
        ref,
        { updatedAt: serverTimestamp() },
        { merge: true }
      );
    }
  } catch (e) {
    console.error("[Auth] Failed to ensure profile doc:", e);
    UI.toast("Failed to load or create your profile.", "error");
    try {
      await signOut(UI.auth);
    } catch (signOutErr) {
      console.error("[Auth] Error during forced sign-out:", signOutErr);
    }
    return;
  }

  unsubscribeUserSnap = onSnapshot(
    ref,
    async (snap) => {
      if (!currentUserUid || currentUserUid !== user.uid) {
        console.log("[Auth] Snapshot arrived for stale user; ignoring.");
        return;
      }

      let profileData;

      if (snap.exists()) {
        profileData = snap.data();
        console.log("[Auth] Profile snapshot loaded:", profileData);
      } else {
        console.warn("[Auth] Profile doc missing; recreating default profile.");
        profileData = buildDefaultProfile(user);
        try {
          await setDoc(ref, profileData, { merge: true });
        } catch (e) {
          console.error("[Auth] Failed to recreate profile doc:", e);
          UI.toast("Failed to recreate your profile.", "error");
        }
      }

      UI.updateUIAfterAuth(user, profileData);
      UI.showScreen("main-app");

      const manageTabButton = UI.$(".app-tab[data-tab='tab-manage']");
      if (manageTabButton) manageTabButton.click();

      try {
        await flushOfflineQueue();
      } catch (queueErr) {
        console.warn("[Auth] Failed to flush offline queue:", queueErr);
      }
    },
    (error) => {
      console.error("[Auth] Profile snapshot error:", error);
      UI.toast("Failed to load your profile. You have been signed out.", "error");

      cleanupUserSnapshotListener();
      currentUserUid = null;

      signOut(UI.auth).catch((signOutErr) => {
        console.error("[Auth] Error during sign out after snapshot failure:", signOutErr);
      });
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Auth Initialization
/* -------------------------------------------------------------------------- */

export async function onAuthReady() {
  console.log("[Auth] Initializing auth state listener...");

  onAuthStateChanged(
    UI.auth,
    async (user) => {
      if (user) {
        console.log("[Auth] onAuthStateChanged: User is signed in:", user.uid);
        currentUserUid = user.uid;

        UI.toast(`Signed in as ${user.displayName || user.email}`, "success");

        await handleUserFound(user);
      } else {
        console.log("[Auth] onAuthStateChanged: No user signed in.");
        currentUserUid = null;
        cleanupUserSnapshotListener();

        UI.updateUIAfterAuth(null, {
          role: "user",
          activeSubscription: false,
          storageUsedBytes: 0,
          planStorageLimit: 0,
          planTier: "free",
          isAdmin: false
        });

        UI.showScreen("auth-screen");
      }
    },
    (error) => {
      console.error("[Auth] Error in onAuthStateChanged:", error);
      UI.toast("Authentication system error. Please reload the app.", "error");
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Email/Password Auth UI Handler
/* -------------------------------------------------------------------------- */

export async function handleAuthFormSubmit(e) {
  e.preventDefault();

  const isSignUp = e.submitter?.id === "auth-signup-btn";
  const emailInput = UI.$("#auth-email");
  const passwordInput = UI.$("#auth-password");

  const email = emailInput?.value?.trim() || "";
  const password = passwordInput?.value || "";

  if (!email || !password) {
    UI.toast("Please enter both email and password.", "error");
    return;
  }

  try {
    if (isSignUp) {
      await createUserWithEmailAndPassword(UI.auth, email, password);
      UI.toast("Account created! Signing in...", "success");
    } else {
      await signInWithEmailAndPassword(UI.auth, email, password);
      UI.toast("Signed in!", "success");
    }
  } catch (e) {
    console.error("[Auth] Auth error:", e);
    const msg =
      e.code === "auth/user-not-found"
        ? "No account found with that email."
        : e.code === "auth/wrong-password"
        ? "Incorrect password."
        : e.code === "auth/email-already-in-use"
        ? "An account with that email already exists."
        : e.message;

    UI.toast(msg, "error");
  }
}

/* -------------------------------------------------------------------------- */
/* Google Sign-In Handler
/* -------------------------------------------------------------------------- */

export async function handleGoogleSignIn() {
  console.log("[Auth] Google sign-in clicked.");

  const provider = new GoogleAuthProvider();
  provider.addScope("profile");
  provider.addScope("email");

  try {
    const result = await signInWithPopup(UI.auth, provider);
    const user = result?.user;

    console.log("[Auth] Google sign-in success:", user?.email);
    UI.toast(`Signed in with Google as ${user?.email}`, "success");
  } catch (error) {
    console.error("[Auth] Google sign-in error:", error);

    const msg =
      error.code === "auth/popup-closed-by-user"
        ? "Google sign-in popup was closed."
        : error.code === "auth/cancelled-popup-request"
        ? "Sign-in already in progress."
        : `Google Sign-In failed: ${error.code || error.message}`;

    UI.toast(msg, "error");
  }
}

/* -------------------------------------------------------------------------- */
/* Password Reset
/* -------------------------------------------------------------------------- */

export async function sendPasswordReset(email) {
  const address = email?.trim();
  if (!address) {
    throw new Error("Email is required for password reset.");
  }

  if (!UI.auth) {
    throw new Error("Authentication is not ready yet. Please reload the app.");
  }

  try {
    await sendPasswordResetEmail(UI.auth, address);
    console.log(`[Auth] Password reset email sent to ${address}`);
    return true;
  } catch (error) {
    console.error("[Auth] Error sending password reset:", error);
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Sign Out
/* -------------------------------------------------------------------------- */

export async function handleSignOut() {
  try {
    await signOut(UI.auth);
    UI.toast("Signed out.", "info");
  } catch (e) {
    console.error("[Auth] Sign-out error:", e);
    UI.toast("Failed to sign out.", "error");
  }
}

/* -------------------------------------------------------------------------- */
/* Auth-related UI wiring (login/signup toggle + forgot password)
/* Called once from main.js AFTER DOM is ready.
/* -------------------------------------------------------------------------- */

export function initAuthUI() {
  console.log("[Auth] Wiring auth UI…");

  const loginScreen = document.getElementById("auth-screen");
  const signupScreen = document.getElementById("signup-screen");
  const signupBtn = document.getElementById("auth-signup-btn");
  const backToLoginLink = document.getElementById("back-to-login-link");

  function toggleScreens(showSignup = false) {
    if (!loginScreen || !signupScreen) return;
    if (showSignup) {
      loginScreen.classList.add("hidden");
      signupScreen.classList.remove("hidden");
    } else {
      signupScreen.classList.add("hidden");
      loginScreen.classList.remove("hidden");
    }
  }

  if (signupBtn) {
    signupBtn.addEventListener("click", (e) => {
      e.preventDefault();
      toggleScreens(true);
    });
  }

  if (backToLoginLink) {
    backToLoginLink.addEventListener("click", (e) => {
      e.preventDefault();
      toggleScreens(false);
    });
  }

  // Forgot Password UI
  const forgotLink = document.getElementById("forgot-password-link");
  const resetContainer = document.getElementById("reset-container");
  const sendBtn = document.getElementById("reset-send-btn");
  const cancelBtn = document.getElementById("reset-cancel-btn");
  const resetEmail = document.getElementById("reset-email");

  if (forgotLink && resetContainer && sendBtn && cancelBtn && resetEmail) {
    forgotLink.addEventListener("click", () => {
      resetContainer.classList.remove("hidden");
      forgotLink.classList.add("hidden");
    });

    cancelBtn.addEventListener("click", (e) => {
      e.preventDefault();
      resetContainer.classList.add("hidden");
      forgotLink.classList.remove("hidden");
      resetEmail.value = "";
    });

    sendBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = resetEmail.value.trim();
      if (!email) {
        UI.toast("Please enter your email address.", "error");
        return;
      }

      try {
        await sendPasswordReset(email);
        UI.toast("Password reset email sent! Check your inbox (or spam).", "success");
        resetContainer.classList.add("hidden");
        forgotLink.classList.remove("hidden");
        resetEmail.value = "";
      } catch (err) {
        UI.toast("Error sending reset email: " + (err.message || err), "error");
      }
    });
  }
}
