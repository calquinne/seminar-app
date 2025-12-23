/* ========================================================================== */
/* MODULE: record.js
/* Exports all MediaRecorder, Preview, and Metadata/Scoring logic.
/* ========================================================================== */

import * as UI from "./ui.js";
import { uploadFile } from "./firestore.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import * as Rubrics from "./rubrics.js"; 

// ✅ LOCAL STATE
let currentTags = [];
let liveScores = []; // The timeline of clicks (events)
const latestRowScores = new Map(); // The current "winning" score for each row
let previewLock = false; // Prevents double-taps on Chromebooks

/* -------------------------------------------------------------------------- */
/* Helper Functions
/* -------------------------------------------------------------------------- */

function clearTagList() {
  const list = UI.$("#tag-list");
  if (list) list.innerHTML = "";
  currentTags = [];
}

function resetLiveScoringUI() {
  liveScores = [];
  latestRowScores.clear();
  const rowsContainer = UI.$("#live-scoring-rows");
  if (rowsContainer) rowsContainer.innerHTML = "";
  const totalEl = UI.$("#live-score-total");
  if (totalEl) totalEl.textContent = "0";
}

function appendTagToTimeline(timeSeconds) {
  const list = UI.$("#tag-list");
  if (!list) return;
  const li = document.createElement("div");
  li.className = "text-xs text-gray-300 border-l-2 border-gray-600 pl-2 mb-1";
  li.textContent = `Tag at ${new Date(timeSeconds * 1000).toISOString().substr(14, 5)}`;
  list.appendChild(li);
}

/* ========================================================================== */
/* ✅ LIVE SCORING UI (CUSTOM SCORES + TOOLTIPS)
/* ========================================================================== */

