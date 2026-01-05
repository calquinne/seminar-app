/* ========================================================================== */
/* MODULE: record.js
/* Exports all MediaRecorder, Preview, and Metadata/Scoring logic.
/* ========================================================================== */

import * as UI from "./ui.js";
import { uploadFile } from "./firestore.js";
import { doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import * as Rubrics from "./rubrics.js"; 

// ✅ LOCAL STATE
let currentTags = [];
let liveScores = [];                  // Timeline scoring (recording only)
const latestRowScores = new Map();    // rowId → score
let currentLibraryVideoId = null;     // Tracks which video is being edited in Library
let previewLock = false;              // Prevents double-taps

/* ========================================================================== */
/* LIBRARY CONTEXT & SAVE HANDLER
/* ========================================================================== */

// Called by ui.js when opening a video
export function setCurrentLibraryVideoId(id) {
  currentLibraryVideoId = id;
}

// ✅ GLOBAL LISTENER: Handles "Save Score" button click in Library View
// Updated to listen for the new ID: #playback-save-btn
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("#playback-save-btn, #scoring-save-btn");
  if (btn) {
      if (!currentLibraryVideoId) {
          UI.toast("No active library video to save.", "error");
          return;
      }

      // 1. Gather Final Scores from Map
      const finalScores = {};
      let totalScore = 0;
      latestRowScores.forEach((score, rowId) => {
          finalScores[rowId] = score;
          totalScore += score;
      });

      // 2. Gather Notes from DOM
      const rowNotes = {};
      document.querySelectorAll('[data-note-row-id]').forEach(el => {
          if (el.value.trim()) {
              rowNotes[el.dataset.noteRowId] = el.value.trim();
          }
      });

      // 3. Get Active Rubric Info
      const rubric = Rubrics.getActiveRubric();

      // 4. Update Firestore
      const originalText = btn.innerHTML;
      btn.textContent = "Saving...";
      btn.disabled = true;

      try {
          const docRef = doc(
              UI.db, 
              `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`, 
              currentLibraryVideoId
          );

          await updateDoc(docRef, {
              finalScores,
              rowNotes,
              totalScore,
              hasScore: true, // ✅ CRITICAL: Marks video as scored
              lastScore: totalScore,
              rubricId: rubric?.id || null,
              rubricTitle: rubric?.title || null,
              lastScoredAt: serverTimestamp()
          });

          UI.toast("Scores updated successfully!", "success");
          
      } catch (err) {
          console.error("Score save failed:", err);
          UI.toast("Failed to save scores.", "error");
      } finally {
          btn.innerHTML = originalText;
          btn.disabled = false;
      }
  }
});

/* ========================================================================== */
/* ✅ DUAL-MODE SCORING RENDERER (LIVE vs PLAYBACK)
/* ========================================================================== */

