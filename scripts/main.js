/* ========================================================================== */
/* MODULE: main.js
/* Main application entry point. Imports modules and wires up events.
/* ========================================================================== */

import * as UI from "./ui.js";
import * as Auth from "./auth.js";
import * as DB from "./firestore.js";
import * as Record from "./record.js";
import * as Rubrics from "./rubrics.js"; 

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

  // 2. Setup Screen
  const setupSave = UI.$("#setup-save");
  if (setupSave) setupSave.onclick = () => {
    try {
      const configStr =
        UI.$("#firebase-config-json").value.trim() ||
        UI.$("#firebase-config-json").placeholder;
      const cfg = JSON.parse(configStr);
      localStorage.setItem(UI.LS.CFG, JSON.stringify(cfg));
      localStorage.setItem(UI.LS.APP, UI.$("#app-id-input").value || "seminar-cloud");
      UI.setStorageChoice(UI.$("input[name='storageChoice']:checked").value);

      if (DB.initFirebase()) {
        Auth.onAuthReady();
      } else {
        UI.toast("Firebase config appears invalid.", "error");
      }
    } catch (e) {
      UI.toast("Bad config JSON. " + e.message, "error");
    }
  };

  const setupOffline = UI.$("#setup-offline");
  if (setupOffline) setupOffline.onclick = () => {
    localStorage.removeItem(UI.LS.CFG);
    UI.setStorageChoice("firebase");
    UI.showScreen("auth-screen");
    UI.toast("Testing in offline mode. Firebase is disabled.", "info");
  };

  // 3. Auth Screen
  const authForm = UI.$("#auth-form");
  if (authForm) authForm.onsubmit = (e) => Auth.handleAuthFormSubmit(e);
  
  const googleBtn = UI.$("#auth-google-btn");
  if (googleBtn) googleBtn.onclick = Auth.handleGoogleSignIn;
  
  const signupForm = UI.$("#signup-form");
  if (signupForm) signupForm.onsubmit = (e) => Auth.handleAuthFormSubmit(e);

  // 4. Main App Tabs
  UI.$$(".app-tab").forEach((btn) => {
    btn.onclick = (e) =>
      UI.handleTabClick(
        e,
        DB.refreshClassesList,      // Manage Tab
        Rubrics.loadSavedRubrics,   // Rubrics Tab
        Record.startPreviewSafely,  // Record Tab
        DB.loadLibrary              // Library Tab
      );
  });
  
  // Rubric Sub-tabs (if any)
  UI.$$(".sub-tab").forEach((btn) => {
      btn.onclick = UI.handleRubricTabClick;
  });

  // 5. Rubric Builder
  const addRowBtn = UI.$("#add-rubric-row-btn");
  if (addRowBtn) addRowBtn.onclick = () => Rubrics.addBuilderRow();
  
  const saveRubricBtn = UI.$("#save-new-rubric-btn");
  if (saveRubricBtn) saveRubricBtn.onclick = Rubrics.saveRubric;
  
  // Initialize one empty row on load if builder exists
  if (UI.$("#rubric-builder-rows")) {
      Rubrics.addBuilderRow();
  }

  // 6. Class / Event Manager
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
      "Changing providers will hide all files from the old location in the app. This is for a 'fresh start' and does not move old data.",
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

  // 7. Record Tab Controls
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
        // Safe stop logic
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

  // 8. Metadata Screen (After Recording)
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
      "Are you sure you want to cancel and discard this recording?",
      "Cancel Upload?",
      "Discard"
    );
    if (confirmed) {
      UI.$("#metadata-screen").close();
      Record.discardRecording();
    }
  };

 // 9. Scoring Dialog / Player View (Updated for Playback IDs)
  // -----------------------------------------------------------------------
  // Listen for the NEW ID we added to index.html
  const playbackCloseBtn = UI.$("#playback-close-btn");
  
  if (playbackCloseBtn) {
      playbackCloseBtn.onclick = () => {
          UI.closeVideoPlayer();
      };
  }

  // Also listen for the old legacy ID just in case (safety)
  const legacyCloseBtn = UI.$("#player-close-btn");
  if (legacyCloseBtn) {
      legacyCloseBtn.onclick = () => {
          UI.closeVideoPlayer();
      };
  }
  // 10. Library Click Handler - REMOVED
  // Rationale: Logic is now handled via direct button binding in firestore.js (loadLibrary)
  // to ensure Single Source of Truth for opening videos.

  // 11. Video Player Controls
  const getMainPlayer = () => UI.$("#main-player");
  
  const vpClose = UI.$("#player-close-btn");
  if (vpClose) vpClose.onclick = () => UI.closeVideoPlayer();

  const vpBack = UI.$("#player-back-10");
  if (vpBack) {
    vpBack.onclick = () => {
      const v = getMainPlayer();
      if (v) v.currentTime = Math.max(0, v.currentTime - 10);
    };
  }

  const vpFwd = UI.$("#player-fwd-10");
  if (vpFwd) {
    vpFwd.onclick = () => {
      const v = getMainPlayer();
      if (v) v.currentTime = Math.min(v.duration, v.currentTime + 10);
    };
  }

  const vpSpeed = UI.$("#player-speed");
  if (vpSpeed) {
    vpSpeed.onchange = () => {
      const v = getMainPlayer();
      if (v) v.playbackRate = parseFloat(vpSpeed.value) || 1;
    };
  }

  const vpFullscreen = UI.$("#player-fullscreen-btn");
  if (vpFullscreen) {
    vpFullscreen.onclick = () => {
      const v = getMainPlayer();
      if (v?.requestFullscreen) v.requestFullscreen();
    };
  }

  // 12. Network Events
  window.addEventListener("online", () => {
    UI.toast("You're back online!", "success");
    DB.flushOfflineQueue();
  });

  window.addEventListener("offline", () => {
    UI.toast("You're offline. Recordings will be queued for upload.", "info");
  });

  UI.setupGlobalErrorHandlers();
  Auth.initAuthUI();

  console.log("Event listeners attached.");
}

/* -------------------------------------------------------------------------- */
/* Main App Boot Sequence
/* -------------------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded.");

  setupEventListeners();
  UI.registerSW();

  (async () => {
    const appVersion = APP_VERSION;
    const storedVersion = localStorage.getItem("appVersion");

    if (storedVersion !== appVersion) {
      console.log(`Cache mismatch. Stored: ${storedVersion}, New: ${appVersion}. Clearing cache…`);
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      localStorage.setItem("appVersion", appVersion);
      if (!sessionStorage.getItem("reloadDone")) {
        sessionStorage.setItem("reloadDone", "true");
        window.location.reload();
        return;
      }
    }
    sessionStorage.removeItem("reloadDone");

    UI.showScreen("loading-screen");

    const config = localStorage.getItem(UI.LS.CFG);
    if (config) {
      if (await DB.initFirebase()) {
        Auth.onAuthReady();
      } else {
        UI.showScreen("setup-screen");
      }
    } else {
      UI.showScreen("setup-screen");
    }
  })();
});