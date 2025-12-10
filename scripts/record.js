/* ========================================================================== */
/* MODULE: record.js                                                          */
/* Live preview + live scoring + MediaRecorder + metadata + multi-storage     */
/* ========================================================================== */

import * as UI from "./ui.js";
import { uploadFile } from "./firestore.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* ========================================================================== */
/* LOCAL STATE                                                                */
/* ========================================================================== */

// Tags during a recording
let currentTags = [];           // [{ time, note }]

// Live scoring during a recording
let liveScores = [];            // [{ rowId, score, timestamp }]
const latestRowScores = new Map(); // rowId -> last score selected

/* ========================================================================== */
/* TAGS – TIMELINE HELPERS                                                    */
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
  li.className = "text-xs text-gray-300";
  li.textContent = `Tag at ${new Date(timeSeconds * 1000)
    .toISOString()
    .substr(14, 5)}`;
  list.appendChild(li);
}

/* -------------------------------------------------------------------------- */
/* Live Tag Button (wired from main.js)                                       */
/* -------------------------------------------------------------------------- */

export function handleTagButtonClick() {
  if (!UI.mediaRecorder || UI.mediaRecorder.state !== "recording") {
    UI.toast("Cannot tag — not currently recording.", "warn");
    return;
  }

  const time = UI.secondsElapsed;
  console.log(`🎯 Tag added at ${time}s`);
  UI.toast(`Tag at ${time}s`, "info");

  currentTags.push({ time, note: `Tag at ${time}s` });
  appendTagToTimeline(time);
}

/* ========================================================================== */
/* LIVE SCORING UI (RIGHT SIDE OF SPLIT SCREEN)                               */
/* ========================================================================== */

function resetLiveScoringUI() {
  liveScores = [];
  latestRowScores.clear();

  const rowsContainer = UI.$("#live-scoring-rows");
  if (rowsContainer) rowsContainer.innerHTML = "";

  const totalEl = UI.$("#live-score-total");
  if (totalEl) totalEl.textContent = "0";
}

function renderLiveScoringFromRubric() {
  const rowsContainer = UI.$("#live-scoring-rows");
  if (!rowsContainer) {
    console.warn("[record.js] #live-scoring-rows not found in DOM.");
    return;
  }

  resetLiveScoringUI();

  const rubric = UI.getActiveRubric ? UI.getActiveRubric() : null;

  if (!rubric || !Array.isArray(rubric.rows) || rubric.rows.length === 0) {
    rowsContainer.innerHTML = `
      <p class="text-xs text-gray-400">
        No active rubric selected. Choose one under the Rubrics tab.
      </p>
    `;
    return;
  }

  // Optional rubric title display
  const titleEl = UI.$("#live-scoring-rubric-title");
  if (titleEl) titleEl.textContent = rubric.title || "Active Rubric";

  rubric.rows.forEach((row, idx) => {
    const rowId = row.id || row.rowId || `row-${idx}`;
    let allowed = Array.isArray(row.allowedScores) && row.allowedScores.length
      ? row.allowedScores.slice().sort((a, b) => a - b)
      : null;

    if (!allowed) {
      // Fallback: 0..maxPoints or 0..6
      const max = typeof row.maxPoints === "number" && row.maxPoints > 0
        ? row.maxPoints
        : 6;
      allowed = [];
      for (let n = 0; n <= max; n++) allowed.push(n);
    }

    const wrapper = document.createElement("div");
    wrapper.className = "live-score-row border border-white/10 rounded-lg p-2 mb-2";
    wrapper.dataset.rowId = rowId;

    const label = row.label || row.title || `Row ${idx + 1}`;

    wrapper.innerHTML = `
      <div class="flex justify-between items-baseline mb-1">
        <div class="text-xs font-semibold text-white">
          ${idx + 1}. ${label}
        </div>
        <div class="text-[10px] text-gray-400">
          Allowed: ${allowed.join(", ")}
        </div>
      </div>
      <div class="flex flex-wrap gap-1">
        ${allowed
          .map(
            (score) => `
          <button type="button"
            class="live-score-btn px-2 py-1 rounded-lg text-xs bg-white/10 text-gray-200 border border-white/10"
            data-row-id="${rowId}"
            data-score="${score}">
            ${score}
          </button>
        `
          )
          .join("")}
      </div>
    `;

    rowsContainer.appendChild(wrapper);
  });

  // Attach handlers
  rowsContainer.querySelectorAll(".live-score-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rowId = btn.dataset.rowId;
      const score = Number(btn.dataset.score);
      handleLiveScoreClick(rowId, score, btn);
    });
  });
}

