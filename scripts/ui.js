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
/* Global Event Handlers                                                      */
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

  if (tabId !== 'tab-record') {
    const progressEl = $("#upload-progress");
    if (progressEl) progressEl.style.width = '0%';
  }

  if (tabId === 'tab-manage') {
    refreshClassesList();
  }

  if (tabId === 'tab-rubrics') {
    $$(".rubric-sub-tab-content").forEach(el =>
      el.classList.toggle("hidden", el.id !== 'rubric-tab-my')
    );
    $$(".sub-tab").forEach(el =>
      el.setAttribute("aria-selected", el.dataset.subtab === 'rubric-tab-my')
    );
    refreshMyRubrics();
  }

  if (tabId === 'tab-record') {
    startPreviewSafely();   // ✅ FIXED
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
/* SPLIT-SCREEN VIDEO PLAYER (Primary Player Used for Playback + Scoring)     */
/* ========================================================================== */

/**
 * Opens the split-screen video player.
 * Loads a URL into <video id="main-player"> and reveals #player-screen.
 */
export function openVideoPlayer(url, title = "Video Playback") {
  const container = document.getElementById("player-screen");
  const video = document.getElementById("main-player");
  const titleEl = document.getElementById("player-title");

  if (!container || !video) return;

  // Stop previous playback
  try {
    video.pause();
  } catch {}
  video.removeAttribute("src");
  video.src = "";
  video.srcObject = null;

  // Make sure playback is user-initiated only
  video.autoplay = false;
  video.muted = false;       // library playback should have sound
  video.playsInline = true;  // safe on mobile

  // Load new URL
  video.src = url;

  // Update title
  if (titleEl) titleEl.textContent = title;

  // Show split-screen layout
  container.classList.remove("hidden");
}

/**
 * Closes the split-screen video player and stops playback.
 */
export function closeVideoPlayer() {
  const container = document.getElementById("player-screen");
  const video = document.getElementById("main-player");

  if (video) {
    try {
      video.pause();
    } catch {}
    video.removeAttribute("src");
    video.src = "";
    video.srcObject = null;
  }

  if (container) {
    container.classList.add("hidden");
  }
}

/* -------------------------------------------------------------------------- */
/* Fullscreen Button for Webcam Preview (runs after DOM loaded)               */
/* -------------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  const previewFS = document.getElementById("preview-fullscreen-btn");
  if (previewFS) {
    previewFS.onclick = () => {
      const v = document.getElementById("preview-player");
      if (v?.requestFullscreen) {
        v.requestFullscreen().catch(() => {});
      }
    };
    console.log("Fullscreen button wired.");
  }
});

/* ========================================================================== */
/* SCORING DIALOG HELPERS (Vertical layout, Option A buttons)                */
/* ========================================================================== */

/**
 * Render scoring rows for a given video + rubric.
 * rows = [{ label, maxPoints }]
 */
export function renderScoringDialog({ video, rubric, rows, existingScores }) {
  const titleEl = $("#scoring-video-title");
  const partEl = $("#scoring-video-participant");
  const rubricEl = $("#scoring-rubric-title");
  const rowsContainer = $("#scoring-rows");

  if (!rowsContainer) return;

  if (titleEl) titleEl.textContent = video.classEventTitle || "Untitled";
  if (partEl) partEl.textContent = video.participant || "Unknown participant";
  if (rubricEl) rubricEl.textContent = rubric.title || "Rubric";

  rowsContainer.innerHTML = "";

  rows.forEach((row, idx) => {
  const max = row.maxPoints || 6;

  const low = Math.round(max / 3);
  const med = Math.round((2 * max) / 3);
  const high = max;

  const wrap = document.createElement("div");
  wrap.className =
    "score-row border border-white/10 rounded-xl p-3 bg-black/30";
  wrap.dataset.index = String(idx);
  wrap.dataset.label = row.label || row.title || `Row ${idx + 1}`;

  wrap.innerHTML = `
    <div class="flex justify-between items-baseline mb-2">
      <div class="text-sm font-semibold text-white">
        ${idx + 1}. ${wrap.dataset.label}
      </div>
      <div class="text-[11px] text-gray-400">Max: ${max} pts</div>
    </div>

    <div class="flex gap-2 mb-2 text-xs">
      <button type="button"
        class="score-btn px-2 py-1 rounded-lg bg-white/10 text-gray-200 border border-white/10"
        data-score="${low}">
        ${low} pts
      </button>

      <button type="button"
        class="score-btn px-2 py-1 rounded-lg bg-white/10 text-gray-200 border border-white/10"
        data-score="${med}">
        ${med} pts
      </button>

      <button type="button"
        class="score-btn px-2 py-1 rounded-lg bg-white/10 text-gray-200 border border-white/10"
        data-score="${high}">
        ${high} pts
      </button>
    </div>

    <textarea
      class="score-notes w-full rounded-lg bg-black/40 border border-white/10
             p-2 text-xs"
      placeholder="Notes for this row (optional)…"></textarea>
  `;

  rowsContainer.appendChild(wrap);

  // ---------------------------------------------------------
  // ⭐ PREFILL SCORES IF THEY EXIST (from database)
  // ---------------------------------------------------------
  if (existingScores && Array.isArray(existingScores.rowScores)) {
    const saved = existingScores.rowScores.find((r) => r.rowIndex === idx);
    if (saved) {
      const btn = wrap.querySelector(`.score-btn[data-score="${saved.score}"]`);
      const notesEl = wrap.querySelector(".score-notes");

      if (btn) {
        btn.dataset.selected = "true";
        btn.classList.remove("bg-white/10", "text-gray-200");
        btn.classList.add("bg-primary-600", "text-white");
      }

      if (notesEl) notesEl.value = saved.notes || "";
    }
  }
});

  updateScoreTotal();
}

export function openScoringDialog() {
  const dlg = $("#scoring-dialog");
  if (dlg && typeof dlg.showModal === "function") {
    dlg.showModal();
    updateScoreTotal();
  }
}

export function closeScoringDialog() {
  const dlg = $("#scoring-dialog");
  if (dlg && dlg.open) dlg.close();
}

/** Collect scores + notes from the dialog into an array */
export function collectScoringData() {
  const rows = $$("#scoring-rows .score-row");
  return rows.map((rowEl) => {
    const idx = parseInt(rowEl.dataset.index || "0", 10);
    const label = rowEl.dataset.label || `Row ${idx + 1}`;
    const selected = rowEl.querySelector(".score-btn[data-selected='true']");
    const score = selected ? parseInt(selected.dataset.score || "0", 10) : 0;
    const notes = rowEl.querySelector(".score-notes")?.value.trim() || "";
    return { rowIndex: idx, label, score, notes };
  });
}

/** Update the total score label from selected buttons */
export function updateScoreTotal() {
  const totalEl = $("#scoring-total");
  if (!totalEl) return;

  let total = 0;
  $$("#scoring-rows .score-row").forEach((rowEl) => {
    const selected = rowEl.querySelector(".score-btn[data-selected='true']");
    if (selected) {
      total += parseInt(selected.dataset.score || "0", 10) || 0;
    }
  });

  totalEl.textContent = String(total);
}
/* ========================================================================== */
/* EVENT HANDLERS FOR SCORING BUTTONS                                         */
/* ========================================================================== */

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".score-btn");
  if (!btn) return;

  const row = btn.closest(".score-row");
  if (!row) return;

  // Clear previous selection
  row.querySelectorAll(".score-btn").forEach((b) => {
    b.removeAttribute("data-selected");
    b.classList.remove("bg-primary-600", "text-white");
    b.classList.add("bg-white/10", "text-gray-200");
  });

  // Mark selected
  btn.dataset.selected = "true";
  btn.classList.remove("bg-white/10", "text-gray-200");
  btn.classList.add("bg-primary-600", "text-white");

  // Update total
  updateScoreTotal();
});
