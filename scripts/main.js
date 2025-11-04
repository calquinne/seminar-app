/* ========================================================================== */
/* MODULE: main.js
/* Main application entry point. Imports modules and wires up events.
/* ========================================================================== */

// Import all modules
import * as UI from './ui.js';
import * as Auth from './auth.js';
import * as DB from './firestore.js';
import * as Record from './record.js';

/* -------------------------------------------------------------------------- */
/* Event Listeners Setup
/* -------------------------------------------------------------------------- */
function setupEventListeners() {
  console.log("Setting up event listeners...");
  
  // Header
  UI.$("#nav-help").onclick = () => UI.$("#help-faq-screen").showModal();
  UI.$("#nav-account").onclick = () => {
    // Find the "Manage" tab button and simulate a click
    const manageTabButton = UI.$(".app-tab[data-tab='tab-manage']");
    if (manageTabButton) manageTabButton.click();
  };
  UI.$("#signout-btn").onclick = Auth.handleSignOut;

  // Setup Screen
  UI.$("#setup-save").onclick = () => {
    try {
      const configStr = UI.$("#firebase-config-json").value.trim() || UI.$("#firebase-config-json").placeholder;
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
    UI.setStorageChoice('firebase');
    UI.showScreen("auth-screen");
    UI.toast("Testing in offline mode. Firebase is disabled.", "info");
  };

  // Auth Screen
  UI.$("#auth-form").onsubmit = (e) => Auth.handleAuthFormSubmit(e);
  UI.$("#auth-google-btn").onclick = Auth.handleGoogleSignIn;

  // Main App Tabs
  // Pass the correct functions to the handler
  UI.$$(".app-tab").forEach(btn => btn.onclick = (e) => UI.handleTabClick(e, DB.refreshClassesList, DB.refreshMyRubrics, Record.startPreview, DB.loadLibrary));
  
  // Class / Event Manager
  UI.$("#new-class-btn").onclick = UI.clearClassEditor;
  UI.$("#save-class-btn").onclick = DB.handleSaveClass;
  UI.$("#archive-class-btn").onclick = DB.handleArchiveClass; // This is now async
  UI.$("#classes-list").onchange = (e) => UI.loadClassIntoEditor(e.target.value);
  
  // ✅ UPDATED: Now uses async/await for showConfirm
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
      e.target.value = UI.getStorageChoice(); // Revert
    }
  };
  UI.$("#upgrade-plan-btn").onclick = () => UI.toast("Stripe checkout placeholder", "info");
  UI.$("#export-data-btn").onclick = () => UI.toast("Export feature under construction", "info");

  // Rubric Manager
  UI.$$(".sub-tab").forEach(btn => btn.onclick = UI.handleRubricTabClick);
  UI.$("#add-rubric-row-btn").onclick = UI.handleAddRubricRow;
  UI.$("#save-new-rubric-btn").onclick = DB.handleSaveNewRubric;
  UI.$("#my-rubrics-list").onclick = (e) => {
    DB.handleShareRubric(e); // This is now async
    DB.handleDeleteRubric(e); // This is now async
  };

  // Record Tab
  UI.$("#start-rec-btn").onclick = Record.startRecording;
  UI.$("#pause-rec-btn").onclick = Record.pauseOrResumeRecording;
  UI.$("#stop-rec-btn").onclick = Record.stopRecording;
  UI.$("#discard-rec-btn").onclick = Record.discardRecording; // This is now async
  UI.$("#toggle-camera-btn").onclick = Record.toggleCamera;
  
  // Metadata Screen
  UI.$("#metadata-form").onsubmit = (e) => Record.handleMetadataSubmit(e);
  UI.$("#meta-class").onchange = Record.handleMetadataClassChange;
  UI.$("#meta-participant").onchange = Record.handleMetadataParticipantChange;
  UI.$("#add-participant-btn").onclick = Record.handleAddNewParticipant;

  // ✅ UPDATED: Now uses async/await for showConfirm
  UI.$("#cancel-upload-btn").onclick = async () => {
    const confirmed = await UI.showConfirm("Are you sure you want to cancel and discard this recording?", "Cancel Upload?", "Discard");
    if (confirmed) {
      UI.$("#metadata-screen").close();
      Record.discardRecording(); // This will clear the blob and reset UI
    }
  };
  
  // Library
  UI.$("#library-list").onclick = (e) => {
    if (e.target.dataset.del) {
      DB.handleDeleteVideo(e.target.dataset.del); // This is now async
    }
  };

  // Placeholders
  UI.$("#subscribe-btn")?.addEventListener("click", UI.redirectToStripeCheckout);

  // Global Listeners
  window.addEventListener("online", () => {
    UI.toast("You're back online!", "success");
    DB.flushOfflineQueue();
  });
  
  window.addEventListener("offline", () => {
    UI.toast("You're offline. Recordings will be queued for upload.", "info");
  });
  
  UI.setupGlobalErrorHandlers();
  
  console.log("Event listeners attached.");
}

/* -------------------------------------------------------------------------- */
/* Main App Boot Sequence
/* -------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM loaded.");
  setupEventListeners(); 
  UI.registerSW(); // Register the static service worker
  
  (async () => {
    UI.showScreen("loading-screen");

    // ✅ Cache-busting: ensures old SW caches are cleared whenever version changes
// Must match CACHE_NAME in sca-sw.js (e.g. seminar-cloud-cache-v7)

    const appVersion = "v7"; // This must match your service worker
    const storedVersion = localStorage.getItem("appVersion");

    if (storedVersion !== appVersion) {
      console.log(`Cache mismatch. Stored: ${storedVersion}, New: ${appVersion}. Clearing cache…`);
      if (window.caches) {
        await caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))));
      }
      localStorage.setItem("appVersion", appVersion);
      window.location.reload();
      return;
    }
    // ✅ End of cache-busting block

    
    const config = localStorage.getItem(UI.LS.CFG);
    if (config) {
      console.log("Config found, initializing Firebase...");
      if (await DB.initFirebase()) { 
        Auth.onAuthReady();
      } else {
        console.log("Config invalid, showing setup.");
        UI.showScreen("setup-screen");
      }
    } else {
      console.log("No config, showing setup screen.");
      UI.showScreen("setup-screen");
    }
  })();
});