/* ========================================================================== */
/* MODULE: main.js
/* Main application entry point. Imports modules and wires up events.
/* ========================================================================== */

import * as UI from "./ui.js";
import * as Auth from "./auth.js";
import * as DB from "./firestore.js";
import * as Record from "./record.js";
import * as Rubrics from "./rubrics.js"; 
import * as Analytics from "./analytics.js";

// DEV MODE flag from URL: ?dev=1
window.__DEV_ANALYTICS__ = new URLSearchParams(window.location.search).get("dev") === "1";

console.log("DEV FLAG =", window.__DEV_ANALYTICS__, window.location.href);

/** Global app version (used for cache-busting and SW sync) */
export const APP_VERSION = "v14";

/* -------------------------------------------------------------------------- */
/* Event Listeners Setup
/* -------------------------------------------------------------------------- */
function setupEventListeners() {
  console.log("Setting up event listeners...");

  // 1. Header Navigation
  const helpBtn = UI.$("#nav-help");
  if (helpBtn) helpBtn.onclick = () => UI.$("#help-faq-screen").showModal();

  const accountBtn = UI.$("#nav-account");
  if (accountBtn) accountBtn.onclick = () => {
    const manageTabButton = UI.$(".app-tab[data-tab='tab-manage']");
    if (manageTabButton) manageTabButton.click();
  };

  const signoutBtn = UI.$("#signout-btn");
  if (signoutBtn) signoutBtn.onclick = Auth.handleSignOut;

  // 2. Setup Screen: Save Button
  const setupSave = UI.$("#setup-save");
  if (setupSave) {
    setupSave.onclick = () => {
      const rawConfig = UI.$("#setup-config").value.trim();
      if (!rawConfig) {
        UI.toast("Please paste a JSON config.", "error");
        return;
      }

      try {
        JSON.parse(rawConfig);
        localStorage.setItem(UI.LS.CFG, rawConfig);
        
        // Define storageChoiceEl before using it
        const storageChoiceEl = UI.$("#setup-storage-choice"); 
        const choice = (storageChoiceEl && storageChoiceEl.checked) ? storageChoiceEl.value : "firebase";
        UI.setStorageChoice(choice);

        UI.toast("Config saved. Reloading...", "success");
        setTimeout(() => window.location.reload(), 1000);
      } catch (e) {
        UI.toast("Invalid JSON format.", "error");
      }
    };
  }

  // 3. Setup Screen: Offline Button
  const setupOffline = UI.$("#setup-offline");
  if (setupOffline) {
    setupOffline.onclick = () => {
      localStorage.removeItem(UI.LS.CFG);
      UI.setStorageChoice("firebase"); // Default fallback
      UI.toast("Offline mode enabled.", "info");
      
      // Attempt to reload or let Auth handle the "no config" state
      window.location.reload();
    };
  }

  // 4. Auth Forms
  const authForm = UI.$("#auth-form");
  if (authForm) authForm.onsubmit = Auth.handleAuthFormSubmit;

  const googleBtn = UI.$("#auth-google-btn");
  if (googleBtn) googleBtn.onclick = Auth.handleGoogleSignIn;

  const signupForm = UI.$("#signup-form");
  if (signupForm) signupForm.onsubmit = Auth.handleAuthFormSubmit;

  // 5. Main App Tabs
  UI.$$(".app-tab").forEach((btn) => {
    btn.onclick = (e) => {
      // Standard UI Switching
      UI.handleTabClick(
        e,
        DB.refreshClassesList,      
        Rubrics.loadSavedRubrics,   
        Record.startPreviewSafely,  
        DB.loadLibrary              
      );

      // Analytics Trigger
      if (btn.dataset.tab === "tab-analytics") {
          Analytics.loadAnalytics();
      }
    };
  });
  
  // Rubric Sub-tabs
  UI.$$(".sub-tab").forEach((btn) => {
      btn.onclick = UI.handleRubricTabClick;
  });

  // 6. Rubric Builder
  const addRowBtn = UI.$("#add-rubric-row-btn");
  if (addRowBtn) addRowBtn.onclick = () => Rubrics.addBuilderRow();
  
  const saveRubricBtn = UI.$("#save-new-rubric-btn");
  if (saveRubricBtn) saveRubricBtn.onclick = Rubrics.saveRubric;
  
  // Initialize one empty row on load if builder exists
  if (UI.$("#rubric-builder-rows")) {
      Rubrics.addBuilderRow();
  }

  // 7. Class / Event Manager
  const newClassBtn = UI.$("#new-class-btn");
  if (newClassBtn) newClassBtn.onclick = UI.clearClassEditor;
  
  const saveClassBtn = UI.$("#save-class-btn");
  if (saveClassBtn) saveClassBtn.onclick = DB.handleSaveClass;
  
  const archiveClassBtn = UI.$("#archive-class-btn");
  if (archiveClassBtn) archiveClassBtn.onclick = DB.handleArchiveClass;
  
  const classesList = UI.$("#classes-list");
  if (classesList) classesList.onchange = (e) => UI.loadClassIntoEditor(e.target.value);

  const storageProvider = UI.$("#storage-provider");
  if (storageProvider) storageProvider.onchange = async (e) => {
    const confirmed = await UI.showConfirm(
      "Changing providers will hide all files from the old location in the app.",
      "Are you sure?",
      "Change"
    );
    if (confirmed) {
      UI.setStorageChoice(e.target.value);
      UI.toast(`Storage set to: ${e.target.value}`, "success");
    } else {
      e.target.value = UI.getStorageChoice();
    }
  };

  // 8. Record Tab Controls
  const startBtn = UI.$("#start-rec-btn");
  if (startBtn) startBtn.onclick = Record.startRecording;
  
  const pauseBtn = UI.$("#pause-rec-btn");
  if (pauseBtn) pauseBtn.onclick = Record.pauseOrResumeRecording;
  
  const stopBtn = UI.$("#stop-rec-btn");
  if (stopBtn) stopBtn.onclick = Record.stopRecording;
  
  const discardBtn = UI.$("#discard-rec-btn");
  if (discardBtn) discardBtn.onclick = Record.discardRecording;
  
  const toggleCamBtn = UI.$("#toggle-camera-btn");
  if (toggleCamBtn) toggleCamBtn.onclick = Record.toggleCamera;
  
  const tagBtn = UI.$("#tag-btn");
  if (tagBtn) tagBtn.onclick = Record.handleTagButtonClick;

  // Manual Preview Button
  const manualPreviewBtn = UI.$("#manual-preview-btn");
  if (manualPreviewBtn) {
    manualPreviewBtn.onclick = async () => {
      const previewScreen = UI.$("#preview-screen");
      const isActive = previewScreen && !previewScreen.classList.contains("hidden");

      if (!isActive) {
        await Record.startPreviewSafely();
        manualPreviewBtn.textContent = "Stop Preview";
      } else {
        const video = UI.$("#preview-player");
        if (video) {
            video.srcObject = null;
            video.src = "";
        }
        if (UI.mediaStream) {
            UI.mediaStream.getTracks().forEach(t => t.stop());
            UI.setMediaStream(null);
        }
        previewScreen.classList.add("hidden");
        manualPreviewBtn.textContent = "Start Preview";
      }
    };
  }

  // Preview Fullscreen
  const previewFS = UI.$("#preview-fullscreen-btn");
  if (previewFS) {
    previewFS.onclick = () => {
      const v = UI.$("#preview-player");
      if (v?.requestFullscreen) v.requestFullscreen();
    };
  }

  // 9. Metadata Screen
  const metaForm = UI.$("#metadata-form");
  if (metaForm) metaForm.onsubmit = (e) => Record.handleMetadataSubmit(e);
  
  const metaClass = UI.$("#meta-class");
  if (metaClass) metaClass.onchange = Record.handleMetadataClassChange;
  
  const metaPart = UI.$("#meta-participant");
  if (metaPart) metaPart.onchange = Record.handleMetadataParticipantChange;
  
  const addPartBtn = UI.$("#add-participant-btn");
  if (addPartBtn) addPartBtn.onclick = Record.handleAddNewParticipant;

  const cancelUploadBtn = UI.$("#cancel-upload-btn");
  if (cancelUploadBtn) cancelUploadBtn.onclick = async () => {
    const confirmed = await UI.showConfirm(
      "Discard recording?",
      "Cancel Upload?",
      "Discard"
    );
    if (confirmed) {
      UI.$("#metadata-screen").close();
      Record.discardRecording();
    }
  };

  // 10. Video Player Controls
  const playbackCloseBtn = UI.$("#playback-close-btn");
  if (playbackCloseBtn) playbackCloseBtn.onclick = () => UI.closeVideoPlayer();

  const legacyCloseBtn = UI.$("#player-close-btn");
  if (legacyCloseBtn) legacyCloseBtn.onclick = () => UI.closeVideoPlayer();

  const getMainPlayer = () => UI.$("#main-player");
  
  const vpBack = UI.$("#player-back-10");
  if (vpBack) vpBack.onclick = () => {
      const v = getMainPlayer();
      if (v) v.currentTime = Math.max(0, v.currentTime - 10);
  };

  const vpFwd = UI.$("#player-fwd-10");
  if (vpFwd) vpFwd.onclick = () => {
      const v = getMainPlayer();
      if (v) v.currentTime = Math.min(v.duration, v.currentTime + 10);
  };

  const vpSpeed = UI.$("#player-speed");
  if (vpSpeed) vpSpeed.onchange = () => {
      const v = getMainPlayer();
      if (v) v.playbackRate = parseFloat(vpSpeed.value) || 1;
  };

  const vpFullscreen = UI.$("#player-fullscreen-btn");
  if (vpFullscreen) vpFullscreen.onclick = () => {
      const v = getMainPlayer();
      if (v?.requestFullscreen) v.requestFullscreen();
  };

  // 11. Network Events
  window.addEventListener("online", () => {
    UI.toast("You're back online!", "success");
    DB.flushOfflineQueue();
  });

  window.addEventListener("offline", () => {
    UI.toast("You're offline. Recordings will be queued for upload.", "info");
  });

  // 12. Global Helpers
  UI.setupGlobalErrorHandlers();
  Auth.initAuthUI();

  console.log("Event listeners attached.");
} // <--- ✅ THIS IS THE FINAL CLOSING BRACE

