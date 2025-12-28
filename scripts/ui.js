/* ========================================================================== */
/* MODULE: ui.js 
/* Exports shared state, constants, and UI helper functions.
/* ========================================================================== */
import * as Record from "./record.js";
import * as Rubrics from "./rubrics.js"; 

// ❗ Removed APP_VERSION import to avoid circular dependency with main.js

/* -------------------------------------------------------------------------- */
/* Constants
/* -------------------------------------------------------------------------- */
export const LS = { CFG: "sc/firebaseConfig", APP: "sc/appId", STORE: "sc/storageChoice" };
export const IDB_NAME = "seminar-cloud";
export const IDB_STORE = "pendingUploads";

/* -------------------------------------------------------------------------- */
/* Shared State
/* -------------------------------------------------------------------------- */
export let app, auth, db, storage;
export let currentUser = null;
export let userDoc = { role: "user", activeSubscription: false, storageUsedBytes: 0, planStorageLimit: 1 };
export let classData = {};
export let mediaStream = null;
export let mediaRecorder = null;
export let recordedChunks = [];
export let currentRecordingBlob = null;
export let timerInterval = null;
export let secondsElapsed = 0;
export let currentFacingMode = "environment";

// Setters for state
export function setFirebase(a, au, d, s) { app = a; auth = au; db = d; storage = s; }
export function setCurrentUser(u) { currentUser = u; }
export function setUserDoc(doc) { userDoc = doc; }
export function setClassData(data) { classData = data; }
export function setMediaStream(s) { mediaStream = s; }
export function setMediaRecorder(r) { mediaRecorder = r; }
export function setRecordedChunks(c) { recordedChunks = c; }
export function setCurrentRecordingBlob(b) { currentRecordingBlob = b; }
export function setTimerInterval(i) { timerInterval = i; }
export function setSecondsElapsed(s) { secondsElapsed = s; }
export function setCurrentFacingMode(m) { currentFacingMode = m; }

/* -------------------------------------------------------------- */
/* Storage Choice (firebase | gdrive | local)                     */
/* -------------------------------------------------------------- */
export function getStorageChoice() {
  return localStorage.getItem(LS.STORE) || "firebase";
}
export function setStorageChoice(choice) {
  localStorage.setItem(LS.STORE, choice);

  const sel = $("#storage-provider");
  if (sel) sel.value = choice;

  const pill = $("#account-pill");
  if (pill) pill.textContent = `Role: ${userDoc?.role || '...'} • Storage: ${choice}`;
}

/* -------------------------------------------------------------------------- */
/* DOM Utilities
/* -------------------------------------------------------------------------- */
export const $ = (s) => document.querySelector(s);
export const $$ = (s) => Array.from(document.querySelectorAll(s));

export function toast(msg, type = "info") {
  const container = $("#toast-container");
  if (container.children.length >= 3) {
    container.removeChild(container.firstChild);
  }

  const el = document.createElement("div");
  el.className = `px-3 py-2 rounded-lg text-sm border fade-enter
    ${type === "error" ? "bg-red-500/20 border-red-500/40 text-red-200" :
    type ==="success" ? "bg-emerald-500/20 border-emerald-500/44 text-emerald-200" :
    "bg-white/10 border-white/20 text-white"}`;
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('fade-enter-active'));
  setTimeout(() => {
    el.classList.remove('fade-enter-active');
    setTimeout(() => el.remove(), 200);
  }, 3000);
}

export function showScreen(id) {
  const known = ["loading-screen","setup-screen","auth-screen","main-app"];
  if (known.includes(id)) {
    known.forEach(s => {
      const el = $(`#${s}`);
      if (el) el.classList.toggle("hidden", s !== id);
    });
  }
  
  if (id === 'metadata-screen') {
    $("#metadata-screen").showModal();
  } else {
    const meta = $("#metadata-screen");
    if (meta && meta.open) meta.close();
  }
}

/* -------------------------------------------------------------------------- */
/* Config Getters/Setters
/* -------------------------------------------------------------------------- */
export function getAppId() { return localStorage.getItem(LS.APP) || "seminar-cloud"; }