// Inject styles for tooltips once
const styleId = "rubric-tooltip-styles";
if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        .score-btn-wrapper { position: relative; display: inline-block; overflow: visible; }
        
        /* --- DEFAULT TOOLTIP (Pops UP, Aligned Left) --- */
        .rubric-tooltip {
            visibility: hidden; position: absolute; z-index: 9999; 
            
            /* Position ABOVE the button */
            bottom: calc(100% + 8px); 
            
            /* Align left edge with button left edge (Prevents left-side clipping) */
            left: 0; 
            
            width: max-content; max-width: 250px;
            background-color: #0f172a; color: #e5e7eb; font-size: 11px; line-height: 1.4;
            border-radius: 6px; padding: 8px 12px; opacity: 0;
            transition: opacity 0.15s ease-in-out; pointer-events: none;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.6);
            border: 1px solid rgba(255,255,255,0.1);
            white-space: normal; text-align: left;
        }

        .score-btn-wrapper:hover .rubric-tooltip { visibility: visible; opacity: 1; }

        /* --- FIX: TOP ROW ONLY (Pops DOWN) --- */
        /* This detects the first row and flips the tooltip to the bottom */
        .live-score-row:first-child .rubric-tooltip {
            bottom: auto;
            top: calc(100% + 8px);
        }
    `;
    document.head.appendChild(style);
}

// ✅ MAIN RENDERER: Dispatches to Read-Only or Interactive helper
export function renderLiveScoringFromRubric(input = {}, context = "live", options = {}) {
  const prefix = context;
  
  // 1. Determine Container (Support Modals via options.container)
  const rowsContainer = options.container || UI.$(`#${prefix}-scoring-rows`);
  const titleEl = !options.container ? (UI.$(`#${prefix}-rubric-title`) || UI.$(`#${prefix}-scoring-rubric-title`)) : null;
  const totalEl = !options.container ? UI.$(`#${prefix}-score-total`) : null;

  // 2. Safety Check (Logs warning instead of crashing)
  if (!rowsContainer) {
      // Only warn if we expect it to be there (ignore if tab is hidden)
      if (!options.container) console.warn(`[Record] Container not found for context: ${context}. Tab might be hidden.`);
      return;
  }

  rowsContainer.innerHTML = "";
  
  // 3. Normalize Input
  const existingScores = input.finalScores || input.scores || input.existingScores?.scores || input || {};
  const existingNotes = input.rowNotes || input.notes || input.existingScores?.notes || {};
  
  // 4. Get Active Rubric
  const rubric = input.rubricSnapshot || Rubrics.getActiveRubric();
  let initialTotal = 0;

  if (!rubric || !rubric.rows || rubric.rows.length === 0) {
      rowsContainer.innerHTML = `<div class="p-4 text-center text-sm text-gray-500">No rubric data available.</div>`;
      if(titleEl) titleEl.textContent = "No Rubric";
      return;
  }

  if(titleEl) titleEl.textContent = rubric.title;

  // 5. Build Rows
  rubric.rows.forEach((row, index) => {
      let savedScore = existingScores[row.id];
      let savedNote = existingNotes[row.id] || "";

      if (savedScore !== undefined && savedScore !== null) {
          if (context !== "analytics") latestRowScores.set(row.id, Number(savedScore));
          initialTotal += Number(savedScore);
      }

      const rowEl = document.createElement("div");
      rowEl.className = "mb-4 pb-3 border-b border-white/10 last:border-0 overflow-visible";

      // Render Header
      rowEl.innerHTML = `
        <div class="flex justify-between items-end mb-2">
          <span class="text-sm font-medium text-white">
            <span class="text-primary-400 mr-1">${index + 1}.</span> ${row.label}
          </span>
          <span class="text-[10px] text-gray-500 uppercase tracking-wide">Max: ${row.maxPoints}</span>
        </div>
      `;

      // ✅ DISPATCH: Split Logic for Read-Only vs Interactive
      if (options.readOnly) {
          rowEl.innerHTML += _renderReadOnlyRow(row, savedScore, savedNote);
      } else {
          rowEl.innerHTML += _renderInteractiveRow(row, savedScore, savedNote, prefix);
      }

      rowsContainer.appendChild(rowEl);
  });

  // 6. Attach Listeners (Interactive Only)
  if (!options.readOnly) {
      rowsContainer.querySelectorAll(".live-score-btn").forEach((btn) => {
        btn.onclick = () => handleScoreClick(btn, prefix);
      });
  }

  if (totalEl) totalEl.textContent = initialTotal;
}

// 🔒 Helper: Read-Only View (The "Scorecard")
function _renderReadOnlyRow(row, savedScore, savedNote) {
    const scoreDisplay = savedScore !== undefined ? savedScore : "-";
    const max = row.maxPoints;
    const pct = (Number(scoreDisplay) || 0) / max * 100;
    
    let colorClass = "bg-primary-600";
    if(pct < 50) colorClass = "bg-red-600";
    else if(pct < 80) colorClass = "bg-yellow-500";

    return `
        <div class="flex items-center gap-3">
            <div class="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div class="h-full ${colorClass}" style="width: ${pct}%"></div>
            </div>
            <div class="text-sm font-bold text-white w-8 text-right">${scoreDisplay}</div>
        </div>
        ${savedNote ? `<div class="mt-2 text-xs text-gray-400 italic border-l-2 border-white/10 pl-2">"${savedNote}"</div>` : ''}
    `;
}