function handleLiveScoreClick(rowId, score, btn) {
  const rowEl = btn.closest(".live-score-row");
  if (!rowEl) return;

  const isRecording =
    UI.mediaRecorder &&
    (UI.mediaRecorder.state === "recording" ||
      UI.mediaRecorder.state === "paused");

  // Update button styles for this row (single selection highlight)
  rowEl.querySelectorAll(".live-score-btn").forEach((b) => {
    b.classList.remove("bg-primary-600", "text-white");
    b.classList.add("bg-white/10", "text-gray-200");
  });

  btn.classList.remove("bg-white/10", "text-gray-200");
  btn.classList.add("bg-primary-600", "text-white");

  // Track latest score for this row for totals
  latestRowScores.set(rowId, score);
  updateLiveScoreTotal();

  if (!isRecording) {
    UI.toast("Score set (not recording yet).", "info");
    return;
  }

  const ts = UI.secondsElapsed || 0;
  liveScores.push({ rowId, score, timestamp: ts });

  UI.toast(`Scored ${score} on ${rowId} at ${ts}s`, "success");
}

function updateLiveScoreTotal() {
  const totalEl = UI.$("#live-score-total");
  if (!totalEl) return;

  let total = 0;
  for (const val of latestRowScores.values()) {
    total += Number(val) || 0;
  }
  totalEl.textContent = String(total);
}

// module-level lock (required because UI is not extensible)
let previewLock = false;

/* ========================================================================== */
/* PREVIEW – START CAMERA + SHOW SPLIT SCREEN                                 */
/* ========================================================================== */
export async function startPreviewSafely() {

  // SAFETY 1 — Only run if Record tab is active
  const recordTab = UI.$("[data-tab='tab-record']");
  if (!recordTab || recordTab.classList.contains("hidden")) {
    console.log("[Preview] Blocked: Record tab not visible yet.");
    return;
  }

  // SAFETY 2 — Prevent double execution (Chromebook bug)
  if (previewLock) {
    console.log("[Preview] Blocked: preview lock active");
    return;
  }
  previewLock = true;
  setTimeout(() => (previewLock = false), 300);

  // SAFETY 3 — Subscription check
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

  // Mobile autoplay safety
  previewVideo.muted = true;
  previewVideo.playsInline = true;

  // Reset old stream
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
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: UI.currentFacingMode
      },
      audio: true
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    UI.setMediaStream(stream);

    previewVideo.srcObject = stream;

    // Mute preview only (still records audio)
    stream.getAudioTracks().forEach(t => (t.enabled = false));

    await previewVideo.play().catch(err =>
      console.warn("Autoplay blocked until user gesture", err)
    );

    previewScreen.classList.remove("hidden");

    renderLiveScoringFromRubric();

    UI.toast("🎥 Preview active.", "info");
  }
  catch (err) {
    console.error("Camera error:", err);
    UI.toast("Camera or microphone access denied.", "error");
  }
}
/* ========================================================================== */
/* PREVIEW – STOP CAMERA + HIDE SPLIT SCREEN                                  */
/* ========================================================================== */
export function stopPreview() {
  const previewVideo = UI.$("#preview-player");
  const previewScreen = UI.$("#preview-screen");

  // No elements? Stop here.
  if (!previewVideo || !previewScreen) return;

  console.log("[Preview] Stopping preview…");

  // Stop camera stream if active
  if (UI.mediaStream) {
    UI.mediaStream.getTracks().forEach(t => t.stop());
    UI.setMediaStream(null);
  }

  // Reset video element
  try {
    previewVideo.pause();
  } catch {}
  previewVideo.removeAttribute("src");
  previewVideo.src = "";
  previewVideo.srcObject = null;

  // Hide the entire preview box
  previewScreen.classList.add("hidden");

  UI.toast("Preview stopped.", "info");
}

