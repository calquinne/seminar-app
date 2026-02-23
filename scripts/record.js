/* ========================================================================== */
/* MODULE: record.js (Final: Fixed Imports & Hardened State)
/* ========================================================================== */

import * as UI from "./ui.js";
import { uploadFile, saveRecording, saveLocalData, loadLibrary, updateVideo, addPlaybackMarker } from "./firestore.js";
import {
  doc,
  addDoc,
  updateDoc,
  serverTimestamp,
  setDoc,       // ✅ ADDED THIS
  collection    // ✅ ADDED THIS
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import * as Rubrics from "./rubrics.js"; 

// ✅ LOCAL STATE
let currentTags = [];
let liveScores = [];                  // Timeline scoring
const latestRowScores = new Map();    // rowId → score
let currentLibraryVideoId = null;     // Editing context
let previewLock = false;              // Camera toggle lock

// 🔒 TEMP CLASS TRACKER (prevents ghost classes on cancel)
let pendingNewClassId = null;


/* ========================================================================== */
/* LIBRARY CONTEXT & SAVE HANDLER
/* ========================================================================== */

export function setCurrentLibraryVideoId(id) {
  currentLibraryVideoId = id;
}

// Global Listener for "Save Score" in Library
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("#playback-save-btn, #scoring-save-btn");
  if (btn) {
      if (!UI.db || !UI.currentUser) {
          UI.toast("Database not ready.", "error");
          return;
      }
      if (!currentLibraryVideoId) {
          UI.toast("No active video to save.", "error");
          return;
      }

      const finalScores = {};
      let totalScore = 0;
      latestRowScores.forEach((score, rowId) => {
          finalScores[rowId] = score;
          totalScore += score;
      });

      const rowNotes = {};
      document.querySelectorAll('[data-note-row-id]').forEach(el => {
          if (el.value.trim()) rowNotes[el.dataset.noteRowId] = el.value.trim();
      });

      const rubric = Rubrics.getActiveRubric();
      const originalText = btn.innerHTML;
      
      // ✅ LOCK BUTTON
      btn.textContent = "Saving...";
      btn.disabled = true;

      try {

          // ✅ USE SMART SYNC (Fixes Group Grading)
          await updateVideo(currentLibraryVideoId, {
              finalScores, 
              rowNotes, 
              totalScore, 
              hasScore: true, 
              lastScore: totalScore,
              rubricId: rubric?.id || null, 
              rubricTitle: rubric?.title || null,
              lastScoredAt: serverTimestamp()
       });
          
          UI.toast("Scores saved!", "success");

          // ✅ NEW: Close Player & Refresh List (The Fix)
          if (typeof UI.closeVideoPlayer === "function") UI.closeVideoPlayer();
          if (typeof loadLibrary === "function") await loadLibrary();

      } catch (err) {
          console.error("Score save failed:", err);
          UI.toast("Save failed.", "error");
      } finally {
          btn.innerHTML = originalText;
          btn.disabled = false;
      }
  }
});

/* ========================================================================== */
/* SCORING RENDERER (Restored: Tooltips & Allowed Scores)
/* ========================================================================== */

/* ===== FIX A: GLOBAL TOOLTIP (ANTI-CLIP) ===== */

let GLOBAL_TOOLTIP;

function ensureGlobalTooltip() {
  if (GLOBAL_TOOLTIP) return;

  GLOBAL_TOOLTIP = document.createElement("div");
  GLOBAL_TOOLTIP.id = "global-rubric-tooltip";
  GLOBAL_TOOLTIP.style.position = "fixed";
  GLOBAL_TOOLTIP.style.zIndex = "10000";
  GLOBAL_TOOLTIP.style.pointerEvents = "none";
  GLOBAL_TOOLTIP.style.visibility = "hidden";
  GLOBAL_TOOLTIP.style.opacity = "0";
  GLOBAL_TOOLTIP.style.transition = "opacity 0.15s ease";

  GLOBAL_TOOLTIP.style.background = "#0f172a";
  GLOBAL_TOOLTIP.style.color = "#e5e7eb";
  GLOBAL_TOOLTIP.style.padding = "8px 12px";
  GLOBAL_TOOLTIP.style.borderRadius = "6px";
  GLOBAL_TOOLTIP.style.fontSize = "11px";
  GLOBAL_TOOLTIP.style.lineHeight = "1.4";
  GLOBAL_TOOLTIP.style.maxWidth = "280px";
  GLOBAL_TOOLTIP.style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)";
  GLOBAL_TOOLTIP.style.border = "1px solid rgba(255,255,255,0.1)";
  GLOBAL_TOOLTIP.style.textAlign = "center";
  GLOBAL_TOOLTIP.style.whiteSpace = "normal";

  document.body.appendChild(GLOBAL_TOOLTIP);
}

/* ===== END FIX A GLOBAL TOOLTIP ===== */