// 🔓 Helper: Interactive View (Buttons & Textarea)
function _renderInteractiveRow(row, savedScore, savedNote, prefix) {
    let html = `<div class="flex flex-wrap gap-1 mb-2">`;
    
    let scoresToRender = row.allowedScores;
    if (!scoresToRender || scoresToRender.length === 0) {
        const max = row.maxPoints || 5;
        scoresToRender = [];
        for(let i=0; i<=max; i++) scoresToRender.push({ value: i, label: '' });
    }

    scoresToRender.forEach(opt => {
        const val = opt.value;
        const label = opt.label || '';
        const isActive = (val === (savedScore !== null ? Number(savedScore) : null));
        
        const btnClass = isActive 
        ? "bg-primary-600 text-white border-primary-400 font-bold scale-110 shadow-md"
        : "bg-white/10 text-gray-300 hover:bg-white/20 border-transparent";

        html += `
        <div class="score-btn-wrapper">
            <button type="button" class="live-score-btn w-8 h-8 text-xs rounded transition-all border focus:outline-none ${btnClass}"
                data-score="${val}" data-row-id="${row.id}" data-context="${prefix}">
                ${val}
            </button>
            ${label ? `<div class="rubric-tooltip">${label}</div>` : ''}
        </div>
        `;
    });
    html += `</div>`;
    
    html += `
    <textarea class="w-full bg-black/20 border border-white/10 rounded p-2 text-xs text-gray-300 focus:border-primary-500 focus:outline-none resize-none placeholder-gray-600"
        rows="1" placeholder="Add a note..." data-note-row-id="${row.id}">${savedNote}</textarea>
    `;
    
    return html;
}

function handleScoreClick(btnElement, prefix) {
    const container = btnElement.closest('.live-score-row'); 
    if (!container) return;

    const rowId = btnElement.dataset.rowId;
    const score = Number(btnElement.dataset.score);
    
    // 1. Visual Update
    const allBtns = container.querySelectorAll(".live-score-btn");
    allBtns.forEach(b => {
        b.className = "live-score-btn w-8 h-8 text-xs rounded transition-all border focus:outline-none bg-white/10 text-gray-300 hover:bg-white/20 border-transparent";
    });
    
    btnElement.className = "live-score-btn w-8 h-8 text-xs rounded transition-all border focus:outline-none bg-primary-600 text-white border-primary-400 font-bold scale-110 shadow-md";
    
    // 2. Record Event (only if recording AND in live mode)
    if (prefix === 'live' && UI.mediaRecorder && (UI.mediaRecorder.state === 'recording' || UI.mediaRecorder.state === 'paused')) {
        const timestamp = UI.secondsElapsed;
        liveScores.push({ rowId, score, timestamp });
        UI.toast(`Scored ${score} pts`, "success");
    }
    
    // 3. Update Total (Targeting the correct element)
    latestRowScores.set(rowId, score);
    let total = 0;
    latestRowScores.forEach(val => total += val);
    
    const totalEl = UI.$(`#${prefix}-score-total`);
    if(totalEl) {
        totalEl.style.transform = "scale(1.2)";
        totalEl.textContent = total;
        setTimeout(() => totalEl.style.transform = "scale(1)", 200);
    }
}

/* ========================================================================== */
/* RECORDING / PREVIEW (Context: "live")
/* ========================================================================== */

function clearTagList() {
  const list = UI.$("#tag-list");
  if (list) list.innerHTML = "";
  currentTags = [];
}

function appendTagToTimeline(timeSeconds) {
  const list = UI.$("#tag-list");
  if (!list) return;
  const li = document.createElement("div");
  li.className = "text-xs text-gray-300 border-l-2 border-gray-600 pl-2 mb-1";
  li.textContent = `Tag at ${new Date(timeSeconds * 1000).toISOString().substr(14, 5)}`;
  list.appendChild(li);
}

export function handleTagButtonClick() {
  if (!UI.mediaRecorder || UI.mediaRecorder.state !== "recording") {
    UI.toast("Start recording to tag.", "warn");
    return;
  }
  const time = UI.secondsElapsed;
  UI.toast(`Tag added at ${time}s`, "info");
  currentTags.push({ time, note: `Tag at ${time}s` });
  appendTagToTimeline(time);
}