/* -------------------------------------------------------------------------- */
/* UI Updaters
/* -------------------------------------------------------------------------- */
export function updateRecordingUI(state) {
  const isIdle = state === 'idle';
  const isRecording = state === 'recording';
  const isPaused = state === 'paused';
  const isStopped = state === 'stopped';

  $("#start-rec-btn").classList.toggle('hidden', !isIdle);
  $("#stop-rec-btn").classList.toggle('hidden', !isRecording && !isPaused);
  $("#discard-rec-btn").classList.toggle('hidden', !isRecording && !isPaused);
  
  $("#pause-rec-btn").disabled = !isRecording && !isPaused;
  $("#toggle-camera-btn").disabled = isRecording || isPaused;
  
  $("#pause-rec-btn").textContent = isPaused ? 'Resume' : 'Pause';
  
  if (isIdle) {
    $("#rec-status").textContent = "Idle";
    $("#rec-status").classList.remove('text-red-400', 'text-amber-400');
  } else if (isRecording) {
    $("#rec-status").textContent = "Recording";
    $("#rec-status").classList.add('text-red-400');
    $("#rec-status").classList.remove('text-amber-400');
  } else if (isPaused) {
    $("#rec-status").textContent = "Paused";
    $("#rec-status").classList.add('text-amber-400');
    $("#rec-status").classList.remove('text-red-400');
  } else if (isStopped) {
    $("#rec-status").textContent = "Stopped";
    $("#rec-status").classList.remove('text-red-400', 'text-amber-400');
  }
}

export function hasAccess() {
  return userDoc.activeSubscription || userDoc.role === "admin" || userDoc.role === "tester";
}

export function updateUIAfterAuth(u, docData) {
  setCurrentUser(u);
  setUserDoc(docData);

  $("#signout-btn").classList.toggle("hidden", !u);
  
  const access = hasAccess();
  $("#paywall-banner").classList.toggle("hidden", access);

  $$("#save-class-btn, #archive-class-btn, #save-new-rubric-btn").forEach(el => {
    if(el) {
      el.disabled = !access;
      el.classList.toggle("opacity-50", !access);
      el.classList.toggle("cursor-not-allowed", !access);
    }
  });

  const storageChoice = getStorageChoice();
  $("#storage-provider").value = storageChoice;
  $("#account-pill").textContent = `Role: ${userDoc.role} • Storage: ${storageChoice}`;
  
  const storageUsed = userDoc.storageUsedBytes || 0;
  const storageLimit = userDoc.planStorageLimit || 1;
  const percentUsed = Math.min(100, Math.max(0, (storageUsed / storageLimit) * 100));
  
  $("#storage-used").textContent = `${(storageUsed / 1e9).toFixed(2)} GB`;
  $("#storage-limit").textContent = `${(storageLimit / 1e9).toFixed(1)} GB`;
  $("#storage-progress").style.width = `${percentUsed}%`;
  
  $("#low-storage-banner").classList.toggle("hidden", percentUsed < 90);
}

export function loadClassIntoEditor(classId) {
  const cls = classData[classId];
  if (!cls) {
    $("#class-title").value = "";
    $("#class-archive-date").value = "";
    $("#class-delete-date").value = "";
    $("#class-roster").value = "";
    return;
  }
  $("#class-title").value = cls.title || "";
  $("#class-archive-date").value = cls.archiveDate || "";
  $("#class-delete-date").value = cls.deleteDate || "";
  $("#class-roster").value = (cls.participants || []).join('\n');
}

export function clearClassEditor() {
  $("#classes-list").value = "";
  $("#class-title").value = "";
  $("#class-archive-date").value = "";
  $("#class-delete-date").value = "";
  $("#class-roster").value = "";
  $("#class-title").focus();
}

