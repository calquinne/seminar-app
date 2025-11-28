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

// ✅ LOCAL STATE FOR TAGS
let currentTags = [];

/* -------------------------------------------------------------------------- */
/* Internal helpers for tags UI
/* -------------------------------------------------------------------------- */

function clearTagList() {
  const list = UI.$("#tag-list");
  if (list) list.innerHTML = "";
  currentTags = []; // ✅ Reset local state
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
/* Recording Flow                                                              */
/* -------------------------------------------------------------------------- */
export async function startPreview() {
  if (!UI.hasAccess()) {
    UI.toast("Recording disabled without an active subscription.", "error");
    return;
  }

  // Stop old streams
  if (UI.mediaStream) {
    UI.mediaStream.getTracks().forEach(track => track.stop());
  }

  console.log("Initializing camera preview...");
  UI.updateRecordingUI("idle");
  UI.setRecordedChunks([]);
  UI.setCurrentRecordingBlob(null);

  if (UI.timerInterval) clearInterval(UI.timerInterval);
  UI.setSecondsElapsed(0);
  UI.$("#rec-timer").textContent = "00:00";

  const progressEl = UI.$("#upload-progress");
  if (progressEl) progressEl.style.width = "0%";

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

    // Get camera + mic
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    UI.setMediaStream(stream);

    // Set main preview
    UI.$("#video-preview").srcObject = stream;
    UI.$("#video-preview").muted = true;

    // ⭐ NEW: Show live camera feed in dockable mini-player
    UI.openFloatingPlayer(stream, "Live Camera");

    // Mute preview audio only
    UI.mediaStream.getAudioTracks().forEach(track => (track.enabled = false));
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
  clearTagList(); // ✅ Clear tags on new recording
  
  try {
    UI.mediaStream.getAudioTracks().forEach(track => track.enabled = true);
    
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
  // Add 1-second check
  if (UI.secondsElapsed < 1) {
    UI.toast("Recording must be at least 1 second long.", "error");
    return;
  }

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
  clearTagList(); // ✅ Clear timeline when discarded
  
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
  
  UI.$("#metadata-form").reset(); // Reset form first
  
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

  const metaClassEl = UI.$("#meta-class");
  const selectedClassText = metaClassEl.options[metaClassEl.selectedIndex]?.text || "N/A";

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
    tags: currentTags
  };

  // Validation
  if (
    !metadata.classEventId ||
    metadata.participant === "--ADD_NEW--" ||
    !metadata.participant
  ) {
    UI.toast("Please select a class and a valid participant.", "error");
    return;
  }

  console.log("Processing submission...", metadata);

  // Reset UI immediately
  UI.$("#metadata-form").reset();
  UI.$("#metadata-screen").close();
  UI.updateRecordingUI("idle");
  clearTagList();

  // -------------------------------
  //      NEW STORAGE LOGIC
  // -------------------------------
  const storageChoice = UI.getStorageChoice(); // "firebase", "gdrive", "local"

 // ✅ UPDATED: Local / USB Logic
  if (storageChoice === "local") {
    const filename = `${Date.now()}_${metadata.participant}.webm`;
    const saved = await UI.saveToLocalDevice(UI.currentRecordingBlob, filename);
    
    if (saved) {
      // Save metadata to DB (mark as local)
      metadata.storagePath = 'local';
      metadata.downloadURL = null;
      metadata.savedAs = filename; 
      metadata.isLocal = true;   // <-- ADD THIS LINE
      
      await uploadFile(null, metadata); 
      UI.toast("Saved to device & database updated!", "success");
    } else {
       UI.toast("Save cancelled. Video kept in memory.", "warn");
       return; 
    }
  }

  // ------- GOOGLE DRIVE -------
  else if (storageChoice === "gdrive") {
    UI.uploadToDrivePlaceholder(UI.currentRecordingBlob, metadata);
  }

  // ------- FIREBASE -------
  else {
    await uploadFile(UI.currentRecordingBlob, metadata);
  }

  // Cleanup recording memory
  UI.setCurrentRecordingBlob(null);
  UI.setSecondsElapsed(0);
  UI.$("#rec-timer").textContent = "00:00";
}