export async function startPreviewSafely() {
  const recordTab = UI.$("[data-tab='tab-record']");
  if (!recordTab || recordTab.classList.contains("hidden")) return;

  if (previewLock) return;
  previewLock = true;
  setTimeout(() => (previewLock = false), 300);

  if (!UI.hasAccess()) {
    UI.toast("Recording disabled without an active subscription.", "error");
    return;
  }

  const previewVideo = UI.$("#preview-player");
  const previewScreen = UI.$("#preview-screen");

  if (!previewVideo || !previewScreen) return;

  previewScreen.classList.remove("recording-active");
  previewVideo.muted = true;
  previewVideo.playsInline = true;

  if (UI.mediaStream) {
    UI.mediaStream.getTracks().forEach(t => t.stop());
    UI.setMediaStream(null);
  }

  UI.updateRecordingUI("idle");
  UI.setRecordedChunks([]);
  UI.setCurrentRecordingBlob(null);
  clearTagList();
  currentLibraryVideoId = null;
  
  // ✅ RENDER FOR LIVE CONTEXT
  renderLiveScoringFromRubric({}, "live"); 

  if (UI.timerInterval) clearInterval(UI.timerInterval);
  UI.setSecondsElapsed(0);
  UI.$("#rec-timer").textContent = "00:00";

  try {
    const constraints = {
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: UI.currentFacingMode },
      audio: true
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    UI.setMediaStream(stream);
    previewVideo.srcObject = stream;
    stream.getAudioTracks().forEach(t => (t.enabled = false));
    await previewVideo.play().catch(err => console.warn("Autoplay blocked", err));
    previewScreen.classList.remove("hidden");
    UI.toast("🎥 Preview active.", "info");
  } catch (err) {
    console.error("Camera error:", err);
    UI.toast("Camera or microphone access denied.", "error");
  }
}

export function stopPreview() {
    const previewScreen = UI.$("#preview-screen");
    const previewVideo = UI.$("#preview-player");
    if (UI.mediaStream) {
        UI.mediaStream.getTracks().forEach(t => t.stop());
        UI.setMediaStream(null);
    }
    if (previewVideo) previewVideo.srcObject = null;
    if (previewScreen) previewScreen.classList.add("hidden");
}

export async function startRecording() {
  if (!UI.hasAccess()) {
    UI.toast("Recording disabled.", "error");
    return;
  }
  if (!UI.mediaStream) {
    await startPreviewSafely();
    if (!UI.mediaStream) return;
  }

  UI.updateRecordingUI("recording");
  UI.setRecordedChunks([]);
  UI.setCurrentRecordingBlob(null);
  clearTagList();
  
  // ✅ RENDER FOR LIVE CONTEXT
  renderLiveScoringFromRubric({}, "live");

  try {
    UI.mediaStream.getAudioTracks().forEach((track) => (track.enabled = true));
    let mime = "video/webm;codecs=vp9,opus";
    if (!MediaRecorder.isTypeSupported(mime)) mime = "video/webm";

    const recorder = new MediaRecorder(UI.mediaStream, { mimeType: mime });
    UI.setMediaRecorder(recorder);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) UI.recordedChunks.push(e.data);
    };

    recorder.onstop = () => {
      if (UI.mediaStream) {
        UI.mediaStream.getTracks().forEach((track) => track.stop());
        UI.setMediaStream(null);
      }
      const previewVideo = UI.$("#preview-player");
      if (previewVideo) previewVideo.srcObject = null;

      if (UI.recordedChunks.length > 0) {
        const blob = new Blob(UI.recordedChunks, { type: recorder.mimeType });
        UI.setCurrentRecordingBlob(blob);
        openMetadataScreen();
      } else {
        UI.updateRecordingUI("idle");
        startPreviewSafely();
      }
      UI.setRecordedChunks([]);
    };

    recorder.start(1000);
    UI.setSecondsElapsed(0);
    if (UI.timerInterval) clearInterval(UI.timerInterval);
    UI.$("#rec-timer").textContent = "00:00";
    UI.setTimerInterval(setInterval(() => {
        UI.setSecondsElapsed(UI.secondsElapsed + 1);
        UI.$("#rec-timer").textContent = new Date(UI.secondsElapsed * 1000).toISOString().substr(14, 5);
    }, 1000));
    UI.toast("Recording started!", "success");
  } catch (err) {
    console.error("Start recording failed:", err);
    UI.toast("Error starting recording.", "error");
    UI.updateRecordingUI("idle");
  }
}

export function pauseOrResumeRecording() {
  if (!UI.mediaRecorder) return;
  if (UI.mediaRecorder.state === "recording") {
    UI.mediaRecorder.pause();
    if (UI.timerInterval) clearInterval(UI.timerInterval);
    UI.updateRecordingUI("paused");
    UI.toast("Paused", "info");
  } else if (UI.mediaRecorder.state === "paused") {
    UI.mediaRecorder.resume();
    UI.setTimerInterval(setInterval(() => {
        UI.setSecondsElapsed(UI.secondsElapsed + 1);
        UI.$("#rec-timer").textContent = new Date(UI.secondsElapsed * 1000).toISOString().substr(14, 5);
    }, 1000));
    UI.updateRecordingUI("recording");
    UI.toast("Resumed", "info");
  }
}

