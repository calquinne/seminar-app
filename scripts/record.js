/* ========================================================================== */
/* MODULE: record.js
/* Exports all MediaRecorder and metadata tagging logic.
/* ========================================================================== */

// Import UI module for state and utils
import * as UI from './ui.js';
// Import Firestore module for db operations
import { uploadFile } from './firestore.js';
// Import Firebase SDK for specific needs
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* -------------------------------------------------------------------------- */
/* Recording Flow
/* -------------------------------------------------------------------------- */
export async function startPreview() {
  if (!UI.hasAccess()) {
    UI.toast("Recording disabled without an active subscription.", "error");
    return;
  }
  
  if (UI.mediaStream) {
    UI.mediaStream.getTracks().forEach(track => track.stop());
  }
  console.log("Initializing camera preview...");
  UI.updateRecordingUI('idle');
  UI.setRecordedChunks([]);
  UI.setCurrentRecordingBlob(null);
  if(UI.timerInterval) clearInterval(UI.timerInterval);
  UI.setSecondsElapsed(0);
  UI.$("#rec-timer").textContent = "00:00";
  
  const progressEl = UI.$("#upload-progress");
  if (progressEl) progressEl.style.width = '0%';

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        UI.toast("Media devices not supported on this browser.", "error");
        return;
    }
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
    UI.$("#video-preview").srcObject = stream;
    UI.$("#video-preview").muted = true;
    
    UI.mediaStream.getAudioTracks().forEach(track => track.enabled = false);
    UI.toast("🎤 Audio is being recorded but muted in preview.", "info");

  } catch (permErr) {
    console.error("Permission error:", permErr);
    if (permErr.name === "NotAllowedError" || permErr.name === "PermissionDeniedError") {
      UI.toast("You must allow access to your camera and microphone.", "error");
    } else {
      UI.toast(`Could not access media devices: ${permErr.name}.`, "error");
    }
  }
}

export async function startRecording() {
  if (!UI.hasAccess()) {
    UI.toast("Recording disabled without an active subscription.", "error");
    return;
  }
  
  if (!UI.mediaStream) {
    console.log("No preview stream, starting stream first.");
    await startPreview();
    if (!UI.mediaStream) {
      console.error("Failed to get media stream for recording.");
      return;
    }
  }
  
  console.log("Attempting to start recording...");
  UI.updateRecordingUI('recording');
  UI.setRecordedChunks([]);
  UI.setCurrentRecordingBlob(null);
  
  try {
    UI.mediaStream.getAudioTracks().forEach(track => track.enabled = true);
    
    // ✅ UPDATED: MIME Type negotiation
    let mime = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8,opus';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';

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
        UI.mediaStream.getTracks().forEach(track => track.stop());
        UI.setMediaStream(null);
      }
      UI.$("#video-preview").srcObject = null;
      
      if (UI.recordedChunks.length > 0) {
        const blob = new Blob(UI.recordedChunks, { type: recorder.mimeType || 'video/webm' });
        UI.setCurrentRecordingBlob(blob);
        openMetadataScreen(); // Call internal helper
      } else {
        console.warn("No data recorded.");
        UI.updateRecordingUI('idle');
        startPreview();
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
    console.error("Failed to start recording:", err);
    UI.toast(`Error: ${err.message}`, "error");
    if (UI.mediaStream) UI.mediaStream.getTracks().forEach(track => track.stop());
    UI.setMediaStream(null);
    UI.updateRecordingUI('idle');
  }
}

export function pauseOrResumeRecording() {
  if (!UI.mediaRecorder) return;
  
  if (UI.mediaRecorder.state === 'recording') {
    UI.mediaRecorder.pause();
    if(UI.timerInterval) clearInterval(UI.timerInterval);
    UI.updateRecordingUI('paused');
    UI.toast("Recording paused", "info");
  } else if (UI.mediaRecorder.state === 'paused') {
    UI.mediaRecorder.resume();
    UI.setTimerInterval(setInterval(() => {
      UI.setSecondsElapsed(UI.secondsElapsed + 1);
      UI.$("#rec-timer").textContent = new Date(UI.secondsElapsed * 1000).toISOString().substr(14, 5);
    }, 1000));
    UI.updateRecordingUI('recording');
    UI.toast("Recording resumed", "info");
  }
}

export function stopRecording() {
  if (UI.mediaRecorder && (UI.mediaRecorder.state === 'recording' || UI.mediaRecorder.state === 'paused')) {
    UI.mediaRecorder.stop();
    if(UI.timerInterval) clearInterval(UI.timerInterval);
    UI.updateRecordingUI('stopped');
  }
}

export async function discardRecording() {
  if (UI.mediaRecorder && (UI.mediaRecorder.state === 'recording' || UI.mediaRecorder.state === 'paused')) {
    const confirmed = await UI.showConfirm("Are you sure you want to discard this recording and start over?", "Discard Recording?", "Discard");
    
    if (confirmed) {
        console.log("Discarding active recording...");
        UI.mediaRecorder.onstop = null;
        UI.mediaRecorder.stop();
        UI.setMediaRecorder(null);
        UI.toast("Recording discarded.", "warn");
    } else {
        return; // User cancelled
    }
  }
  
  console.log("Resetting recorder UI.");
  if (UI.mediaStream) {
    UI.mediaStream.getTracks().forEach(track => track.stop());
    UI.setMediaStream(null);
  }
  UI.$("#video-preview").srcObject = null;
  UI.setRecordedChunks([]);
  UI.setCurrentRecordingBlob(null);
  if(UI.timerInterval) clearInterval(UI.timerInterval);
  UI.setSecondsElapsed(0);
  UI.$("#rec-timer").textContent = "00:00";
  UI.updateRecordingUI('idle');
  
  startPreview();
}