// Ensure styles are injected for Tooltips
const styleId = "rubric-tooltip-styles";
if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        .score-btn-wrapper { position: relative; display: inline-block; overflow: visible; }
        .rubric-tooltip {
            visibility: hidden; position: absolute; z-index: 9999; 
            /* Default: Show ABOVE the button */
            bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
            width: max-content; max-width: 200px;
            background-color: #0f172a; color: #e5e7eb; font-size: 11px; line-height: 1.4;
            border-radius: 6px; padding: 6px 10px; opacity: 0;
            transition: opacity 0.15s ease-in-out; pointer-events: none;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(255,255,255,0.1);
            white-space: normal; text-align: center;
        }
        .score-btn-wrapper:hover .rubric-tooltip { visibility: visible; opacity: 1; }
        
        /* ✅ FIX: Force tooltip BELOW button for the very first row so header doesn't cut it off */
        .live-score-row:first-child .rubric-tooltip { 
            bottom: auto; top: calc(100% + 8px); 
        }
        
        /* Small arrow for tooltip */
        .rubric-tooltip::after {
            content: ""; position: absolute; top: 100%; left: 50%; margin-left: -4px;
            border-width: 4px; border-style: solid;
            border-color: #0f172a transparent transparent transparent;
        }
        /* Arrow adjustment for first-row (flipped) */
        .live-score-row:first-child .rubric-tooltip::after {
            top: auto; bottom: 100%; border-color: transparent transparent #0f172a transparent;
        }
    `;
    document.head.appendChild(style);
}

export function renderLiveScoringFromRubric(input = {}, context = "live", options = {}) {
  const prefix = context;
  const rowsContainer = options.container || UI.$(`#${prefix}-scoring-rows`);
  const titleEl = !options.container ? (UI.$(`#${prefix}-rubric-title`) || UI.$(`#${prefix}-scoring-rubric-title`)) : null;
  const totalEl = !options.container ? UI.$(`#${prefix}-score-total`) : null;

  if (!rowsContainer) return;

  if (!options.readOnly && context !== "analytics") {
      latestRowScores.clear();
  }

  // Scroll reset
  setTimeout(() => { if (rowsContainer) rowsContainer.scrollTop = 0; }, 150);

  rowsContainer.innerHTML = "";
 // ---------------------------------------------------------
// ✅ NEW: RENDER PLAYBACK MARKERS (Review Mode + Edit)
// ---------------------------------------------------------
// 1. Safe Array Copy
const tags = Array.isArray(input.tags) ? [...input.tags] : [];