export function stopRecording() {
  if (UI.secondsElapsed < 1) {
    UI.toast("Recording too short.", "error");
    return;
  }
  if (UI.mediaRecorder && (UI.mediaRecorder.state === "recording" || UI.mediaRecorder.state === "paused")) {
    UI.mediaRecorder.stop();
    if (UI.timerInterval) clearInterval(UI.timerInterval);
    UI.updateRecordingUI("stopped");
  }
}

export async function discardRecording() {
  if (UI.mediaRecorder && (UI.mediaRecorder.state === "recording" || UI.mediaRecorder.state === "paused")) {
    const confirmed = await UI.showConfirm("Discard this recording?", "Discard?", "Discard");
    if (!confirmed) return;
    UI.mediaRecorder.onstop = null;
    UI.mediaRecorder.stop();
    UI.setMediaRecorder(null);
  }
  stopPreview();
  UI.setRecordedChunks([]);
  UI.setCurrentRecordingBlob(null);
  if (UI.timerInterval) clearInterval(UI.timerInterval);
  UI.setSecondsElapsed(0);
  UI.$("#rec-timer").textContent = "00:00";
  UI.updateRecordingUI("idle");
  clearTagList();
  const manualPreviewBtn = UI.$("#manual-preview-btn");
  if(manualPreviewBtn) manualPreviewBtn.textContent = "Start Preview";
}

export async function toggleCamera() {
  UI.setCurrentFacingMode(UI.currentFacingMode === "user" ? "environment" : "user");
  UI.toast("Switching camera...", "info");
  if (!UI.mediaRecorder || UI.mediaRecorder.state === "inactive") {
    await startPreviewSafely();
  }
}

function openMetadataScreen() {
  if (!UI.currentRecordingBlob) {
    UI.toast("No recording.", "error");
    return;
  }
  UI.$("#metadata-form").reset();
  UI.$("#meta-org").value = UI.userDoc.organizationName || "Default Org";
  UI.$("#meta-instructor").value = UI.userDoc.instructorName || (UI.currentUser ? UI.currentUser.email : "Instructor");
  UI.refreshMetadataClassList();
  UI.$("#meta-class").value = "";
  UI.$("#meta-participant").innerHTML = '<option value="">Select a class/event first...</option>';
  UI.$("#meta-participant").disabled = true;
  UI.$("#add-participant-container").classList.add("hidden");
  UI.$("#meta-file-size").textContent = `${(UI.currentRecordingBlob.size / 1024 / 1024).toFixed(2)} MB`;
  UI.$("#metadata-screen").showModal();
}

export function handleMetadataClassChange(e) {
  const classId = e.target.value;
  const participantSelect = UI.$("#meta-participant");
  participantSelect.innerHTML = '<option value="">Select a participant...</option>';
  if (!classId || !UI.classData[classId]) {
    participantSelect.disabled = true;
    return;
  }
  const participants = UI.classData[classId].participants || [];
  participants.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    participantSelect.appendChild(opt);
  });
  const addNewOpt = document.createElement("option");
  addNewOpt.value = "--ADD_NEW--";
  addNewOpt.textContent = "-- Add New Participant --";
  participantSelect.appendChild(addNewOpt);
  participantSelect.disabled = false;
}

export function handleMetadataParticipantChange(e) {
  const selected = e.target.value;
  UI.$("#add-participant-container").classList.toggle("hidden", selected !== "--ADD_NEW--");
}

