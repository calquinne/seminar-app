/* ========================================================================== */
/* MODULE: auth.js (v2.3 - Final Production)
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
import * as DB from "./firestore.js";
import { flushOfflineQueue } from "./firestore.js";

/* -------------------------------------------------------------------------- */
/* Internal State
/* -------------------------------------------------------------------------- */

let unsubscribeUserSnap = null;
let currentUserUid = null;
let authListenerAttached = false; // Prevents duplicate auth listeners

/* -------------------------------------------------------------------------- */
/* State Management Helpers (New!)
/* -------------------------------------------------------------------------- */

/**
 * Resets internal auth state.
 * Call this ONLY when manually tearing down Firebase (e.g. switching to offline mode).
 * Do NOT call this during normal sign-out.
 */
export function resetAuthState() {
  authListenerAttached = false;
  cleanupUserSnapshotListener();
  currentUserUid = null;
  console.warn("[Auth] Internal auth state explicitly reset.");
}

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
      console.log("[Auth] User snapshot listener detached.");
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

    if (!UI.db) {
        console.warn("[Auth] Firestore instance missing. Aborting profile load.");
        return;
    }

    currentUserUid = user.uid;
    cleanupUserSnapshotListener();

    const ref = doc(UI.db, "users", user.uid);

    try {
        const existing = await getDoc(ref);

        if (!UI.auth.currentUser || UI.auth.currentUser.uid !== user.uid) {
            console.warn("[Auth] Stale profile task detected after getDoc; aborting.");
            return;
        }

        if (!existing.exists()) {
            console.log("[Auth] No profile doc, creating default profile.");

            const defaultProfile = {
                email: user.email || "",
                displayName: user.displayName || "",
                organizationName: "Default Organization",
                instructorName: user.displayName || user.email || "Instructor",
                role: "user",
                isAdmin: false,
                isPro: false,
                activeSubscription: false,
                planTier: "free",
                storageUsedBytes: 0,
                planStorageLimit: 10 * 1e9,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };

            await setDoc(ref, defaultProfile, { merge: true });
        } else {
            await setDoc(
                ref,
                {
                    email: user.email || "",
                    displayName: user.displayName || "",
                    updatedAt: serverTimestamp()
                },
                { merge: true }
            );
        }

        if (!UI.auth.currentUser || UI.auth.currentUser.uid !== user.uid) {
            console.warn("[Auth] Stale profile task detected after setDoc; aborting.");
            return;
        }

    } catch (e) {
        console.error("[Auth] Failed to ensure profile doc:", e);

        if (!UI.auth.currentUser || UI.auth.currentUser.uid !== user.uid) {
            console.warn("[Auth] Ignoring profile error for stale user.");
            return;
        }

        UI.toast("Failed to load or create your profile.", "error");
        return; // ✅ No panic sign-out!
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

                profileData = {
                    email: user.email || "",
                    displayName: user.displayName || "",
                    organizationName: "Default Organization",
                    instructorName: user.displayName || user.email || "Instructor",
                    role: "user",
                    isAdmin: false,
                    isPro: false,
                    activeSubscription: false,
                    planTier: "free",
                    storageUsedBytes: 0,
                    planStorageLimit: 10 * 1e9,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                };

                try {
                    await setDoc(ref, profileData, { merge: true });
                } catch (e) {
                    console.error("[Auth] Failed to recreate profile doc:", e);

                    if (!UI.auth.currentUser || UI.auth.currentUser.uid !== user.uid) {
                        console.warn("[Auth] Ignoring recreate error for stale user.");
                        return;
                    }

                    UI.toast("Failed to recreate your profile.", "error");
                    return;
                }
            }

            if (!UI.auth.currentUser || UI.auth.currentUser.uid !== user.uid) {
                console.warn("[Auth] Stale snapshot task detected before UI update; aborting.");
                return;
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

            if (!UI.auth.currentUser || UI.auth.currentUser.uid !== user.uid) {
                console.warn("[Auth] Ignoring snapshot error for stale user.");
                return;
            }

            cleanupUserSnapshotListener();
            currentUserUid = null;
            UI.toast("Failed to load your profile.", "error");
            // ✅ No panic sign-out!
        }
    );
}