if (context === "playback") {

    const markerContainer = document.createElement("div");
    markerContainer.className = "mb-6 p-3 bg-indigo-900/20 border border-indigo-500/30 rounded-lg";
    
    // State for Edit Mode
    let isEditing = false;

    // --- HELPER: Save Changes to Firestore ---
    const saveMarkerChanges = async () => {
        try {
            // We overwrite the 'tags' array entirely to ensure edits/deletes sync
            await updateVideo(currentLibraryVideoId, { tags: tags });
            UI.toast("Markers updated!", "success");
        } catch (e) {
            console.error(e);
            UI.toast("Failed to update markers.", "error");
        }
    };

    // --- RENDER FUNCTION (Re-runs on toggle) ---
    const renderUI = () => {
        // A. Header Row (Title + Edit Toggle + Add Button)
        markerContainer.innerHTML = `
          <div class="flex justify-between items-center mb-3">
              <div class="text-xs font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                  Timeline Markers
              </div>
              <div class="flex gap-2">
                  <button id="toggle-edit-btn" class="text-xs px-2 py-1 rounded transition-colors border ${isEditing ? 'bg-red-900/50 text-red-200 border-red-500/50' : 'text-indigo-300 hover:bg-white/5 border-transparent'}">
                     ${isEditing ? 'Done' : '✎ Edit'}
                  </button>
                  <button id="add-marker-btn" class="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded shadow flex items-center gap-1 transition-all ${isEditing ? 'opacity-50 cursor-not-allowed' : ''}" ${isEditing ? 'disabled' : ''}>
                      <span>➕ Add Marker</span>
                  </button>
              </div>
          </div>
          <div class="flex flex-wrap gap-2" id="playback-marker-list"></div>
        `;

        const list = markerContainer.querySelector("#playback-marker-list");
        const addBtn = markerContainer.querySelector("#add-marker-btn");
        const editBtn = markerContainer.querySelector("#toggle-edit-btn");

        // B. Handle Toggle Edit
        editBtn.onclick = () => {
            isEditing = !isEditing;
            renderUI(); // Re-render to show/hide delete buttons
        };

        // C. Render List
        list.innerHTML = "";
        if (tags.length === 0) {
            list.innerHTML = `<span class="text-xs text-indigo-400/50 italic">No markers yet. Watch the video and click 'Add Marker'.</span>`;
        } else {
            tags.sort((a,b) => a.time - b.time).forEach((tag, index) => {
                const btn = document.createElement("button");
                const mins = Math.floor(tag.time / 60);
                const secs = Math.floor(tag.time % 60).toString().padStart(2, '0');

                // Style changes based on mode
                if (isEditing) {
                    btn.className = "group flex items-center gap-2 px-3 py-1.5 bg-red-900/20 hover:bg-red-900/40 text-red-200 text-xs rounded border border-red-500/30 transition-all";
                    btn.innerHTML = `
                        <span class="font-mono opacity-75">${mins}:${secs}</span> 
                        <span class="border-b border-red-400/30 border-dashed">${tag.note || "Marker"}</span>
                        <span class="ml-2 w-4 h-4 flex items-center justify-center bg-red-500 hover:bg-red-400 text-white rounded-full font-bold leading-none" title="Delete">×</span>
                    `;
                    
                    // EDIT / DELETE LOGIC
                    btn.onclick = async (e) => {
                        // If they clicked the 'X', delete it
                        if (e.target.innerText === "×") {
                            if (confirm("Delete this marker?")) {
                                tags.splice(index, 1); // Remove from array
                                await saveMarkerChanges();
                                renderUI();
                            }
                        } else {
                            // Otherwise, edit text
                            const newNote = prompt("Edit marker note:", tag.note);
                            if (newNote !== null && newNote.trim() !== "") {
                                tag.note = newNote.trim();
                                await saveMarkerChanges();
                                renderUI();
                            }
                        }
                    };
                } else {
                    // NORMAL MODE (Jump)
                    btn.className = "flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded transition-colors border border-indigo-400/50";
                    btn.innerHTML = `<span class="font-mono opacity-75 border-r border-white/20 pr-2 mr-[-4px]">${mins}:${secs}</span> ${tag.note || "Marker"}`;
                    
                    btn.onclick = () => {
                       const video = document.getElementById("main-player");
                       if (video) {
                           video.currentTime = tag.time;
                           video.play();
                           UI.toast(`Jumped to ${mins}:${secs}`, "info");
                       }
                    };
                }
                list.appendChild(btn);
            });
        }

        // D. Handle "Add Marker" (Only active when NOT editing)
        if (!isEditing) {
            addBtn.onclick = async () => {
                const video = document.getElementById("main-player");
                if (!video) return;
                video.pause();
                const time = video.currentTime;
                const note = prompt("Label this moment (e.g., 'Great Question'):");

                if (note) {
                    tags.push({ time, note, type: "review" });
                    renderUI(); // Show immediately
                    await saveMarkerChanges();
                }
            };
        }
        // NEW (Add a log)
        console.log("🔍 FULL INPUT OBJECT:", input);
        renderTimelinePins(tags, input.duration);
    };

    // Initial Render
    renderUI();

    rowsContainer.appendChild(markerContainer);
}
  const existingScores = input.finalScores || input.scores || input.existingScores?.scores || input || {};
  const existingNotes = input.rowNotes || input.notes || input.existingScores?.notes || {};
  const rubric = input.rubricSnapshot || Rubrics.getActiveRubric();
  let initialTotal = 0;

  if (!rubric || !rubric.rows || rubric.rows.length === 0) {
      rowsContainer.innerHTML = `<div class="p-4 text-center text-gray-500 text-sm">No rubric active.</div>`;
      if(titleEl) titleEl.textContent = "No Rubric";
      return;
  }

  if(titleEl) titleEl.textContent = rubric.title;

  rubric.rows.forEach((row, index) => {
      let savedScore = existingScores[row.id];
      let savedNote = existingNotes[row.id] || "";

      if (savedScore != null) {
          if (context !== "analytics") latestRowScores.set(row.id, Number(savedScore));
          initialTotal += Number(savedScore);
      }

      const rowEl = document.createElement("div");
      rowEl.className = "mb-4 pb-4 border-b border-white/10 live-score-row"; // Class used for CSS targeting
      rowEl.innerHTML = `<div class="flex justify-between mb-2"><span class="text-sm font-medium text-white">${index+1}. ${row.label}</span><span class="text-xs text-gray-500">Max: ${row.maxPoints}</span></div>`;

      if (options.readOnly) {
          // Read Only View (Progress Bar)
          const pct = row.maxPoints > 0 ? (Number(savedScore||0) / row.maxPoints * 100) : 0;
          let color = pct < 50 ? "bg-red-600" : pct < 80 ? "bg-yellow-500" : "bg-green-600";
          rowEl.innerHTML += `
            <div class="flex items-center gap-2">
                <div class="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden"><div class="h-full ${color}" style="width: ${pct}%"></div></div>
                <div class="font-bold text-white">${savedScore ?? "-"}</div>
            </div>
            ${savedNote ? `<div class="mt-1 text-xs text-gray-400 italic">"${savedNote}"</div>` : ""}
          `;
      } else {
          // ✅ INTERACTIVE VIEW (RESTORED LOGIC)
          
          // 1. Determine Allowed Scores (Custom List vs Default Range)
          let scoresToRender = [];
          if (Array.isArray(row.allowedScores) && row.allowedScores.length > 0) {
              // Map object structure {value: 2, label: "Poor"} or raw numbers [2, 4, 6]
              scoresToRender = row.allowedScores.map(s => (typeof s === 'object' ? s : { value: s, label: "" }));
          } else {
              // Default 0 to Max
              const max = row.maxPoints || 5;
              for(let i=0; i<=max; i++) scoresToRender.push({ value: i, label: "" });
          }

          // 2. Build Buttons with Tooltips
          let btns = `<div class="flex flex-wrap gap-1 mb-2">`;
          
          scoresToRender.forEach(opt => {
              const val = Number(opt.value);
              
              // Get Tooltip Text: Check specific tooltip map OR the label from allowedScores
              let tooltipText = "";
              if (row.scoreDescriptions && row.scoreDescriptions[val]) {
                  tooltipText = row.scoreDescriptions[val];
              } else if (opt.label) {
                  tooltipText = opt.label;
              }

              const active = (val === Number(savedScore));
              const cls = active ? "bg-[#0033A0] text-white border-primary-400 scale-110 shadow-md" : "bg-white/10 text-gray-300 hover:bg-white/20";
              
              // Render Wrapper
              btns += `
                <div class="score-btn-wrapper" data-tooltip="${tooltipText || ""}">

                    <button type="button" class="live-score-btn w-8 h-8 text-xs rounded border border-transparent transition-all ${cls}" 
                        data-score="${val}" data-row-id="${row.id}">
                        ${val}
                    </button>
                </div>`;
          });

          btns += `</div>`;
          btns += `<textarea class="w-full bg-black/20 border border-white/10 rounded p-2 text-xs text-gray-300 focus:border-primary-500 resize-none h-16" placeholder="Add note..." data-note-row-id="${row.id}">${savedNote}</textarea>`;
          rowEl.innerHTML += btns;
      }
      rowsContainer.appendChild(rowEl);
     rowsContainer.appendChild(rowEl);

// ================================
// FIX A: GLOBAL TOOLTIP BINDING
// ================================
rowEl.querySelectorAll(".score-btn-wrapper").forEach(wrapper => {
    const tip = wrapper.dataset.tooltip;
    if (!tip) return;

    ensureGlobalTooltip();

    wrapper.addEventListener("mouseenter", (e) => {
        GLOBAL_TOOLTIP.textContent = tip;
        GLOBAL_TOOLTIP.style.left = `${e.clientX}px`;
        GLOBAL_TOOLTIP.style.top = `${e.clientY + 14}px`;
        GLOBAL_TOOLTIP.style.visibility = "visible";
        GLOBAL_TOOLTIP.style.opacity = "1";
    });

    wrapper.addEventListener("mousemove", (e) => {
        GLOBAL_TOOLTIP.style.left = `${e.clientX}px`;
        GLOBAL_TOOLTIP.style.top = `${e.clientY + 14}px`;
    });

    wrapper.addEventListener("mouseleave", () => {
        GLOBAL_TOOLTIP.style.opacity = "0";
        GLOBAL_TOOLTIP.style.visibility = "hidden";
    });
});
 
  });

  if (!options.readOnly) {
      rowsContainer.querySelectorAll(".live-score-btn").forEach(btn => {
          btn.onclick = () => {
              const rowId = btn.dataset.rowId;
              const val = Number(btn.dataset.score);
              
              // Visual update
              const parent = btn.closest(".live-score-row");
              parent.querySelectorAll(".live-score-btn").forEach(b => b.className = "live-score-btn w-8 h-8 text-xs rounded border border-transparent bg-white/10 text-gray-300 hover:bg-white/20 transition-all");
              btn.className = "live-score-btn w-8 h-8 text-xs rounded border border-primary-400 bg-[#0033A0] text-white scale-110 transition-all shadow-md";

              // Logic update
              latestRowScores.set(rowId, val);
              let sum = 0; latestRowScores.forEach(v => sum += v);
              if(totalEl) {
                  totalEl.textContent = sum;
                  totalEl.style.transform = "scale(1.2)";
                  setTimeout(() => totalEl.style.transform = "scale(1)", 150);
              }
          };
      });
  }
  if (totalEl) totalEl.textContent = initialTotal;
}
/* ========================================================================== */
/* RECORDING CONTROLS
/* ========================================================================== */

