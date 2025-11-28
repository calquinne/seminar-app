/* ========================================================================== */
/* MODULE: ui.js 
/* Exports shared state, constants, and UI helper functions.
/* ========================================================================== */

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
export function getStorageChoice() { return localStorage.getItem(LS.STORE) || "firebase"; }
export function setStorageChoice(choice) {
  localStorage.setItem(LS.STORE, choice);
  $("#storage-provider").value = choice;
  $("#account-pill").textContent = `Role: ${userDoc?.role || '...'} • Storage: ${choice}`;
}

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
export function handleTabClick(e, refreshClassesList, refreshMyRubrics, startPreview, loadLibrary) {
  const btn = e.target.closest(".app-tab");
  if (!btn) return;

  const tabId = btn.dataset.tab;
  
  if (!hasAccess() && (tabId === 'tab-record' || tabId === 'tab-library' || tabId === 'tab-analytics')) {
    toast("This feature requires an active subscription.", "error");
    return;
  }

  $$(".app-tab-content").forEach(el => {
    if(el) el.classList.add("hidden");
  });
  const metaScreen = $("#metadata-screen");
  if (metaScreen && metaScreen.open) metaScreen.close();

  $(`#${tabId}`)?.classList.remove("hidden");
  
  $$(".app-tab").forEach(el => el.setAttribute("aria-selected", el.dataset.tab === tabId));
  
  console.log(`Switched to tab: ${tabId}`);
  
  if (tabId !== 'tab-record') {
    const progressEl = $("#upload-progress");
    if (progressEl) progressEl.style.width = '0%';
  }

  if (tabId === 'tab-manage') {
    refreshClassesList();
  }
  if (tabId === 'tab-rubrics') {
    $$(".rubric-sub-tab-content").forEach(el => el.classList.toggle("hidden", el.id !== 'rubric-tab-my'));
    $$(".sub-tab").forEach(el => el.setAttribute("aria-selected", el.dataset.subtab === 'rubric-tab-my'));
    refreshMyRubrics();
  }
  if (tabId === 'tab-record') {
    startPreview(); 
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
  
  console.log(`Switched to rubric sub-tab: ${tabId}`);
}

export function handleAddRubricRow() {
  const container = $("#new-rubric-rows-container");
  if (!container) return;
  
  const rowCount = container.children.length + 1;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "new-rubric-row w-full rounded-lg bg-black/30 border border-white/10 p-2 text-sm";
  input.placeholder = `Row ${rowCount}: e.g., Pacing`;
  container.appendChild(input);
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

    if (!yesBtn.dataset.listener) {
      yesBtn.dataset.listener = "true";
      noBtn.dataset.listener = "true";
      
      yesBtn.addEventListener('click', () => {
        if (confirmPromiseResolver) {
          modal.close();
          confirmPromiseResolver(true);
          confirmPromiseResolver = null;
        }
      });
      
      noBtn.addEventListener('click', () => {
        if (confirmPromiseResolver) {
          modal.close();
          confirmPromiseResolver(false);
          confirmPromiseResolver = null;
        }
      });
      
      modal.addEventListener('close', () => {
        if (confirmPromiseResolver) {
          confirmPromiseResolver(false);
          confirmPromiseResolver = null;
        }
      });
    }
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

export function redirectToStripeCheckout(){ toast("Stripe Checkout (placeholder)","info"); }
export function uploadToDrivePlaceholder(file, meta){
  console.log("Drive upload placeholder", file?.size, meta);
  toast("Google Drive upload not yet implemented.","info");
}

/* -------------------------------------------------------------------------- */
/* PWA Service Worker Registration (Final Polished Version)                   */
/* -------------------------------------------------------------------------- */

export async function registerSW() {
  if (!("serviceWorker" in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register("./sca-sw.js", { scope: "./" });
    console.log("✅ Service Worker registered successfully.");

    /* ------------------------------------------------------------ */
    /* Inject CSS animations once                                   */
    /* ------------------------------------------------------------ */
    if (!document.getElementById("update-banner-style")) {
      const style = document.createElement("style");
      style.id = "update-banner-style";

      style.textContent = `
        @keyframes slideDownFade {
          0% { opacity: 0; transform: translate(-50%, -30px); }
          100% { opacity: 1; transform: translate(-50%, 0); }
        }
        @keyframes slideUpFadeOut {
          0% { opacity: 1; transform: translate(-50%, 0); }
          100% { opacity: 0; transform: translate(-50%, -30px); }
        }
        @keyframes pingGlow {
          0% { box-shadow: 0 0 0 0 rgba(14,116,144,0.6); }
          70% { box-shadow: 0 0 0 12px rgba(14,116,144,0); }
          100% { box-shadow: 0 0 0 0 rgba(14,116,144,0); }
        }
        #update-banner {
          animation: slideDownFade 0.5s ease-out forwards,
                     pingGlow 1.4s ease-out 0.3s;
          text-shadow: 0 0 4px rgba(0,0,0,0.5);
        }
        #update-banner.fade-out {
          animation: slideUpFadeOut 0.5s ease-in forwards;
        }
      `;

      document.head.appendChild(style);
    }

    /* ------------------------------------------------------------ */
    /* Listen for new service worker                                */
    /* ------------------------------------------------------------ */
    reg.onupdatefound = () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.onstatechange = () => {
        try {
          if (
            newWorker.state === "installed" &&
            navigator.serviceWorker &&
            navigator.serviceWorker.controller
          ) {
            // Construct banner
            const banner = document.createElement("div");
            banner.id = "update-banner";

            banner.className = `
              fixed top-4 left-1/2 -translate-x-1/2 z-50
              bg-[#0e7490]/90 backdrop-blur-md text-white text-sm
              px-5 py-2.5 rounded-2xl shadow-lg border border-white/10
              cursor-pointer transition hover:bg-[#0e7490]/100
            `;

            banner.textContent = "🔄 A new update is available — click to refresh";

            banner.onclick = () => {
              newWorker.postMessage({ type: "SKIP_WAITING" });
              banner.textContent = "⏳ Updating…";
              banner.classList.add("opacity-80");
              setTimeout(() => window.location.reload(), 500);
            };

            document.body.appendChild(banner);

            // Auto fade-out after 20s
            setTimeout(() => {
              banner.classList.add("fade-out");
              setTimeout(() => banner.remove(), 600);
            }, 20000);
          }
        } catch (err) {
          console.warn("[SW] Update check skipped (controller not ready)", err);
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
    // 1. Try modern File Picker API (Win/Mac/Linux/ChromeOS)
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "Video File",
            accept: { "video/webm": [".webm"] }
          }
        ]
      });

      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    }

    // 2. Fallback for browsers without File Picker API
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
/* UNIFIED FLOATING MINI-PLAYER (Dockable + Resizable + Stream/File Support)   */
/* ========================================================================== */

// Internal state
let fpIsDragging = false;
let fpDragOffsetX = 0;
let fpDragOffsetY = 0;

let fpIsResizing = false;
let fpResizeStartX = 0;
let fpResizeStartY = 0;
let fpStartWidth = 0;
let fpStartHeight = 0;

/* --------------------------------------------------------------------------
   SHOW FLOATING PLAYER (Stream OR URL)
   -------------------------------------------------------------------------- */
export function openFloatingPlayer(source, title = "Preview") {
  const box = document.getElementById("mini-player");
  const video = document.getElementById("mini-player-video");
  const titleEl = document.getElementById("mini-player-title");

  if (!box || !video) return;

  // Clear previous source
  video.pause();
  video.src = "";
  video.srcObject = null;

  // Handle live camera feed (MediaStream)
  if (source instanceof MediaStream) {
    video.srcObject = source;
  } else {
    // Handle file/URL playback
    video.src = source;
  }

  if (titleEl) titleEl.textContent = title;

  box.classList.remove("hidden");

  video.play().catch(() => {});
}

/* --------------------------------------------------------------------------
   HIDE FLOATING PLAYER
   -------------------------------------------------------------------------- */
export function closeFloatingPlayer() {
  const box = document.getElementById("mini-player");
  const video = document.getElementById("mini-player-video");
  if (!box || !video) return;

  video.pause();
  video.src = "";
  video.srcObject = null;

  box.classList.add("hidden");
}

/* --------------------------------------------------------------------------
   DRAGGING LOGIC
   -------------------------------------------------------------------------- */
function setupMiniPlayerDrag() {
  const box = document.getElementById("mini-player");
  const header = document.getElementById("mini-player-header");

  header.addEventListener("mousedown", (e) => {
    fpIsDragging = true;
    fpDragOffsetX = e.clientX - box.offsetLeft;
    fpDragOffsetY = e.clientY - box.offsetTop;
  });

  document.addEventListener("mousemove", (e) => {
    if (!fpIsDragging) return;
    box.style.left = `${e.clientX - fpDragOffsetX}px`;
    box.style.top = `${e.clientY - fpDragOffsetY}px`;
    box.style.right = "auto";
    box.style.bottom = "auto";
  });

  document.addEventListener("mouseup", () => {
    fpIsDragging = false;
  });
}

/* --------------------------------------------------------------------------
   RESIZING LOGIC
   -------------------------------------------------------------------------- */
function setupMiniPlayerResize() {
  const box = document.getElementById("mini-player");
  const handle = document.getElementById("mini-player-resize");

  handle.addEventListener("mousedown", (e) => {
    fpIsResizing = true;
    fpResizeStartX = e.clientX;
    fpResizeStartY = e.clientY;
    fpStartWidth = box.offsetWidth;
    fpStartHeight = box.offsetHeight;
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!fpIsResizing) return;

    const dx = e.clientX - fpResizeStartX;
    const dy = e.clientY - fpResizeStartY;

    box.style.width = `${fpStartWidth + dx}px`;
    box.style.height = `${fpStartHeight + dy}px`;
  });

  document.addEventListener("mouseup", () => {
    fpIsResizing = false;
  });
}

/* --------------------------------------------------------------------------
   CLOSE BUTTON
   -------------------------------------------------------------------------- */
function setupMiniPlayerClose() {
  const closeBtn = document.getElementById("mini-player-close");
  closeBtn.addEventListener("click", closeFloatingPlayer);
}

/* --------------------------------------------------------------------------
   INITIALIZE ONCE
   -------------------------------------------------------------------------- */
export function initFloatingPlayer() {
  setupMiniPlayerDrag();
  setupMiniPlayerResize();
  setupMiniPlayerClose();
}