export function refreshMetadataClassList() {
  const metaClassSelect = $("#meta-class");
  metaClassSelect.innerHTML = '<option value="">-- Select a Class / Event --</option>';
  
  Object.values(classData).forEach(classDoc => {
    if (!classDoc.archived) {
      const metaOpt = document.createElement("option");
      metaOpt.value = classDoc.id;
      metaOpt.textContent = classDoc.title || "Untitled";
      metaClassSelect.appendChild(metaOpt);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Global Event Handlers
/* -------------------------------------------------------------------------- */
export function handleTabClick(e, refreshClassesList, refreshMyRubrics, startPreviewSafely, loadLibrary) {
  const btn = e.target.closest(".app-tab");
  if (!btn) return;

  const tabId = btn.dataset.tab;

  if (!hasAccess() && (tabId === 'tab-record' || tabId === 'tab-library' || tabId === 'tab-analytics')) {
    toast("This feature requires an active subscription.", "error");
    return;
  }

  $$(".app-tab-content").forEach(el => {
    if (el) el.classList.add("hidden");
  });

  const metaScreen = $("#metadata-screen");
  if (metaScreen && metaScreen.open) metaScreen.close();

  $(`#${tabId}`)?.classList.remove("hidden");

  $$(".app-tab").forEach(el =>
    el.setAttribute("aria-selected", el.dataset.tab === tabId)
  );

  console.log(`Switched to tab: ${tabId}`);

  // Fix preview visibility when entering Record tab
  if (tabId === "tab-record") {
    const previewScreen = $("#preview-screen");
    const previewBtn = $("#manual-preview-btn");

    if (previewScreen) {
      previewScreen.classList.add("hidden");
      previewScreen.classList.remove("recording-active", "paused-border");
    }

    if (previewBtn) {
      previewBtn.classList.remove("hidden");
      previewBtn.textContent = "Start Preview";
    }
  }

  if (tabId !== 'tab-record') {
    const progressEl = $("#upload-progress");
    if (progressEl) progressEl.style.width = '0%';
  }

  if (tabId === 'tab-manage') {
    refreshClassesList();
  }

  if (tabId === 'tab-rubrics') {
    refreshMyRubrics();
  }
  
  if (tabId === 'tab-library') {
    loadLibrary();
  }
}

export function handleRubricTabClick(e) {
  const btn = e.target.closest(".sub-tab");
  if (!btn) return;
  
  const tabId = btn.dataset.subtab;
  $$(".rubric-sub-tab-content").forEach(el => el.classList.toggle("hidden", el.id !== tabId));
  $$(".sub-tab").forEach(el => el.setAttribute("aria-selected", el.dataset.subtab === tabId));
}

export function handleAddRubricRow() {
  // Deprecated UI helper, now handled in Rubrics.js addBuilderRow
  // Kept only if legacy HTML still calls it, but likely safe to remove if main.js is updated.
}

/* -------------------------------------------------------------------------- */
/* Reusable Confirmation Modal
/* -------------------------------------------------------------------------- */
let confirmPromiseResolver = null;

export function showConfirm(message, title = "Are you sure?", confirmText = "OK") {
  const modal = $("#confirm-modal");
  const msgEl = $("#confirm-message");
  const titleEl = $("#confirm-title");
  const yesBtn = $("#confirm-btn-yes");
  const noBtn = $("#confirm-btn-no");

  msgEl.textContent = message;
  titleEl.textContent = title;
  yesBtn.textContent = confirmText;

  if (confirmText.toLowerCase() === 'delete' || confirmText.toLowerCase() === 'discard') {
    yesBtn.classList.remove('bg-primary-600', 'hover:bg-primary-500');
    yesBtn.classList.add('bg-red-600', 'hover:bg-red-500');
  } else {
    yesBtn.classList.remove('bg-red-600', 'hover:bg-red-500');
    yesBtn.classList.add('bg-primary-600', 'hover:bg-primary-500');
  }
  
  modal.showModal();

  return new Promise((resolve) => {
    confirmPromiseResolver = resolve;

    // Remove old listeners to prevent stacking
    const newYes = yesBtn.cloneNode(true);
    const newNo = noBtn.cloneNode(true);
    yesBtn.parentNode.replaceChild(newYes, yesBtn);
    noBtn.parentNode.replaceChild(newNo, noBtn);

    newYes.addEventListener('click', () => {
       modal.close();
       resolve(true);
    });

    newNo.addEventListener('click', () => {
       modal.close();
       resolve(false);
    });
      
    modal.onclose = () => {
       if (modal.returnValue !== 'true') resolve(false);
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Error Handlers & Placeholders
/* -------------------------------------------------------------------------- */
export function setupGlobalErrorHandlers() {
  window.onerror = (m, s, l, c, e) => {
    const error = e || m;
    console.error("Global Error:", error);
    $("#error-display").textContent = `Error: ${error.message || m}\nAt: ${s}:${l}:${c}`;
    $("#error-display").classList.remove("hidden");
  };
  window.onunhandledrejection = (event) => {
    console.error("Unhandled Rejection:", event.reason);
    $("#error-display").textContent = `Error: ${event.reason?.message || event.reason}`;
    $("#error-display").classList.remove("hidden");
  };
  window.addEventListener('beforeunload', e => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      e.preventDefault(); 
      e.returnValue = '';
    }
  });
}

export function mockUpdateStorageUsage(bytes){
  if (!userDoc) return;
  userDoc.storageUsedBytes = bytes;
  updateUIAfterAuth(currentUser, userDoc);
  console.log(`Mock storage usage updated to ${(bytes / 1e9).toFixed(2)} GB`);
}

export function uploadToDrivePlaceholder(file, meta){
  console.log("Drive upload placeholder", file?.size, meta);
  toast("Google Drive upload not yet implemented.","info");
}

/* -------------------------------------------------------------------------- */
/* PWA Service Worker Registration
/* -------------------------------------------------------------------------- */
export async function registerSW() {
  if (!("serviceWorker" in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register("./sca-sw.js", { scope: "./" });
    console.log("✅ Service Worker registered successfully.");

    if (!document.getElementById("update-banner-style")) {
      const style = document.createElement("style");
      style.id = "update-banner-style";
      style.textContent = `
        @keyframes slideDownFade { 0% { opacity: 0; transform: translate(-50%, -30px); } 100% { opacity: 1; transform: translate(-50%, 0); } }
        @keyframes slideUpFadeOut { 0% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; transform: translate(-50%, -30px); } }
        @keyframes pingGlow { 0% { box-shadow: 0 0 0 0 rgba(14,116,144,0.6); } 70% { box-shadow: 0 0 0 12px rgba(14,116,144,0); } 100% { box-shadow: 0 0 0 0 rgba(14,116,144,0); } }
        #update-banner { animation: slideDownFade 0.5s ease-out forwards, pingGlow 1.4s ease-out 0.3s; text-shadow: 0 0 4px rgba(0,0,0,0.5); }
        #update-banner.fade-out { animation: slideUpFadeOut 0.5s ease-in forwards; }
      `;
      document.head.appendChild(style);
    }

    reg.onupdatefound = () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.onstatechange = () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            const banner = document.createElement("div");
            banner.id = "update-banner";
            banner.className = `fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#0e7490]/90 backdrop-blur-md text-white text-sm px-5 py-2.5 rounded-2xl shadow-lg border border-white/10 cursor-pointer transition hover:bg-[#0e7490]/100`;
            banner.textContent = "🔄 A new update is available — click to refresh";
            banner.onclick = () => {
              newWorker.postMessage({ type: "SKIP_WAITING" });
              banner.textContent = "⏳ Updating…";
              banner.classList.add("opacity-80");
              setTimeout(() => window.location.reload(), 500);
            };
            document.body.appendChild(banner);
            setTimeout(() => {
              banner.classList.add("fade-out");
              setTimeout(() => banner.remove(), 600);
            }, 20000);
        }
      };
    };

  } catch (e) {
    console.error("❌ Service Worker registration failed:", e);
  }
}

/* -------------------------------------------------------------------------- */
/* Local / USB Storage Helper
/* -------------------------------------------------------------------------- */
export async function saveToLocalDevice(blob, filename) {
  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Video File", accept: { "video/webm": [".webm"] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error("Local save error:", err);
      toast("Failed to save to device: " + err.message, "error");
    }
    return false;
  }
}

/* ========================================================================== */
/* SPLIT-SCREEN VIDEO PLAYER
/* ========================================================================== */

export function openVideoPlayer(url, title = "Video Playback") {
  const container = document.getElementById("player-screen");
  const video = document.getElementById("main-player");
  const titleEl = document.getElementById("player-title");

  if (!container || !video) return;

  try { video.pause(); } catch {}
  video.removeAttribute("src");
  video.src = "";
  video.srcObject = null;
  video.autoplay = false;
  video.muted = false;
  video.playsInline = true;
  video.src = url;

  if (titleEl) titleEl.textContent = title;
  container.classList.remove("hidden");
}

export function closeVideoPlayer() {
  const container = document.getElementById("player-screen");
  const video = document.getElementById("main-player");
  if (video) {
    try { video.pause(); } catch {}
    video.removeAttribute("src");
    video.src = "";
    video.srcObject = null;
  }
  if (container) container.classList.add("hidden");
}

/* -------------------------------------------------------------------------- */
/* Fullscreen Button
/* -------------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  const previewFS = document.getElementById("preview-fullscreen-btn");
  if (previewFS) {
    previewFS.onclick = () => {
      const v = document.getElementById("preview-player");
      if (v?.requestFullscreen) v.requestFullscreen().catch(() => {});
    };
  }
});

/* ========================================================================== */
/* ✅ SCORING UI (Locally Rendered for Library/Playback)
/* ========================================================================== */

export function renderScoringUI({ rubric, existingScores }) {
  // 1. Target the correct container from your screenshot
  const containerId = "live-scoring-rows"; 
  const container = document.getElementById(containerId);

  // 2. Target the title element (currently says "Loading rubric...")
  const titleEl = document.getElementById("live-scoring-rubric-title");

  if (!container) {
    console.error(`❌ renderScoringUI: Container #${containerId} not found.`);
    return;
  }

  // 3. Update the Title & Clear "Loading..." spinner
  if (titleEl && rubric) {
      titleEl.textContent = rubric.title || "Scoring Rubric";
      titleEl.classList.remove("animate-pulse"); // Stop any pulsing effect if present
  }
  
  // 4. Clear previous rows
  container.innerHTML = "";
  
  // 5. Render Rows
  const rows = rubric?.rows || [];
  const savedScores = existingScores?.scores || {};
  const savedNotes = existingScores?.notes || {};

  rows.forEach((row) => {
    // Create Row Container
    const rowEl = document.createElement("div");
    // Matches the dark theme style seen in your screenshot
    rowEl.className = "mb-4 p-3 bg-gray-800 rounded shadow-sm border border-white/10";
    
    // Header (Row Title)
    const header = document.createElement("div");
    header.className = "flex justify-between items-center mb-2";
    header.innerHTML = `<span class="font-medium text-gray-200 text-sm">${row.title}</span>`;
    rowEl.appendChild(header);

    // Button Group
    const btnGroup = document.createElement("div");
    btnGroup.className = "flex space-x-2";
    
    const max = parseInt(row.maxPoints) || 4;
    
    for (let i = 1; i <= max; i++) {
      const btn = document.createElement("button");
      btn.textContent = i;
      // Base styling for dark mode
      btn.className = "w-8 h-8 rounded-full border text-xs font-bold transition-colors duration-200 ";
      
      // Check if previously selected
      const isSelected = savedScores[row.id] == i;
      
      if (isSelected) {
        btn.classList.add("bg-cyan-600", "text-white", "border-cyan-500");
      } else {
        btn.classList.add("bg-gray-700", "text-gray-300", "border-gray-600", "hover:bg-gray-600");
      }

      // Click Handler
      btn.onclick = () => {
        // Visual toggle
        Array.from(btnGroup.children).forEach(b => {
          b.className = "w-8 h-8 rounded-full border text-xs font-bold transition-colors duration-200 bg-gray-700 text-gray-300 border-gray-600 hover:bg-gray-600";
        });
        btn.className = "w-8 h-8 rounded-full border text-xs font-bold transition-colors duration-200 bg-cyan-600 text-white border-cyan-500";

        // Logic: Update Record state (so Save works)
        if (Record.handleLibraryScoreUpdate) {
            Record.handleLibraryScoreUpdate(row.id, i);
        }
        updateTotalScore(container);
      };

      btnGroup.appendChild(btn);
    }
    rowEl.appendChild(btnGroup);
    container.appendChild(rowEl);
  });
  
  // 6. Calculate initial total
  updateTotalScore(container);
}

function updateTotalScore(container) {
    // Look for active buttons (cyan-600 is our active class now)
    const activeBtns = container.querySelectorAll(".bg-cyan-600");
    let total = 0;
    activeBtns.forEach(btn => total += parseInt(btn.textContent) || 0);
    
    // Update the Total Display in the header
    const totalEl = document.getElementById("total-score-display"); // Ensure this ID exists in your HTML header
    if (totalEl) totalEl.textContent = `${total}`;
}