export async function toggleCamera() {
  UI.setCurrentFacingMode((UI.currentFacingMode === 'user') ? 'environment' : 'user');
  UI.toast(`Switched to ${UI.currentFacingMode === 'user' ? 'front' : 'back'} camera.`);
  
  if (!UI.mediaRecorder || UI.mediaRecorder.state === 'inactive') {
    await startPreview();
  }
}

/* -------------------------------------------------------------------------- */
/* Metadata Tagging Flow (Internal helpers)
/* -------------------------------------------------------------------------- */
function openMetadataScreen() {
  if (!UI.currentRecordingBlob) {
    UI.toast("No recording to tag.", "error");
    return;
  }
  
  UI.$("#meta-org").value = UI.userDoc.organizationName || "Default Org"; 
  UI.$("#meta-instructor").value = UI.userDoc.instructorName || (UI.currentUser ? UI.currentUser.email : "Instructor"); 
  
  UI.refreshMetadataClassList();
  UI.$("#meta-class").value = "";
  UI.$("#meta-participant").innerHTML = '<option value="">Select a class/event first...</option>';
  UI.$("#meta-participant").disabled = true;
  UI.$("#add-participant-container").classList.add("hidden");
  
  UI.$("#metadata-form").reset();
  
  UI.$("#meta-file-size").textContent = `${(UI.currentRecordingBlob.size / 1024 / 1024).toFixed(2)} MB`;
  
  // ✅ FIXED: Call showModal() directly, do not call UI.showScreen()
  UI.$("#metadata-screen").showModal();
}

export function handleMetadataClassChange(e) {
  const classId = e.target.value;
  const participantSelect = UI.$("#meta-participant");
  
  participantSelect.innerHTML = '<option value="">Select a participant...</option>';
  
  if (!classId || !UI.classData[classId]) {
    participantSelect.disabled = true;
    participantSelect.innerHTML = '<option value="">Select a class/event first...</option>';
    return;
  }
  
  const participants = UI.classData[classId].participants || [];
  
  if (participants.length === 0) {
    participantSelect.innerHTML = '<option value="">No participants in this class</option>';
  } else {
    participants.forEach(name => {
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
  UI.$("#add-participant-container").classList.toggle("hidden", selected !== "--ADD_NEW--");
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
      const classRef = doc(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/classes`, classId);
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

 const metadata = {
  organization: UI.$("#meta-org").value,
  instructor: UI.$("#meta-instructor").value,
  classEventId: UI.$("#meta-class").value,
  classEventTitle: UI.$("#meta-class").options[UI.$("#meta-class").selectedIndex]?.text || "N/A",
  participant: UI.$("#meta-participant").value,
  recordingType: UI.$("#meta-type").value,
  group: UI.$("#meta-group").value.trim() || null,
  notes: UI.$("#meta-notes").value.trim() || null,
  fileSize: UI.currentRecordingBlob.size,
  duration: UI.secondsElapsed,
  recordedAt: new Date().toISOString(), // ✅ Added timestamp
  tags: UI.currentTags || [] // ✅ Added tag array
};
UI.currentTags = []; // ✅ Reset tags after upload

  
  if (!metadata.classEventId || metadata.participant === "--ADD_NEW--" || !metadata.participant) {
    UI.toast("Please select a class and a valid participant.", "error");
    return;
  }
  
  console.log("Saving metadata and uploading file:", metadata);
  
  UI.$("#metadata-form").reset();
  UI.$("#metadata-screen").close();
  UI.updateRecordingUI('idle');

  await uploadFile(UI.currentRecordingBlob, metadata);
  
  UI.setCurrentRecordingBlob(null);
  UI.setSecondsElapsed(0);
  UI.$("#rec-timer").textContent = "00:00";
}
/* -------------------------------------------------------------------------- */
/* Event Bindings – Recorder Controls
/* -------------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  console.log("🎥 Recorder control bindings attached.");

  // Recording Control Buttons
  UI.$("#start-rec-btn")?.addEventListener("click", startRecording);
  UI.$("#stop-rec-btn")?.addEventListener("click", stopRecording);
  UI.$("#pause-rec-btn")?.addEventListener("click", pauseOrResumeRecording);
  UI.$("#discard-rec-btn")?.addEventListener("click", discardRecording);
  UI.$("#toggle-camera-btn")?.addEventListener("click", toggleCamera);

  // Tag Button (adds a quick marker for reference)
  UI.$("#tag-btn")?.addEventListener("click", () => {
    if (!UI.mediaRecorder || UI.mediaRecorder.state !== "recording") {
      UI.toast("Cannot tag — not currently recording.", "warn");
      return;
    }
    const time = UI.secondsElapsed;
    console.log(`🎯 Tag added at ${time}s`);
    UI.toast(`Tag at ${time}s`, "info");

    // Optional: store tags in memory for later use
    if (!UI.currentTags) UI.currentTags = [];
    UI.currentTags.push({ time, note: `Tag at ${time}s` });
  });

  // Metadata Form Events
  UI.$("#meta-class")?.addEventListener("change", handleMetadataClassChange);
  UI.$("#meta-participant")?.addEventListener("change", handleMetadataParticipantChange);
  UI.$("#add-participant-btn")?.addEventListener("click", handleAddNewParticipant);
  UI.$("#metadata-form")?.addEventListener("submit", handleMetadataSubmit);
});