/* ========================================================================== */
/* RECORDING FLOW                                                             */
/* ========================================================================== */

export async function startRecording() {
  if (!UI.hasAccess()) {
    UI.toast("Recording disabled without an active subscription.", "error");
    return;
  }

  if (!UI.mediaStream) {
    console.log("No preview stream, starting stream first.");
    await startPreviewSafely();
    if (!UI.mediaStream) {
      console.error("Failed to get media stream for recording.");
      return;
    }
  }

  console.log("Attempting to start recording...");
  UI.updateRecordingUI("recording");
  UI.setRecordedChunks([]);
  UI.setCurrentRecordingBlob(null);
  clearTagList();
  resetLiveScoringUI(); // New recording → fresh scoring state

  try {
    // Enable audio for recording
    UI.mediaStream.getAudioTracks().forEach((track) => (track.enabled = true));

    let mime = "video/webm;codecs=vp9,opus";
    if (!MediaRecorder.isTypeSupported(mime)) mime = "video/webm;codecs=vp8,opus";
    if (!MediaRecorder.isTypeSupported(mime)) mime = "video/webm";

    let recorder;
    try {
      recorder = new MediaRecorder(UI.mediaStream, { mimeType: mime });
    } catch (e) {
      console.warn("MIME negotiation failed, using default.", e);
      recorder = new MediaRecorder(UI.mediaStream);
    }
    UI.setMediaRecorder(recorder);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) UI.recordedChunks.push(e.data);
    };

    recorder.onstop = () => {
      console.log("Recording stopped, chunks:", UI.recordedChunks.length);
      if (UI.mediaStream) {
        UI.mediaStream.getTracks().forEach((track) => track.stop());
        UI.setMediaStream(null);
      }

      const previewVideo = UI.$("#preview-player");
      if (previewVideo) previewVideo.srcObject = null;

      if (UI.recordedChunks.length > 0) {
        const blob = new Blob(UI.recordedChunks, {
          type: recorder.mimeType || "video/webm",
        });
        UI.setCurrentRecordingBlob(blob);
        openMetadataScreen();
      } else {
        console.warn("No data recorded.");
        UI.updateRecordingUI("idle");
        startPreviewSafely();
      }
      UI.setRecordedChunks([]);
    };

    recorder.start(1000);

    UI.setSecondsElapsed(0);
    if (UI.timerInterval) clearInterval(UI.timerInterval);
    UI.$("#rec-timer").textContent = "00:00";
    UI.setTimerInterval(
      setInterval(() => {
        UI.setSecondsElapsed(UI.secondsElapsed + 1);
        UI.$("#rec-timer").textContent = new Date(UI.secondsElapsed * 1000)
          .toISOString()
          .substr(14, 5);
      }, 1000)
    );

    UI.toast("Recording started!", "success");
  } catch (err) {
    console.error("Failed to start recording:", err);
    UI.toast(`Error: ${err.message}`, "error");
    if (UI.mediaStream) UI.mediaStream.getTracks().forEach((track) => track.stop());
    UI.setMediaStream(null);
    UI.updateRecordingUI("idle");
  }
}

export function pauseOrResumeRecording() {
  if (!UI.mediaRecorder) return;

  if (UI.mediaRecorder.state === "recording") {
    UI.mediaRecorder.pause();
    if (UI.timerInterval) clearInterval(UI.timerInterval);
    UI.updateRecordingUI("paused");
    UI.toast("Recording paused", "info");
  } else if (UI.mediaRecorder.state === "paused") {
    UI.mediaRecorder.resume();
    UI.setTimerInterval(
      setInterval(() => {
        UI.setSecondsElapsed(UI.secondsElapsed + 1);
        UI.$("#rec-timer").textContent = new Date(UI.secondsElapsed * 1000)
          .toISOString()
          .substr(14, 5);
      }, 1000)
    );
    UI.updateRecordingUI("recording");
    UI.toast("Recording resumed", "info");
  }
}