export async function onAuthReady() {
  // --------------------------------------------------
  // DEV MODE: bypass auth + firestore completely
  // --------------------------------------------------
  if (window.__DEV_ANALYTICS__) {
    console.warn("[DEV] Auth bypass enabled (UI only)");

    const fakeUser = {
      uid: "dev-user",
      displayName: "DEV USER",
      email: "dev@local.test"
    };

    UI.updateUIAfterAuth(fakeUser, {
      role: "admin",
      activeSubscription: true,
      storageUsedBytes: 0,
      planStorageLimit: Infinity,
      planTier: "dev",
      isAdmin: true
    });

    UI.showScreen("main-app");

    // Auto-open Analytics tab
    const analyticsTab = document.querySelector(
      ".app-tab[data-tab='tab-analytics']"
    );
    if (analyticsTab) analyticsTab.click();

    return; // ⛔ STOP HERE — no Firebase, no snapshots
  }

  // --------------------------------------------------
  // PROD AUTH
  // --------------------------------------------------
  
  // ✅ EDGE CASE FIX: Prevent double-wiring listeners
  if (authListenerAttached) {
    console.warn("[Auth] Auth listener already attached. Skipping.");
    return;
  }
  authListenerAttached = true;

onAuthStateChanged(UI.auth, async (user) => {
    if (user) {
        await handleUserFound(user);

        if (!UI.auth.currentUser || UI.auth.currentUser.uid !== user.uid) {
            console.warn("[Auth] Ignoring class load for stale ghost user.");
            return;
        }

        UI.setCurrentUser(user);

        try {
            const classes = await DB.loadClasses();

            if (!UI.auth.currentUser || UI.auth.currentUser.uid !== user.uid) {
                console.warn("[Auth] Ignoring stale class result.");
                return;
            }

            UI.setClassData(classes);
            DB.refreshClassesList?.();
            UI.refreshMetadataClassList?.();
        } catch (e) {
            if (!UI.auth.currentUser || UI.auth.currentUser.uid !== user.uid) {
                console.warn("[Auth] Ignoring stale class error.");
                return;
            }

            console.error("Failed to load classes after auth:", e);
            UI.toast("Failed to load classes.", "error");
        }
    } else {
        cleanupUserSnapshotListener();
        currentUserUid = null;

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
});

}

/* -------------------------------------------------------------------------- */
/* Email/Password Auth UI Handler
/* -------------------------------------------------------------------------- */

export async function handleAuthFormSubmit(e) {
    e.preventDefault();
    
    // 1. Detect which form triggered this submit!
    const isSignUp = e.target.id === "signup-form";
    
    // 2. Grab the inputs
    const emailInput = document.getElementById(isSignUp ? "signup-email" : "auth-email");
    const passwordInput = document.getElementById(isSignUp ? "signup-password" : "auth-password");
    const confirmInput = isSignUp ? document.getElementById("signup-confirm") : null;
    const promoInput = isSignUp ? document.getElementById("signup-promo") : null; // NEW!

    const email = emailInput?.value?.trim() || "";
    const password = passwordInput?.value || "";
    const promoCode = promoInput?.value?.trim().toUpperCase() || ""; // Standardize to uppercase

    // 3. Validation
    if (!email || !password) {
        UI.toast("Please enter both email and password.", "error");
        return;
    }

    if (isSignUp && confirmInput && password !== confirmInput.value) {
        UI.toast("Passwords do not match. Please try again.", "error");
        return;
    }

    // 4. Send to Firebase
    try {
        if (isSignUp) {
            // A. Mint the new user in Firebase Authentication
            const userCredential = await createUserWithEmailAndPassword(UI.auth, email, password);
            const user = userCredential.user;

            // B. Check for Founder or VIP Status
            const isFounder = email.toLowerCase() === "calquinne@gmail.com";
            const isPromoVIP = promoCode === "REELVIP2026"; // Feel free to change this code!
            
            // C. If they are special, permanently tag their database profile!
            // We use { merge: true } so it safely combines with your default profile builder
            if (isFounder || isPromoVIP) {
                await setDoc(doc(UI.db, "users", user.uid), {
                    role: isFounder ? "admin" : "user",
                    isPro: true,
                    activeSubscription: true,
                    promoUsed: isPromoVIP ? promoCode : "Founder"
                }, { merge: true });
            }

            UI.toast("Account created! Signing in...", "success");
        } else {
            await signInWithEmailAndPassword(UI.auth, email, password);
            UI.toast("Signed in!", "success");
        }
    } catch (error) {
        console.error("[Auth] error:", error);
        const msg = 
            error.code === "auth/user-not-found" ? "No account found with that email." :
            error.code === "auth/wrong-password" ? "Incorrect password." :
            error.code === "auth/email-already-in-use" ? "An account with that email already exists." : 
            error.message;
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
    // ✅ SAFETY: Detach listener BEFORE signing out
    cleanupUserSnapshotListener();
    currentUserUid = null;
    
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
  // 🚫 DEV MODE: Skip auth UI entirely
  if (window.__DEV_ANALYTICS__) {
    console.warn("[DEV] Skipping auth UI wiring");
    return;
  }

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
  const authForm = document.getElementById("auth-form");
    const signupForm = document.getElementById("signup-form");
    if (authForm) authForm.addEventListener("submit", handleAuthFormSubmit);
    if (signupForm) signupForm.addEventListener("submit", handleAuthFormSubmit);
}