function clearTagList() {
  const list = UI.$("#tag-list");
  if(list) list.innerHTML = "";
  currentTags = [];
}

export function handleTagButtonClick() {
  if (!UI.mediaRecorder || UI.mediaRecorder.state !== "recording") {
      UI.toast("Tags mark moments during a recording", "warn");
      return;
  }
  const time = UI.secondsElapsed;
  UI.toast(`Tag at ${time}s`, "info");
  currentTags.push({ time, note: `Tag at ${time}s` });
}

export async function startPreviewSafely() {
  const recordTab = UI.$("[data-tab='tab-record']");
  if (!recordTab || recordTab.classList.contains("hidden")) return;
  if (previewLock) return;
  previewLock = true; setTimeout(() => previewLock = false, 300);

  if (!UI.hasAccess()) { UI.toast("No access.", "error"); return; }

  const vid = UI.$("#preview-player");
  const screen = UI.$("#preview-screen");
  if (!vid || !screen) return;

  // Reset State
  liveScores = [];
  latestRowScores.clear();
  renderLiveScoringFromRubric({}, "live");
  
  vid.muted = true;
  screen.classList.remove("recording-active");
  
  if (UI.mediaStream) UI.mediaStream.getTracks().forEach(t => t.stop());
  
  UI.updateRecordingUI("idle");
  UI.setRecordedChunks([]);
  UI.setCurrentRecordingBlob(null);
  
  try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 1280, facingMode: UI.currentFacingMode }, audio: true 
        });
        UI.setMediaStream(stream);
        vid.srcObject = stream;
        await vid.play().catch(()=>{});
        screen.classList.remove("hidden");

      // ✅ SURGICAL FIX 4A: Unlock Record Button
    const recordBtn = UI.$("#start-rec-btn");
    const previewBtn = UI.$("#manual-preview-btn"); 
    const recTooltip = UI.$("#record-tooltip"); // Grab our new custom tooltip!
        
    if (recordBtn) {
        recordBtn.disabled = false; 
        recordBtn.title = ""; // Keep native white tooltip dead
        if (recTooltip) recTooltip.textContent = "Start Recording"; // Update pretty tooltip
    }
    if (previewBtn) {
         previewBtn.textContent = "Stop Preview";
         previewBtn.classList.add("bg-[#0033A0]");
    }

    } catch(e) {
      console.error(e);
      UI.toast("Camera blocked.", "error");
  }
}

export function stopPreview() {
    if (UI.mediaStream) {
        UI.mediaStream.getTracks().forEach(t => t.stop());
        UI.setMediaStream(null);
    }
    UI.$("#preview-player").srcObject = null;
    UI.$("#preview-screen").classList.add("hidden");

    // ✅ SURGICAL FIX 4B: Re-Lock Record Button & Reset Preview Text
    const recordBtn = UI.$("#start-rec-btn");
    const previewBtn = UI.$("#manual-preview-btn");
    const recTooltip = UI.$("#record-tooltip"); // Grab our new custom tooltip!

    if (recordBtn) {
        recordBtn.disabled = true; 
        recordBtn.title = ""; // Keep native white tooltip dead
        if (recTooltip) recTooltip.textContent = "Start Preview first"; // Update pretty tooltip!
    }
    
    if (previewBtn) {
        previewBtn.disabled = false;
        previewBtn.classList.remove("opacity-50", "cursor-not-allowed", "bg-red-800"); 
        previewBtn.textContent = "Start Preview";
        previewBtn.title = ""; 
        previewBtn.classList.add("bg-[#0033A0]");
    }
}