export function stopRecording() {
  if (UI.secondsElapsed < 1) {
    UI.toast("Recording must be at least 1 second long.", "error");
    return;
  }

  if (
    UI.mediaRecorder &&
    (UI.mediaRecorder.state === "recording" ||
      UI.mediaRecorder.state === "paused")
  ) {
    UI.mediaRecorder.stop();
    if (UI.timerInterval) clearInterval(UI.timerInterval);
    UI.updateRecordingUI("stopped");
  }
}

export async function discardRecording() {
  if (
    UI.mediaRecorder &&
    (UI.mediaRecorder.state === "recording" ||
      UI.mediaRecorder.state === "paused")
  ) {
    const confirmed = await UI.showConfirm(
      "Are you sure you want to discard this recording and start over?",
      "Discard Recording?",
      "Discard"
    );

    if (confirmed) {
      console.log("Discarding active recording...");
      UI.mediaRecorder.onstop = null;
      UI.mediaRecorder.stop();
      UI.setMediaRecorder(null);
      UI.toast("Recording discarded.", "warn");
    } else {
      return;
    }
  }

  console.log("Resetting recorder UI.");
  if (UI.mediaStream) {
    UI.mediaStream.getTracks().forEach((track) => track.stop());
    UI.setMediaStream(null);
  }

  const previewVideo = UI.$("#preview-player");
  if (previewVideo) previewVideo.srcObject = null;

  UI.setRecordedChunks([]);
  UI.setCurrentRecordingBlob(null);
  if (UI.timerInterval) clearInterval(UI.timerInterval);
  UI.setSecondsElapsed(0);
  UI.$("#rec-timer").textContent = "00:00";
  UI.updateRecordingUI("idle");
  clearTagList();
  resetLiveScoringUI();

  startPreviewSafely();
}

export async function toggleCamera() {
  UI.setCurrentFacingMode(
    UI.currentFacingMode === "user" ? "environment" : "user"
  );
  UI.toast(
    `Switched to ${UI.currentFacingMode === "user" ? "front" : "back"} camera.`,
    "info"
  );

  if (!UI.mediaRecorder || UI.mediaRecorder.state === "inactive") {
    await startPreviewSafely();
  }
}

/* ========================================================================== */
/* METADATA + PARTICIPANTS + UPLOAD (INCLUDING LOCAL / USB)                   */
/* ========================================================================== */

function openMetadataScreen() {
  if (!UI.currentRecordingBlob) {
    UI.toast("No recording to tag.", "error");
    return;
  }

  UI.$("#metadata-form").reset();

  UI.$("#meta-org").value = UI.userDoc.organizationName || "Default Org";
  UI.$("#meta-instructor").value =
    UI.userDoc.instructorName ||
    (UI.currentUser ? UI.currentUser.email : "Instructor");

  UI.refreshMetadataClassList();
  UI.$("#meta-class").value = "";
  UI.$("#meta-participant").innerHTML =
    '<option value="">Select a class/event first...</option>';
  UI.$("#meta-participant").disabled = true;
  UI.$("#add-participant-container").classList.add("hidden");

  UI.$("#meta-file-size").textContent = `${(
    UI.currentRecordingBlob.size /
    1024 /
    1024
  ).toFixed(2)} MB`;

  UI.$("#metadata-screen").showModal();
}

export function handleMetadataClassChange(e) {
  const classId = e.target.value;
  const participantSelect = UI.$("#meta-participant");

  participantSelect.innerHTML =
    '<option value="">Select a participant...</option>';

  if (!classId || !UI.classData[classId]) {
    participantSelect.disabled = true;
    participantSelect.innerHTML =
      '<option value="">Select a class/event first...</option>';
    return;
  }

  const participants = UI.classData[classId].participants || [];

  if (participants.length === 0) {
    participantSelect.innerHTML =
      '<option value="">No participants in this class</option>';
  } else {
    participants.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      participantSelect.appendChild(opt);
    });
  }

  const addNewOpt = document.createElement("option");
  addNewOpt.value = "--ADD_NEW--";
  addNewOpt.textContent = "-- Add New Participant --";
  participantSelect.appendChild(addNewOpt);

  participantSelect.disabled = false;
}

