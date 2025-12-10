/* ========================================================================== */
/* MODULE: main.js – Main App Entry Point                                     */
/* ========================================================================== */

import * as UI from "./ui.js";
import * as Auth from "./auth.js";
import * as DB from "./firestore.js";
import * as Record from "./record.js";

/** Global app version (used for cache-busting and SW sync) */
export const APP_VERSION = "v13";

/* -------------------------------------------------------------------------- */
/* Event Listeners Setup                                                      */
/* -------------------------------------------------------------------------- */

function setupEventListeners() {
  console.log("Setting up event listeners...");

  /* ------------------------------ HEADER ---------------------------------- */
  UI.$("#nav-help").onclick = () => UI.$("#help-faq-screen").showModal();
  UI.$("#nav-account").onclick = () => {
    const manageTabButton = UI.$(".app-tab[data-tab='tab-manage']");
    if (manageTabButton) manageTabButton.click();
  };
  UI.$("#signout-btn").onclick = Auth.handleSignOut;

  /* ------------------------------ SETUP SCREEN ---------------------------- */
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

  /* ------------------------------ AUTH SCREEN ----------------------------- */
  UI.$("#auth-form").onsubmit = (e) => Auth.handleAuthFormSubmit(e);
  UI.$("#auth-google-btn").onclick = Auth.handleGoogleSignIn;
  UI.$("#signup-form").onsubmit = (e) => Auth.handleAuthFormSubmit(e);

  /* ------------------------------ MAIN TABS ------------------------------- */
  UI.$$(".app-tab").forEach(
    (btn) =>
      (btn.onclick = (e) =>
        UI.handleTabClick(
          e,
          DB.refreshClassesList,
          DB.refreshMyRubrics,
          Record.startPreviewSafely,
          DB.loadLibrary
        ))
  );

  /* ------------------------------ CLASS MANAGER --------------------------- */
  UI.$("#new-class-btn").onclick = UI.clearClassEditor;
  UI.$("#save-class-btn").onclick = DB.handleSaveClass;
  UI.$("#archive-class-btn").onclick = DB.handleArchiveClass;
  UI.$("#classes-list").onchange = (e) => UI.loadClassIntoEditor(e.target.value);

  UI.$("#storage-provider").onchange = async (e) => {
    const confirmed = await UI.showConfirm(
      "Changing providers will hide old files from the app. This does not delete anything.",
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

  UI.$("#upgrade-plan-btn").onclick = () =>
    UI.toast("Stripe checkout placeholder", "info");

  UI.$("#export-data-btn").onclick = () =>
    UI.toast("Export feature under construction", "info");

  /* ------------------------------ RUBRIC MANAGER -------------------------- */
  UI.$$(".sub-tab").forEach((btn) => (btn.onclick = UI.handleRubricTabClick));
  UI.$("#add-rubric-row-btn").onclick = UI.handleAddRubricRow;
  UI.$("#save-new-rubric-btn").onclick = DB.handleSaveNewRubric;

  UI.$("#my-rubrics-list").onclick = (e) => {
    DB.handleShareRubric(e);
    DB.handleDeleteRubric(e);
  };

 /* ------------------------------ RECORD TAB ------------------------------ */

UI.$("#start-rec-btn").onclick = Record.startRecording;
UI.$("#pause-rec-btn").onclick = Record.pauseOrResumeRecording;
UI.$("#stop-rec-btn").onclick = Record.stopRecording;
UI.$("#discard-rec-btn").onclick = Record.discardRecording;
UI.$("#toggle-camera-btn").onclick = Record.toggleCamera;

// ⭐ MANUAL PREVIEW BUTTON (Start/Stop Preview toggle)
const manualPreviewBtn = UI.$("#manual-preview-btn");
if (manualPreviewBtn) {
  manualPreviewBtn.onclick = async () => {
    const previewScreen = UI.$("#preview-screen");
    const isActive = previewScreen && !previewScreen.classList.contains("hidden");

    if (!isActive) {
      // --- Start Preview ---
      await Record.startPreviewSafely();
      manualPreviewBtn.textContent = "Stop Preview";
    } else {
      // --- Stop Preview ---
      Record.stopPreview();
      manualPreviewBtn.textContent = "Start Preview";
    }
  };
}

const tagBtn = UI.$("#tag-btn");
if (tagBtn) tagBtn.onclick = Record.handleTagButtonClick;

const previewFS = UI.$("#preview-fullscreen-btn");
if (previewFS) {
  previewFS.onclick = () => {
    const v = UI.$("#preview-player");
    if (v?.requestFullscreen) v.requestFullscreen();
  };
}

  /* ------------------------------ METADATA SCREEN ------------------------- */
  UI.$("#metadata-form").onsubmit = (e) => Record.handleMetadataSubmit(e);
  UI.$("#meta-class").onchange = Record.handleMetadataClassChange;
  UI.$("#meta-participant").onchange = Record.handleMetadataParticipantChange;
  UI.$("#add-participant-btn").onclick = Record.handleAddNewParticipant;

  UI.$("#cancel-upload-btn").onclick = async () => {
    const confirmed = await UI.showConfirm(
      "Discard this recording?",
      "Cancel Upload?",
      "Discard"
    );
    if (confirmed) {
      UI.$("#metadata-screen").close();
      Record.discardRecording();
    }
  };

  /* ------------------------------ SCORING DIALOG -------------------------- */
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

  /* ------------------------------ LIBRARY BUTTONS ------------------------- */
  UI.$("#library-list").onclick = (e) => {
    const target = e.target.closest("button,a");
    if (!target) return;

    if (target.dataset.scoreVideo) {
      DB.openScoringForVideo(target.dataset.scoreVideo);
      return;
    }
    if (target.dataset.openScore) {
      DB.openScoringForVideo(target.dataset.openScore);
      return;
    }
    if (target.dataset.del) {
      DB.handleDeleteVideo(target.dataset.del);
      return;
    }
    if (target.dataset.openLocal) {
      DB.handleOpenLocalVideo(target.dataset.title || "Local Video");
      return;
    }
    if (target.dataset.playUrl) {
      UI.openVideoPlayer(target.dataset.playUrl, target.dataset.title || "Video");
      return;
    }
  };

  /* ---------------------------------------------------------------------- */
  /* SPLIT-SCREEN VIDEO PLAYER CONTROLS                                     */
  /* ---------------------------------------------------------------------- */

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

  /* ------------------------------ NETWORK EVENTS -------------------------- */
  window.addEventListener("online", () => {
    UI.toast("You're back online!", "success");
    DB.flushOfflineQueue();
  });

  window.addEventListener("offline", () => {
    UI.toast("You're offline. Recording still works.", "info");
  });

  /* ------------------------------ FINAL SETUP ----------------------------- */
  UI.setupGlobalErrorHandlers();
  Auth.initAuthUI();

  console.log("Event listeners attached.");
}

/* -------------------------------------------------------------------------- */
/* Main App Boot Sequence                                                     */
/* -------------------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded.");
  setupEventListeners();
  UI.registerSW();

  (async () => {
    const storedVersion = localStorage.getItem("appVersion");
    if (storedVersion !== APP_VERSION) {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      localStorage.setItem("appVersion", APP_VERSION);
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
      if (await DB.initFirebase()) Auth.onAuthReady();
      else UI.showScreen("setup-screen");
    } else {
      UI.showScreen("setup-screen");
    }
  })();
});