export async function startRecording() {
    if (!UI.mediaStream) { await startPreviewSafely(); if(!UI.mediaStream) return; }
    
    // ✅ SURGICAL FIX 3A: Lock Preview Button
    const previewBtn = UI.$("#manual-preview-btn");
    if (previewBtn) {
        previewBtn.disabled = true;
        previewBtn.classList.add("opacity-50", "cursor-not-allowed");
        previewBtn.title = "Stop recording first";
    }

  // ✅ Reset Score State
  liveScores = [];
  latestRowScores.clear();
  renderLiveScoringFromRubric({}, "live");

  UI.updateRecordingUI("recording");
  UI.setRecordedChunks([]);
  clearTagList();

  try {
      UI.mediaStream.getAudioTracks().forEach(t => t.enabled = true);
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
      const rec = new MediaRecorder(UI.mediaStream, { mimeType: mime });
      UI.setMediaRecorder(rec);

      rec.ondataavailable = e => { if (e.data.size > 0) UI.recordedChunks.push(e.data); };
      rec.onstop = () => {
          if (UI.recordedChunks.length > 0) {
              const blob = new Blob(UI.recordedChunks, { type: rec.mimeType });
              UI.setCurrentRecordingBlob(blob);
              openMetadataScreen();
          } else {
              UI.updateRecordingUI("idle");
              startPreviewSafely();
          }
      };

      rec.start(1000);
      UI.setSecondsElapsed(0);
      UI.$("#rec-timer").textContent = "00:00";
      if (UI.timerInterval) clearInterval(UI.timerInterval);
      UI.setTimerInterval(setInterval(() => {
          UI.setSecondsElapsed(UI.secondsElapsed + 1);
          UI.$("#rec-timer").textContent = new Date(UI.secondsElapsed * 1000).toISOString().substr(14, 5);
      }, 1000));
      UI.toast("Recording!", "success");

  } catch(e) {
      console.error(e);
      UI.toast("Recording failed.", "error");
      UI.updateRecordingUI("idle");
  }
}

export function pauseOrResumeRecording() {
  if (!UI.mediaRecorder) return;
  if (UI.mediaRecorder.state === "recording") {
      UI.mediaRecorder.pause();
      if(UI.timerInterval) clearInterval(UI.timerInterval);
      UI.updateRecordingUI("paused");
  } else {
      UI.mediaRecorder.resume();
      UI.setTimerInterval(setInterval(() => {
          UI.setSecondsElapsed(UI.secondsElapsed + 1);
          UI.$("#rec-timer").textContent = new Date(UI.secondsElapsed * 1000).toISOString().substr(14, 5);
      }, 1000));
      UI.updateRecordingUI("recording");
  }
}

export function stopRecording() {
    if (UI.secondsElapsed < 1) { UI.toast("Too short.", "warn"); return; }
    if (UI.mediaRecorder) UI.mediaRecorder.stop();
    if (UI.timerInterval) clearInterval(UI.timerInterval);
    UI.updateRecordingUI("stopped");

    // ✅ SURGICAL FIX 3B: Unlock Preview Button
    const previewBtn = UI.$("#manual-preview-btn");
    if (previewBtn) {
        previewBtn.disabled = false;
        previewBtn.classList.remove("opacity-50", "cursor-not-allowed");
        previewBtn.title = "Stop Preview";
    }
}

export async function discardRecording() {
    // ✅ SURGICAL FIX 1: Nuclear Timer Kill
    if (UI.timerInterval) {
        clearInterval(UI.timerInterval);
        UI.setTimerInterval(null);
    }
    UI.setSecondsElapsed(0);
    const timerDisplay = UI.$("#rec-timer");
    if (timerDisplay) timerDisplay.textContent = "00:00";

  if (UI.mediaRecorder?.state !== "inactive") {
      if (!await UI.showConfirm("Discard?", "Confirm", "Discard")) return;
      UI.mediaRecorder.onstop = null;
      UI.mediaRecorder.stop();
  }
  stopPreview();
  UI.setRecordedChunks([]);
  UI.setCurrentRecordingBlob(null);
  UI.updateRecordingUI("idle");
  UI.$("#rec-timer").textContent = "00:00";

  // ✅ SURGICAL FIX: Unlock the CORRECT button ID
    const previewBtn = UI.$("#manual-preview-btn"); 
    if (previewBtn) {
        previewBtn.disabled = false;
        previewBtn.classList.remove("opacity-50", "cursor-not-allowed");
        previewBtn.textContent = "Start Preview";
        previewBtn.title = "";
        previewBtn.classList.add("bg-[#0033A0]"); 
        
        // 🔒 FIX: Lock the Record button when Preview is stopped/reset!
        const recBtn = UI.$("#start-rec-btn");
        const recTooltip = UI.$("#record-tooltip");
        
        if (recBtn) {
            recBtn.disabled = true; // HTML instantly dims it to dark red
            recBtn.title = ""; // Keep native white tooltip dead
            if (recTooltip) recTooltip.textContent = "Start Preview first"; // Reset custom tooltip
        }
    }
}

export async function toggleCamera() {
  UI.setCurrentFacingMode(UI.currentFacingMode === "user" ? "environment" : "user");
  await startPreviewSafely();
}

// ✅ RESET STATE HELPER (Fixes "Ghost Checkboxes" and Stale Data)
function resetMetadataForm() {
  const form = UI.$("#metadata-form");
  if (form) form.reset();

  // 1. Reset Selects
  const typeSelect = UI.$("#metadata-recording-type");
  if (typeSelect) typeSelect.value = "individual";

  const classSelect = UI.$("#meta-class");
  if (classSelect) classSelect.value = "";

  const studentSelect = UI.$("#metadata-student-select");
  if (studentSelect) {
      studentSelect.innerHTML = '<option value="">Select a class/event first...</option>';
      studentSelect.disabled = true;
      studentSelect.classList.remove("hidden");
      studentSelect.required = true;
  }

  // 2. Hide & Clear Group UI
  UI.$("#add-participant-container").classList.add("hidden");
  
  const groupContainer = UI.$("#group-participant-container");
  if (groupContainer) groupContainer.classList.add("hidden");

  const groupListDiv = UI.$("#group-participant-list");
  if (groupListDiv) groupListDiv.innerHTML = ""; // ✅ FIX: Wipes old checkboxes completely

  // 3. Clear Group Name
  const groupNameInput = UI.$("#metadata-group-tag");
  if (groupNameInput) {
      groupNameInput.value = "";
      groupNameInput.required = false;
  }
}