// Inject styles for tooltips once
const styleId = "rubric-tooltip-styles";
if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        .score-btn-wrapper {
            position: relative;
            display: inline-block;
            /* overflow: visible is critical so tooltip isn't clipped by button box */
            overflow: visible; 
        }

        .rubric-tooltip {
            visibility: hidden;
            position: absolute;
            z-index: 9999; /* Ensure on top of everything */

            bottom: calc(100% + 8px); /* 8px gap above button */
            left: 0; /* Anchor left edge to button */
            
            /* Sizing & Layout */
            width: max-content;
            max-width: 300px;       /* Allow wider balloons */
            min-width: 150px;
            white-space: normal;    /* Allow text wrapping */
            text-align: left;
            line-height: 1.4;

            /* Visuals */
            background-color: #0f172a; /* Dark slate */
            color: #e5e7eb;
            font-size: 11px;
            border-radius: 6px;
            padding: 8px 12px;
            
            /* Fade transition */
            opacity: 0;
            transition: opacity 0.15s ease-in-out;

            pointer-events: none; /* Let clicks pass through */
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(0, 0, 0, 0.6);
            border: 1px solid rgba(255,255,255,0.1);
        }

        /* Triangle Arrow */
        .rubric-tooltip::after {
            content: "";
            position: absolute;
            top: 100%;
            left: 12px; /* Align arrow with button center roughly */
            border-width: 6px;
            border-style: solid;
            border-color: #0f172a transparent transparent transparent;
        }

        /* Hover State */
        .score-btn-wrapper:hover .rubric-tooltip {
            visibility: visible;
            opacity: 1;
        }
    `;

    document.head.appendChild(style);
}


export function renderLiveScoringFromRubric(existingScores = {}) {
  const rowsContainer = UI.$("#live-scoring-rows");
  if (!rowsContainer) return;

  resetLiveScoringUI();

  const rubric = Rubrics.getActiveRubric();

  if (!rubric || !rubric.rows || rubric.rows.length === 0) {
      rowsContainer.innerHTML = `
        <div class="p-4 bg-white/5 rounded-lg border border-white/10 text-center">
            <p class="text-sm text-gray-400 mb-2">No rubric selected.</p>
            <button onclick="document.querySelector('[data-tab=tab-rubrics]').click()" 
                    class="text-xs bg-primary-600 hover:bg-primary-500 text-white px-3 py-1.5 rounded">
                Go to Rubrics Tab
            </button>
        </div>`;
      return;
  }

  // Set Title
  const titleEl = UI.$("#live-scoring-rubric-title");
  if(titleEl) titleEl.textContent = rubric.title;

  let initialTotal = 0;

  rubric.rows.forEach((row, index) => {
      // Data Load
      const savedData = existingScores[row.id] || {};
      const savedScore = savedData.score !== undefined ? savedData.score : null;
      const savedNote = savedData.note || "";

      if (savedScore !== null) {
          latestRowScores.set(row.id, Number(savedScore));
          initialTotal += Number(savedScore);
      }

      const rowEl = document.createElement("div");
      rowEl.className = "mb-5 pb-4 border-b border-white/10 last:border-0 live-score-row overflow-visible";

      // 1. Header
      let html = `
        <div class="flex justify-between items-end mb-2">
          <span class="text-sm font-medium text-white">
            <span class="text-primary-400 mr-1">${index + 1}.</span> ${row.label}
          </span>
        </div>
        <div class="flex flex-wrap gap-1 mb-2">
      `;

      // 2. Buttons (From allowedScores)
      // Fallback for legacy rubrics: 0..maxPoints
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
          
          const classes = isActive 
            ? "bg-primary-600 text-white border-primary-400 scale-110 font-bold shadow-md" 
            : "bg-white/10 text-gray-300 hover:bg-white/20 border-transparent";

          html += `
            <div class="score-btn-wrapper">
                <button
                    type="button"
                    class="live-score-btn w-8 h-8 text-xs rounded transition-all border focus:outline-none ${classes}"
                    data-score="${val}"
                    data-row-id="${row.id}"
                >
                    ${val}
                </button>
                ${label ? `<span class="rubric-tooltip">${label}</span>` : ''}
            </div>
          `;
      });

      html += `</div>`;

      // 3. Notes
      html += `
        <textarea
          class="w-full bg-black/20 border border-white/10 rounded p-2 text-xs text-gray-300 focus:border-primary-500 focus:outline-none resize-none placeholder-gray-600"
          rows="1"
          placeholder="Add a note for ${row.label}..."
          data-note-row-id="${row.id}"
        >${savedNote}</textarea>
      `;

      rowEl.innerHTML = html;
      rowsContainer.appendChild(rowEl);
  });

  // Attach Listeners
  rowsContainer.querySelectorAll(".live-score-btn").forEach((btn) => {
    btn.onclick = () => {
      const rowId = btn.dataset.rowId;
      const score = Number(btn.dataset.score);
      handleLiveScore(rowId, score, btn);
    };
  });

  // Initialize total
  const totalEl = UI.$("#live-score-total");
  if (totalEl) totalEl.textContent = initialTotal;
}

function handleLiveScore(rowId, score, btnElement) {
    // Navigate up to the container div (wrapper's parent)
    const container = btnElement.closest('.flex'); 
    
    // 1. Visual Update
    const allBtns = container.querySelectorAll("button");
    allBtns.forEach(b => {
        b.className = "live-score-btn w-8 h-8 text-xs rounded transition-all border focus:outline-none bg-white/10 text-gray-300 hover:bg-white/20 border-transparent";
    });
    
    btnElement.className = "live-score-btn w-8 h-8 text-xs rounded transition-all border focus:outline-none bg-primary-600 text-white border-primary-400 scale-110 font-bold shadow-md";
    
    // 2. Record Event (if recording)
    if (UI.mediaRecorder && (UI.mediaRecorder.state === 'recording' || UI.mediaRecorder.state === 'paused')) {
        const timestamp = UI.secondsElapsed;
        liveScores.push({ rowId, score, timestamp });
        UI.toast(`Scored ${score} pts`, "success");
    }
    
    // 3. Update Live Total
    latestRowScores.set(rowId, score);
    let total = 0;
    latestRowScores.forEach(val => total += val);
    
    const totalEl = UI.$("#live-score-total");
    if(totalEl) {
        totalEl.style.transform = "scale(1.2)";
        totalEl.textContent = total;
        setTimeout(() => totalEl.style.transform = "scale(1)", 200);
    }
}

/* ========================================================================== */
/* CORE: PREVIEW & RECORDING
/* ========================================================================== */

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

// ✅ EXPORTED as "startPreviewSafely"
export async function startPreviewSafely() {
  const recordTab = UI.$("[data-tab='tab-record']");
  if (!recordTab || recordTab.classList.contains("hidden")) {
    console.log("[Preview] Blocked: Record tab not visible yet.");
    return;
  }

  if (previewLock) {
    console.log("[Preview] Blocked: preview lock active");
    return;
  }
  previewLock = true;
  setTimeout(() => (previewLock = false), 300);

  if (!UI.hasAccess()) {
    UI.toast("Recording disabled without an active subscription.", "error");
    return;
  }

  const previewVideo = UI.$("#preview-player");
  const previewScreen = UI.$("#preview-screen");

  if (!previewVideo || !previewScreen) {
    console.error("[Preview] Missing preview DOM elements.");
    return;
  }

  previewScreen.classList.remove("recording-active");
  previewVideo.muted = true;
  previewVideo.playsInline = true;

  if (UI.mediaStream) {
    UI.mediaStream.getTracks().forEach(t => t.stop());
    UI.setMediaStream(null);
  }

  console.log("Initializing camera preview...");
  UI.updateRecordingUI("idle");
  UI.setRecordedChunks([]);
  UI.setCurrentRecordingBlob(null);
  clearTagList();
  resetLiveScoringUI();

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
    renderLiveScoringFromRubric(); 

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
    if (previewVideo) {
        previewVideo.srcObject = null;
    }
    if (previewScreen) {
        previewScreen.classList.add("hidden");
    }
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

  console.log("Starting recording...");
  UI.updateRecordingUI("recording");
  UI.setRecordedChunks([]);
  UI.setCurrentRecordingBlob(null);
  clearTagList();
  
  resetLiveScoringUI(); 
  renderLiveScoringFromRubric();

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
      console.log("Recording stopped.");
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
  resetLiveScoringUI();
  
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

/* -------------------------------------------------------------------------- */
/* Metadata & Upload Logic
/* -------------------------------------------------------------------------- */

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

    const safeClass = (metadata.classEventTitle || "presentation")
      .replace(/[^\w\d-_]+/g, "_")
      .replace(/^_+|_+$/g, "") 
      .trim();

    const safeParticipant = (metadata.participant || "student")
      .replace(/[^\w\d-_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .trim();

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${safeClass}_${safeParticipant}_${timestamp}.webm`;

    let savedViaPicker = false;

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: 'WebM Video',
            accept: { 'video/webm': ['.webm'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        savedViaPicker = true;
      } catch (err) {
        if (err.name === 'AbortError') {
          UI.toast("Save cancelled.", "info");
          return; 
        }
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
    resetLiveScoringUI();

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

  if (!activeRubric) {
    UI.toast("Warning: No rubric selected. Scoring data will be empty.", "info");
  }

  const noteElements = document.querySelectorAll('[data-note-row-id]');
  const capturedNotes = {};
  noteElements.forEach(el => {
      if (el.value.trim()) {
          capturedNotes[el.dataset.noteRowId] = el.value.trim();
      }
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
    
    // ✅ SAVE FULL SCORING DATA
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
  }
  else if (storageChoice === "gdrive") {
    UI.uploadToDrivePlaceholder(UI.currentRecordingBlob, metadata);
  }
  else if (storageChoice === "firebase") {
    await uploadFile(UI.currentRecordingBlob, metadata);
    UI.toast("Uploaded to cloud successfully!", "success");
    stopPreview();
    const manageTabBtn = document.querySelector('[data-tab="tab-manage"]');
    if (manageTabBtn) manageTabBtn.click();
  }
}