export async function handleAddNewParticipant() {
  const classId = UI.$("#meta-class").value;
  const newName = UI.$("#new-participant-name").value.trim();
  if (!classId || !newName) {
    UI.toast("Enter a name.", "error");
    return;
  }
  const currentParticipants = UI.classData[classId].participants || [];
  if (!currentParticipants.includes(newName)) {
      currentParticipants.push(newName);
      const classRef = doc(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/classes`, classId);
      await updateDoc(classRef, { participants: currentParticipants });
      UI.classData[classId].participants = currentParticipants;
      UI.toast(`Added ${newName}!`, "success");
  }
  const opt = document.createElement("option");
  opt.value = newName;
  opt.textContent = newName;
  UI.$("#meta-participant").insertBefore(opt, UI.$("#meta-participant").lastElementChild);
  UI.$("#meta-participant").value = newName;
  UI.$("#add-participant-container").classList.add("hidden");
}

export async function exportToLocal(metadata) {
  try {
    const blob = UI.currentRecordingBlob;
    if (!blob) {
      UI.toast("No recording available to export.", "error");
      return;
    }
    const safeClass = (metadata.classEventTitle || "presentation").replace(/[^\w\d-_]+/g, "_").trim();
    const safeParticipant = (metadata.participant || "student").replace(/[^\w\d-_]+/g, "_").trim();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${safeClass}_${safeParticipant}_${timestamp}.webm`;

    let savedViaPicker = false;
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'WebM Video', accept: { 'video/webm': ['.webm'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        savedViaPicker = true;
      } catch (err) {
        if (err.name === 'AbortError') { UI.toast("Save cancelled.", "info"); return; }
        console.warn("Picker failed, using fallback:", err);
      }
    }
    if (!savedViaPicker) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    UI.toast("Saved to local device!", "success");
    metadata.storagePath = "local";
    metadata.downloadURL = null;
    metadata.savedAs = fileName;
    metadata.isLocal = true;
    await uploadFile(null, metadata); 
    stopPreview();
    const previewScreen = UI.$("#preview-screen");
    if (previewScreen) previewScreen.classList.add("hidden");
    const manualPreviewBtn = UI.$("#manual-preview-btn");
    if(manualPreviewBtn) manualPreviewBtn.textContent = "Start Preview";
    UI.setRecordedChunks([]);
    UI.setCurrentRecordingBlob(null);
    UI.updateRecordingUI("idle");
    clearTagList();
    renderLiveScoringFromRubric({}, "live");
    if (UI.timerInterval) clearInterval(UI.timerInterval);
    UI.setSecondsElapsed(0);
    UI.$("#rec-timer").textContent = "00:00";
    const manageTabBtn = document.querySelector('[data-tab="tab-manage"]');
    if (manageTabBtn) manageTabBtn.click();
  } catch (err) {
    console.error("Local export error:", err);
    UI.toast(`Export failed: ${err.message}`, "error");
  }
}

export async function handleMetadataSubmit(e) {
  e.preventDefault();
  if (!UI.currentRecordingBlob) {
    UI.toast("No recording to save.", "error");
    return;
  }
  const metaClassEl = UI.$("#meta-class");
  const selectedClassText = metaClassEl.options[metaClassEl.selectedIndex]?.text || "N/A";
  const activeRubric = Rubrics.getActiveRubric();
  if (!activeRubric) UI.toast("Warning: No rubric selected.", "info");

  const noteElements = document.querySelectorAll('[data-note-row-id]');
  const capturedNotes = {};
  noteElements.forEach(el => {
      if (el.value.trim()) capturedNotes[el.dataset.noteRowId] = el.value.trim();
  });

  const finalScores = {};
  let totalScore = 0;
  latestRowScores.forEach((score, rowId) => {
      finalScores[rowId] = score;
      totalScore += score;
  });
  
  const metadata = {
    organization: UI.$("#meta-org").value,
    instructor: UI.$("#meta-instructor").value,
    classEventId: UI.$("#meta-class").value,
    classEventTitle: selectedClassText,
    participant: UI.$("#meta-participant").value,
    recordingType: UI.$("#meta-type").value,
    group: UI.$("#meta-group").value.trim() || null,
    notes: UI.$("#meta-notes").value.trim() || null,
    fileSize: UI.currentRecordingBlob.size,
    duration: UI.secondsElapsed,
    recordedAt: new Date().toISOString(),
    tags: currentTags,
    hasScore: true, 
    rubricId: activeRubric ? activeRubric.id : null,
    rubricTitle: activeRubric ? activeRubric.title : null,
    scoreEvents: liveScores,      
    finalScores: finalScores,     
    totalScore: totalScore,       
    rowNotes: capturedNotes       
  };

  if (!metadata.classEventId || !metadata.participant) {
    UI.toast("Please select a class and participant.", "error");
    return;
  }

  UI.$("#metadata-screen").close();
  UI.toast("Saving… please wait", "info");

  const storageChoice = UI.getStorageChoice(); 
  if (storageChoice === "local") {
    await exportToLocal(metadata);
  } else if (storageChoice === "gdrive") {
    UI.uploadToDrivePlaceholder(UI.currentRecordingBlob, metadata);
  } else if (storageChoice === "firebase") {
    await uploadFile(UI.currentRecordingBlob, metadata);
    UI.toast("Uploaded to cloud successfully!", "success");
    stopPreview();
    const manageTabBtn = document.querySelector('[data-tab="tab-manage"]');
    if (manageTabBtn) manageTabBtn.click();
  }
}