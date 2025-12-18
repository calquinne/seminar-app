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
  UI.$("#nav-help").onclick = () => UI.$("#help-faq-screen").showModal();
  UI.$("#nav-account").onclick = () => {
    const manageTabButton = UI.$(".app-tab[data-tab='tab-manage']");
    if (manageTabButton) manageTabButton.click();
  };
  UI.$("#signout-btn").onclick = Auth.handleSignOut;

  // 2. Setup Screen
  UI.$("#setup-save").onclick = () => {
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

  UI.$("#setup-offline").onclick = () => {
    localStorage.removeItem(UI.LS.CFG);
    UI.setStorageChoice("firebase");
    UI.showScreen("auth-screen");
    UI.toast("Testing in offline mode. Firebase is disabled.", "info");
  };

  // 3. Auth Screen
  UI.$("#auth-form").onsubmit = (e) => Auth.handleAuthFormSubmit(e);
  UI.$("#auth-google-btn").onclick = Auth.handleGoogleSignIn;
  UI.$("#signup-form").onsubmit = (e) => Auth.handleAuthFormSubmit(e);

  // 4. Main App Tabs
  UI.$$(".app-tab").forEach((btn) => {
    btn.onclick = (e) =>
      UI.handleTabClick(
        e,
        DB.refreshClassesList,      // Manage Tab
        Rubrics.loadSavedRubrics,   // Rubrics Tab
        Record.startPreview,        // Record Tab
        DB.loadLibrary              // Library Tab
      );
  });

  // 5. Rubric Builder
  const addRowBtn = UI.$("#add-rubric-row-btn");
  if (addRowBtn) addRowBtn.onclick = Rubrics.addBuilderRow;
  
  const saveRubricBtn = UI.$("#save-new-rubric-btn");
  if (saveRubricBtn) saveRubricBtn.onclick = Rubrics.saveRubric;
  
  // Initialize one empty row on load if builder exists
  if (UI.$("#rubric-builder-rows")) {
      Rubrics.addBuilderRow();
  }

  // 6. Class / Event Manager
  UI.$("#new-class-btn").onclick = UI.clearClassEditor;
  UI.$("#save-class-btn").onclick = DB.handleSaveClass;
  UI.$("#archive-class-btn").onclick = DB.handleArchiveClass;
  UI.$("#classes-list").onchange = (e) => UI.loadClassIntoEditor(e.target.value);

  UI.$("#storage-provider").onchange = async (e) => {
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
  UI.$("#start-rec-btn").onclick = Record.startRecording;
  UI.$("#pause-rec-btn").onclick = Record.pauseOrResumeRecording;
  UI.$("#stop-rec-btn").onclick = Record.stopRecording;
  UI.$("#discard-rec-btn").onclick = Record.discardRecording;
  UI.$("#toggle-camera-btn").onclick = Record.toggleCamera;
  
  const tagBtn = UI.$("#tag-btn");
  if (tagBtn) tagBtn.onclick = Record.handleTagButtonClick;

  // Manual Preview Button
  const manualPreviewBtn = UI.$("#manual-preview-btn");
  if (manualPreviewBtn) {
    manualPreviewBtn.onclick = async () => {
      const previewScreen = UI.$("#preview-screen");
      const isActive = previewScreen && !previewScreen.classList.contains("hidden");

      if (!isActive) {
        await Record.startPreview();
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
  UI.$("#metadata-form").onsubmit = (e) => Record.handleMetadataSubmit(e);
  UI.$("#meta-class").onchange = Record.handleMetadataClassChange;
  UI.$("#meta-participant").onchange = Record.handleMetadataParticipantChange;
  UI.$("#add-participant-btn").onclick = Record.handleAddNewParticipant;

  UI.$("#cancel-upload-btn").onclick = async () => {
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

  // 9. Scoring Dialog
  const scoringCancel = UI.$("#scoring-cancel-btn");
  const scoringClose = UI.$("#scoring-close-btn");
  const scoringSave = UI.$("#scoring-save-btn");

  if (scoringCancel) scoringCancel.onclick = () => UI.closeScoringDialog();
  if (scoringClose) scoringClose.onclick = () => UI.closeScoringDialog();

  if (scoringSave) {
    scoringSave.onclick = async (e) => {
      e.preventDefault();
      const scoringData = UI.collectScoringData();
      await DB.handleScoringSubmit(scoringData);
    };
  }

  // 10. Library Click Handler
  UI.$("#library-list").onclick = (e) => {
    const target = e.target.closest("button,a");
    if (!target) return;

    if (target.dataset.del) {
      DB.handleDeleteVideo(target.dataset.del);
      return;
    }
    if (target.dataset.openLocal) {
      const title = target.dataset.title || "Local Video";
      DB.handleOpenLocalVideo(title);
      return;
    }
    if (target.dataset.scoreVideo) {
      let videoId = target.dataset.scoreVideo;
      if (videoId.startsWith("%7B")) { 
         try { 
             const data = JSON.parse(decodeURIComponent(videoId));
             videoId = data.id;
         } catch(e) {}
      }
      DB.openScoringForVideo(videoId);
      return;
    }
  };

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