function openMetadataScreen() {
  if (!UI.currentRecordingBlob) return;
  
  resetMetadataForm(); // ✅ Calls the rigorous reset above

  // Wire Add Class button (safe init)
const addClassBtn = UI.$("#add-class-btn");
if (addClassBtn && !addClassBtn.dataset.bound) {
  addClassBtn.addEventListener("click", handleAddNewClass);
  addClassBtn.dataset.bound = "true"; // prevent double-binding
}


  UI.$("#meta-org").value = UI.userDoc.organizationName || "Default Org";
  UI.$("#meta-instructor").value = UI.userDoc.instructorName || (UI.currentUser ? UI.currentUser.email : "Instructor");
  
  UI.refreshMetadataClassList();
  
  UI.$("#meta-file-size").textContent = `${(UI.currentRecordingBlob.size / 1024 / 1024).toFixed(2)} MB`;
  UI.$("#metadata-screen").showModal();
}

// ================================
// HANDLE CLASS CHANGE
// ================================
export function handleMetadataClassChange(e) {
  const classId = e.target.value;
  const classSelect = e.target;
  const addClassUI = UI.$("#add-class-container");
  const participantSelect = UI.$("#metadata-student-select");

  if (classId === "__add__") {
  const addUI = UI.$("#add-class-container");
  const input = UI.$("#new-class-name");

  addUI?.classList.remove("hidden");
  input && (input.value = "");
  input?.focus();

  // Reset dropdown so no phantom selection exists
  e.target.value = "";
  return;
}


  // Hide add-class UI otherwise
  addClassUI?.classList.add("hidden");

  // ── 2. Reset participant dropdown ──────────────────────
  participantSelect.innerHTML =
    '<option value="">Select a participant…</option>';
  participantSelect.disabled = true;

  if (!classId) return;

  // ── 3. Populate participants ───────────────────────────
  const classObj = UI.classData?.[classId];
  if (classObj && Array.isArray(classObj.participants)) {
    participantSelect.disabled = false;

    classObj.participants.forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      participantSelect.appendChild(opt);
    });

    const addOpt = document.createElement("option");
    addOpt.value = "__add__";
    addOpt.textContent = "➕ Add new participant…";
    participantSelect.appendChild(addOpt);
  }

  // ── 4. Rebuild group checklist if needed ───────────────
  if (window.populateGroupChecklist) {
    window.populateGroupChecklist();
  }
}

// ================================
// ADD NEW CLASS / EVENT (SAFE)
// ================================
export async function handleAddNewClass() {
  console.warn("HANDLE ADD CLASS CALLED");
  const input = UI.$("#new-class-name");
  const title = input?.value.trim();

  if (!title) {
    UI.toast("Enter a class/event name.", "error");
    return;
  }

  // Prevent duplicates (case-insensitive)
  const existing = Object.values(UI.classData || {})
    .map(c => typeof c?.title === "string" ? c.title.toLowerCase() : null)
    .filter(Boolean);

  if (existing.includes(title.toLowerCase())) {
    UI.toast("Class already exists.", "warning");
    return;
  }

  try {
    // ✅ WRITE FIRST — SOURCE OF TRUTH
    const docRef = await addDoc(
      collection(
        UI.db,
        `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/classes`
      ),
      {
        title,
        participants: [],
        archived: false,
        createdAt: serverTimestamp()
      }
    );

    // 🔒 TRACK THIS CLASS UNTIL USER SAVES OR CANCELS
    pendingNewClassId = docRef.id;

    // ✅ UPDATE CACHE ONLY AFTER FIRESTORE SUCCESS
    UI.classData[docRef.id] = {
     id: docRef.id,
     title,
     participants: [],
     archived: false
  };

     console.warn("CLASS WRITTEN TO UI.classData", docRef.id);


    // Refresh all dropdowns
    UI.refreshMetadataClassList();

    // Auto-select new class
    const select = UI.$("#meta-class");
    if (select) {
      select.value = docRef.id;
      handleMetadataClassChange({ target: select });
    }

    // Reset UI
    input.value = "";
    UI.$("#add-class-container")?.classList.add("hidden");

    UI.toast("Class added.", "success");

  } catch (err) {
    console.error("Add class failed:", err);
    UI.toast("Failed to add class.", "error");
  }
}

// ================================
// CANCEL ADD CLASS (NO GHOSTS)
// ================================
export function cancelAddClass() {
  // If a temp class was created, remove it
  if (pendingNewClassId && UI.classData[pendingNewClassId]) {
    delete UI.classData[pendingNewClassId];
    pendingNewClassId = null;

    // Refresh all class dropdowns
    UI.refreshMetadataClassList();
  }

  // Clear input + hide UI
  const input = UI.$("#new-class-name");
  if (input) input.value = "";

  UI.$("#add-class-container")?.classList.add("hidden");
}

// ================================
// HANDLE PARTICIPANT CHANGE
// ================================
export function handleMetadataParticipantChange(e) {
  const selected = e.target.value;

  // Show Add UI only when sentinel option is chosen
  if (selected === "__add__") {
    UI.$("#add-participant-container").classList.remove("hidden");
    e.target.value = ""; // reset select so form validation is clean
    return;
  }

  // Hide add UI otherwise
  UI.$("#add-participant-container").classList.add("hidden");
}