/* -------------------------------------------------------------------------- */
/* APPLICATION BOOTSTRAP — SINGLE ENTRY POINT
/* -------------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 DOM Loaded. Starting App...");

  // 1. Wire UI (Synchronous)
  setupEventListeners();
  if (UI.registerSW) UI.registerSW();

  // 2. 🚧 DEV MODE — HARD SHORT CIRCUIT
  if (window.__DEV_ANALYTICS__) {
    console.warn("[DEV] 🚧 Bypassing Firebase & Auth (DEV Mode Active)");

    const fakeUser = {
      uid: "dev-user",
      email: "dev@local",
      displayName: "DEV USER"
    };

    // Mock UI for dev
    UI.updateUIAfterAuth(fakeUser, {
      role: "admin",
      activeSubscription: true,
      storageUsedBytes: 0,
      planStorageLimit: Infinity,
      planTier: "dev",
      isAdmin: true
    });

    UI.showScreen("main-app");
    return; // ⛔ STOP HERE. Do not Init Firebase.
  }

  // 3. Normal Boot
  UI.showScreen("loading-screen");

  // Check LocalStorage for config
  const config = localStorage.getItem(UI.LS.CFG);
  if (!config) {
    console.log("ℹ️ No config found. Redirecting to Setup.");
    UI.showScreen("setup-screen");
    return;
  }

  // Initialize Firebase
  try {
      const firebaseReady = await DB.initFirebase();
      if (!firebaseReady) {
        throw new Error("Init returned false");
      }
      // Start Auth Listener
      console.log("✅ Firebase Ready. Waiting for Auth...");
      Auth.onAuthReady();
  } catch (e) {
    console.error("❌ Boot Failed:", e);
    UI.showScreen("setup-screen");
  }
});