export function handleMetadataParticipantChange(e) {
  const selected = e.target.value;
  UI.$("#add-participant-container").classList.toggle(
    "hidden",
    selected !== "--ADD_NEW--"
  );
}

export async function handleAddNewParticipant() {
  const classId = UI.$("#meta-class").value;
  const newName = UI.$("#new-participant-name").value.trim();

  if (!classId || !newName) {
    UI.toast("Select a class and enter a name.", "error");
    return;
  }

  if (!UI.classData[classId]) {
    UI.toast("Error: Class data not found.", "error");
    return;
  }

  const currentParticipants = UI.classData[classId].participants || [];

  if (currentParticipants.includes(newName)) {
    UI.toast("Participant already exists in this roster.", "warn");
  } else {
    currentParticipants.push(newName);
    UI.classData[classId].participants = currentParticipants;

    try {
      const classRef = doc(
        UI.db,
        `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/classes`,
        classId
      );
      await updateDoc(classRef, { participants: currentParticipants });
      UI.toast(`Added ${newName} to class!`, "success");
      UI.classData[classId].participants = currentParticipants;
    } catch (e) {
      console.error("Failed to add new participant:", e);
      UI.toast("Error saving new participant.", "error");
    }
  }

  handleMetadataClassChange({ target: { value: classId } });
  UI.$("#meta-participant").value = newName;
  UI.$("#add-participant-container").classList.add("hidden");
  UI.$("#new-participant-name").value = "";
}

export async function handleMetadataSubmit(e) {
  e.preventDefault();
  if (!UI.currentRecordingBlob) {
    UI.toast("No recording to save.", "error");
    return;
  }

  const metaClassEl = UI.$("#meta-class");
  const selectedClassText =
    metaClassEl.options[metaClassEl.selectedIndex]?.text || "N/A";

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
    scores: liveScores,
  };

  // BASIC VALIDATION
  if (
    !metadata.classEventId ||
    metadata.participant === "--ADD_NEW--" ||
    !metadata.participant
  ) {
    UI.toast("Please select a class and a valid participant.", "error");
    return;
  }

  // Close dialog immediately (good UX)
  UI.$("#metadata-screen").close();
  UI.toast("Uploading… please wait", "info");

  const storageChoice = UI.getStorageChoice(); // firebase | gdrive | local

  try {
    // ----------------------------
    // LOCAL SAVE
    // ----------------------------
    if (storageChoice === "local") {
      const filename = `${Date.now()}_${metadata.participant}.webm`;

      const saved = await UI.saveToLocalDevice(UI.currentRecordingBlob, filename);

      if (saved) {
        metadata.storagePath = "local";
        metadata.downloadURL = null;
        metadata.savedAs = filename;
        metadata.isLocal = true;

        await uploadFile(null, metadata); // metadata-only doc

        UI.toast("Saved to device & metadata stored!", "success");
      } else {
        UI.toast("Save cancelled. Video kept in memory.", "warn");
        return;
      }
    }

    // ----------------------------
    // GOOGLE DRIVE
    // ----------------------------
    else if (storageChoice === "gdrive") {
      UI.uploadToDrivePlaceholder(UI.currentRecordingBlob, metadata);
    }

    // ----------------------------
    // FIREBASE
    // ----------------------------
    else if (storageChoice === "firebase") {
    try {
        await uploadFile(UI.currentRecordingBlob, metadata);
        UI.toast("Uploaded to cloud successfully!", "success");
    } catch (err) {
        console.error("Cloud upload error:", err);
        UI.toast("Failed to upload to cloud.", "error");
        return;
    }
}


    // Cleanup AFTER upload finishes
    UI.setCurrentRecordingBlob(null);
    UI.setSecondsElapsed(0);
    UI.$("#rec-timer").textContent = "00:00";
    UI.updateRecordingUI("idle");
    clearTagList();
    resetLiveScoringUI();

  } catch (err) {
    console.error("Upload error:", err);
    UI.toast("Upload failed — video kept in memory.", "error");
  }
}