// ================================
// ADD NEW PARTICIPANT
// ================================
export async function handleAddNewParticipant() {
  const classId = UI.$("#meta-class").value;
  const input = UI.$("#new-participant-name");
  const newName = input.value.trim();

  if (!classId || !newName) {
    UI.toast("Enter a participant name.", "error");
    return;
  }

  const current = UI.classData[classId].participants || [];

  // Prevent duplicates (case-insensitive)
  if (current.some(p => p.toLowerCase() === newName.toLowerCase())) {
    UI.toast("Participant already exists.", "warning");
    return;
  }

  current.push(newName);

  await updateDoc(
    doc(
      UI.db,
      `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/classes`,
      classId
    ),
    { participants: current }
  );

  // Update local cache
  UI.classData[classId].participants = current;

  // Refresh dropdown cleanly
  handleMetadataClassChange({ target: { value: classId } });

  // Auto-select newly added participant
  const select = UI.$("#metadata-student-select");
  select.value = newName;

  // Reset add UI
  input.value = "";
  UI.$("#add-participant-container").classList.add("hidden");

  UI.toast("Participant added.", "success");
}


/* -------------------------------------------------------------------------- */
/* EXPORT TO LOCAL (File Download ONLY - No DB Write)
/* -------------------------------------------------------------------------- */
async function exportToLocal(metadata) {
  try {
      const blob = UI.currentRecordingBlob;
      if (!blob) throw new Error("No blob");

      const nameSegment = (metadata.recordingType === 'group' && metadata.groupName) ? metadata.groupName : metadata.participant;
      const safeClass = (metadata.classEventTitle || "class").replace(/[^\w\d-_]+/g, "_");
      const safeName = (nameSegment || "student").replace(/[^\w\d-_]+/g, "_");
      const fileName = `${safeClass}_${safeName}_${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;

      let saved = false;
      
      // 1. Try Modern Save Picker
      if (window.showSaveFilePicker) {
          try {
              const handle = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ accept: {'video/webm': ['.webm']} }] });
              const w = await handle.createWritable();
              await w.write(blob);
              await w.close();
              saved = true;
          } catch(e) {
              if (e.name === 'AbortError') throw new Error("CANCELLED");
          }
      }

      // 2. Fallback to Auto-Download
      if (!saved) {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = fileName;
          a.click();
      }

      // ❌ DELETED: The Firestore 'setDoc' block was here. 
      // Removing it stops the "Double Sean" bug. 
      // The database save is handled exclusively by saveLocalData() now.

      stopPreview();
      const manageBtn = document.querySelector('[data-tab="tab-manage"]');
      if(manageBtn) manageBtn.click();

  } catch (err) {
      if (err.message === "CANCELLED") throw err;
      UI.toast("Export failed", "error");
      throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* ✅ FINAL METADATA SUBMIT (Hardened)
/* NOTE:
 * - This must be the ONLY submit handler bound to the metadata form.
 * - Do NOT keep older handlers, or duplicate writes will occur.
 * -------------------------------------------------------------------------- */
export async function handleMetadataSubmit(e) {
  e.preventDefault();
  if (!UI.currentRecordingBlob) {
    UI.toast("No recording.", "error");
    return;
  }

  /* ---------------------------------------------------------------------- */
  /* 1. GATHER DATA                                                         */
  /* ---------------------------------------------------------------------- */
  const type = UI.$("#metadata-recording-type").value;
  const groupName = UI.$("#metadata-group-tag").value;
  let participants = [];

  if (type === "group") {
    document
      .querySelectorAll(".group-student-checkbox:checked")
      .forEach(cb => participants.push(cb.value));

    // Fallback if checkboxes are not used
    if (participants.length === 0 && UI.$("#metadata-student-select").value) {
      participants.push(UI.$("#metadata-student-select").value);
    }
  } else {
    if (UI.$("#metadata-student-select").value) {
      participants.push(UI.$("#metadata-student-select").value);
    }
  }

  // ✅ HARD DEDUPLICATION & CLEANUP
  participants = [
    ...new Set(participants.map(p => p?.trim()).filter(Boolean))
  ];

  /* ---------------------------------------------------------------------- */
  /* 2. VALIDATION (WITH USER FEEDBACK)                                     */
  /* ---------------------------------------------------------------------- */
  if (type === "group") {
    if (participants.length < 2) {
      await UI.showConfirm(
        "A group must have at least 2 participants.\nSwitch to 'Individual' if only 1 student.",
        "Invalid Group",
        "OK"
      );
      return;
    }

    if (!groupName.trim()) {
      UI.toast("Enter a group name.", "error");
      return;
    }
  } else {
    if (participants.length === 0) {
      UI.toast("Select a participant.", "error");
      return;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 3. BUILD METADATA                                                      */
  /* ---------------------------------------------------------------------- */
  const classEl = UI.$("#meta-class");
  const rubric = Rubrics.getActiveRubric();

  const finalScores = {};
  let totalScore = 0;
  latestRowScores.forEach((v, k) => {
    finalScores[k] = v;
    totalScore += v;
  });

  const rowNotes = {};
  document.querySelectorAll("[data-note-row-id]").forEach(el => {
    if (el.value.trim()) {
      rowNotes[el.dataset.noteRowId] = el.value.trim();
    }
  });

  const generalNotes = UI.$("#meta-notes").value.trim() || null;

  const metadata = {
  organization: UI.$("#meta-org").value,
  instructor: UI.$("#meta-instructor").value,
  id: null,

  classEventId: classEl.value,
  classEventTitle: classEl.options[classEl.selectedIndex]?.text || "N/A",

  participants,
  participant: participants[0],

  recordingType: type,
  isGroup: type === "group",
  groupName: type === "group" ? groupName : null,

  notes: generalNotes,
  tags: currentTags,

  fileSize: UI.currentRecordingBlob.size,
  duration: UI.secondsElapsed,

  recordedAt: new Date().toISOString(),

  hasScore: true,
  rubricId: rubric?.id || null,
  rubricTitle: rubric?.title || null,

  finalScores,
  totalScore,
  rowNotes
};

  /* ---------------------------------------------------------------------- */
  /* 4. CONFIRM                                                            */
  /* ---------------------------------------------------------------------- */
  const msg =
    type === "group"
      ? `Group: ${groupName}\nStudents: ${participants.join(", ")}`
      : `Student: ${metadata.participant}\nClass: ${metadata.classEventTitle}`;

  if (!(await UI.showConfirm(msg, "Confirm Save", "Save"))) return;

  /* ---------------------------------------------------------------------- */
  /* 5. SAVE (WITH BUTTON LOCK)                                             */
  /* ---------------------------------------------------------------------- */
  const submitBtn = e.target.querySelector("button[type='submit']");
  const oldText = submitBtn?.innerHTML || "Save";

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";
  }

  try {
    UI.toast("Saving...", "info");
    const storage = UI.getStorageChoice();

    if (storage === "local") {
      await exportToLocal(metadata);
      UI.toast("Syncing data...", "info");
      await saveLocalData(metadata);
    } else if (storage === "gdrive") {
      await UI.uploadToDrivePlaceholder(
        UI.currentRecordingBlob,
        metadata
      );
    } else {
      metadata.id = null;
      await saveRecording(metadata, UI.currentRecordingBlob);
    }

    UI.$("#metadata-screen").close();
    UI.toast("Saved!", "success");

    if (storage !== "local") {
      stopPreview();
      document
        .querySelector('[data-tab="tab-manage"]')
        ?.click();
      discardRecording();
    }
  } catch (err) {
    if (err.message !== "CANCELLED") {
      console.error(err);
      UI.toast(`Save failed: ${err.message}`, "error");
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = oldText;
    }
  }
}

// ---------------------------------------------------------
// 🎯 TIMELINE PIN RENDERER (Clean Flags Style)
// ---------------------------------------------------------
function renderTimelinePins(tags, dbDuration) {
    const video = document.getElementById("main-player");
    const layer = document.getElementById("timeline-marker-layer");

    // 1. Safety Checks
    if (!video || !layer) return;

    layer.innerHTML = ""; // Clear existing

    if (!Array.isArray(tags) || tags.length === 0) return;

    // 2. GET DURATION
    let duration = dbDuration;
    if (!duration && video.seekable.length > 0) duration = video.seekable.end(0);
    if (!duration) duration = video.duration;

    // Retry if missing
    if (!duration || isNaN(duration) || duration === Infinity) {
        setTimeout(() => renderTimelinePins(tags, dbDuration), 500);
        return;
    }

    // 3. RENDER FLAGS
    tags.forEach(tag => {
        if (!tag.time || tag.time < 0) return;

        const percent = (tag.time / duration) * 100;
        if (percent > 100) return; 

        // 🧠 SMART TOOLTIP POSITIONING
        let tooltipClasses = "left-1/2 -translate-x-1/2";
        let arrowClasses = "left-1/2 -translate-x-1/2";

        if (percent < 15) {
            tooltipClasses = "left-0"; 
            arrowClasses = "left-1.5"; 
        } else if (percent > 85) {
            tooltipClasses = "right-0 auto"; 
            arrowClasses = "right-1.5 auto";   
        }

        // CONTAINER (Hitbox)
        const pinContainer = document.createElement("div");
        pinContainer.className = `
          absolute top-1/2 -translate-y-1/2 
          -ml-1.5
          w-4 h-6 
          flex items-end justify-center
          cursor-pointer
          pointer-events-auto  
          z-[101]
          group
        `;
        pinContainer.style.left = `${percent}%`;

        // 1. THE FLAG ICON (Visible)
        // Using an SVG to draw a crisp flag
        const flagIcon = document.createElement("div");
        flagIcon.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4 text-[#005288] drop-shadow-sm transition-transform duration-200 group-hover:scale-125 group-hover:text-[#0063a3]">
              <path fill-rule="evenodd" d="M3 2.25a.75.75 0 01.75.75v.54l1.838-.46a9.75 9.75 0 016.725.738l.108.054a8.25 8.25 0 005.58.652l3.109-.732a.75.75 0 01.917.81 47.784 47.784 0 00.005 10.337.75.75 0 01-.574.812l-3.114.733a9.75 9.75 0 01-6.594-.158l-.108-.054a8.25 8.25 0 00-5.69-.625l-2.202.55V21a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75z" clip-rule="evenodd" />
            </svg>
        `;
        
        // 2. THE TOOLTIP (Hidden by default)
        const tooltip = document.createElement("div");
        const mins = Math.floor(tag.time / 60);
        const secs = Math.floor(tag.time % 60).toString().padStart(2, '0');
        
        tooltip.innerHTML = `
            ${tag.note || "Marker"} (${mins}:${secs})
            <div class="absolute top-full ${arrowClasses} border-4 border-transparent border-t-gray-900/90"></div>
        `;
        
        tooltip.className = `
            absolute bottom-full mb-1 ${tooltipClasses}
            px-2 py-1
            bg-gray-900/90 text-white text-[10px] font-medium rounded shadow-lg
            whitespace-nowrap pointer-events-none
        `;
        
        // Hard Hide logic
        tooltip.style.display = "none"; 

        // 🖱️ MOUSE EVENTS
        pinContainer.onmouseenter = () => {
            tooltip.style.display = "block";
            pinContainer.style.zIndex = "999";  
        };

        pinContainer.onmouseleave = () => {
            tooltip.style.display = "none";
            pinContainer.style.zIndex = "101";  
        };

        // Click Logic
        pinContainer.onclick = (e) => {
            e.stopPropagation(); 
            video.currentTime = tag.time;
        };

        // Assemble
        pinContainer.appendChild(flagIcon);
        pinContainer.appendChild(tooltip);
        layer.appendChild(pinContainer);
    });
}
window.renderTimelinePins = renderTimelinePins;