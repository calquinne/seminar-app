/* ========================================================================== */
/* MODULE: firestore.js (Updated: Shows Rubric Title in Library)
/* Handles all Firestore interactions (read/write/upload) & Library rendering.
/* ========================================================================== */

// ✅ IMPORT UI TO HANDLE SCORING/PLAYBACK DELEGATION
import * as UI from "./ui.js"; 

// ✅ FIREBASE IMPORTS (Consolidated to prevent "Already Declared" errors)
import { 
  initializeApp 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";

import { 
  getAuth 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

import { 
  getFirestore, 
  collection, 
  doc, 
  addDoc, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  serverTimestamp, 
  enableIndexedDbPersistence 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { 
  getStorage, 
  ref, 
  uploadBytesResumable, 
  getDownloadURL, 
  deleteObject 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

/* -------------------------------------------------------------------------- */
/* Initialization & Config
/* -------------------------------------------------------------------------- */
export async function initFirebase() {
  try {
    const configStr = localStorage.getItem(UI.LS.CFG);
    if (!configStr) return false;

    const config = JSON.parse(configStr);
    const app = initializeApp(config);
    const db = getFirestore(app);
    const storage = getStorage(app);
    
    // ✅ Initialize Auth here so UI.auth is populated
    const auth = getAuth(app); 

    try {
      await enableIndexedDbPersistence(db);
      console.log("Persistence enabled");
    } catch (err) {
      if (err.code === 'failed-precondition') {
        console.warn("Persistence failed: Multiple tabs open.");
      } else if (err.code === 'unimplemented') {
        console.warn("Persistence not supported.");
      }
    }

    UI.setFirebase(app, auth, db, storage);
    return true;
  } catch (e) {
    console.error("Firebase Init Error:", e);
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Class / Event Management
/* -------------------------------------------------------------------------- */
export async function refreshClassesList() {
  if (!UI.db || !UI.currentUser) return;
  const list = UI.$("#classes-list");
  if (!list) return;

  list.innerHTML = "<option>Loading...</option>";
  
  try {
    const q = query(collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/classes`));
    const snapshot = await getDocs(q);
    
    list.innerHTML = '<option value="">-- Select a Class to Edit --</option>';
    const classData = {};

    snapshot.forEach((doc) => {
      const data = doc.data();
      classData[doc.id] = { id: doc.id, ...data };
      const opt = document.createElement("option");
      opt.value = doc.id;
      opt.textContent = `${data.title} ${data.archived ? "(Archived)" : ""}`;
      list.appendChild(opt);
    });

    UI.setClassData(classData);
    UI.refreshMetadataClassList();
  } catch (e) {
    console.error("Error loading classes:", e);
    UI.toast("Failed to load classes.", "error");
  }
}

export async function handleSaveClass() {
  const id = UI.$("#classes-list").value;
  const title = UI.$("#class-title").value.trim();
  const rosterStr = UI.$("#class-roster").value.trim();
  
  if (!title) {
    UI.toast("Class title is required.", "error");
    return;
  }

  const participants = rosterStr 
    ? rosterStr.split("\n").map(s => s.trim()).filter(s => s) 
    : [];

  try {
    const colRef = collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/classes`);
    
    if (id) {
      await updateDoc(doc(colRef, id), { title, participants, updatedAt: serverTimestamp() });
      UI.toast("Class updated!", "success");
    } else {
      await addDoc(colRef, {
        title, 
        participants, 
        archived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      UI.toast("Class created!", "success");
    }
    UI.clearClassEditor();
    refreshClassesList();
  } catch (e) {
    console.error("Save class failed:", e);
    UI.toast("Error saving class.", "error");
  }
}

export async function handleArchiveClass() {
  const id = UI.$("#classes-list").value;
  if (!id) return;
  
  if (!await UI.showConfirm("Archive this class? It will be hidden from selection menus.", "Archive Class?")) return;

  try {
    const ref = doc(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/classes`, id);
    await updateDoc(ref, { archived: true });
    UI.toast("Class archived.", "success");
    refreshClassesList();
  } catch (e) {
    console.error("Archive failed:", e);
    UI.toast("Error archiving class.", "error");
  }
}

/* -------------------------------------------------------------------------- */
/* File Upload & Metadata (Cloud Only)
/* -------------------------------------------------------------------------- */
export async function uploadFile(blob, metadata) {
  if (!UI.db || !UI.currentUser) throw new Error("Not signed in.");

  // ✅ SAFETY GUARD: This function is for Cloud Uploads ONLY.
  if (!blob) {
      throw new Error("CRITICAL: uploadFile called without a file blob. Use exportToLocal for local saves.");
  }

  const appId = UI.getAppId();
  if (!appId) throw new Error("CRITICAL: App ID missing.");

  // 1. Generate ID
  const newDocRef = doc(collection(UI.db, `artifacts/${appId}/users/${UI.currentUser.uid}/videos`));
  const videoId = newDocRef.id;

  // 2. Construct Path
  const filename = `${videoId}_${Date.now()}.webm`;
  const storagePath = `artifacts/${appId}/users/${UI.currentUser.uid}/videos/${filename}`;
  
  // 3. Set Content Type
  const contentType = blob.type || "video/webm";
  const uploadMeta = { contentType };

  UI.$("#upload-progress-container")?.classList.remove("hidden");

  try {
    // 4. Upload to Cloud
    const storageRef = ref(UI.storage, storagePath);
    const uploadTask = uploadBytesResumable(storageRef, blob, uploadMeta);

    await new Promise((resolve, reject) => {
        uploadTask.on('state_changed', 
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                const bar = UI.$("#upload-progress");
                if (bar) bar.style.width = `${progress}%`;
            },
            (error) => reject(error),
            async () => resolve()
        );
    });

    const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

    // 5. Save Metadata
    await setDoc(newDocRef, {
        ...metadata,
        id: videoId,
        storagePath: storagePath,
        downloadURL: downloadURL,
        createdAt: serverTimestamp(),
        status: "ready"
    });

    return { id: videoId, storagePath: storagePath, downloadURL };

  } catch (error) {
    console.error("Upload/Save failed:", error);
    throw error;

  } finally {
    UI.$("#upload-progress-container")?.classList.add("hidden");
  }
}

/* -------------------------------------------------------------------------- */
/* Smart Save (CORRECT: Identity-Safe Fan-Out)
/* -------------------------------------------------------------------------- */
export async function saveRecording(meta, blob) {
  // ==========================
  // INDIVIDUAL MODE
  // ==========================
  if (!Array.isArray(meta.participants) || meta.participants.length === 0) {
    return await uploadFile(blob, meta);
  }

  // ==========================
  // GROUP MODE
  // ==========================
  const uniqueParticipants = [...new Set(
    meta.participants.map(p => p?.trim()).filter(Boolean)
  )];

  if (uniqueParticipants.length < 2) {
    throw new Error("GROUP_REQUIRES_2");
  }

  const appId = UI.getAppId();
  const userUid = UI.currentUser.uid;
  const colRef = collection(UI.db, `artifacts/${appId}/users/${userUid}/videos`);

  // Upload ONCE (primary student only)
  const primaryStudent = uniqueParticipants[0];

  // ✅ CORRECT FIX: Remove 'participants' key entirely
  // (Setting it to 'undefined' causes Firebase to crash)
  const { participants, ...safeMeta } = meta;

  const baseMeta = {
    ...safeMeta, // This copy has NO participants array
    participant: primaryStudent,
    isGroup: true
  };

  const uploadResult = await uploadFile(blob, baseMeta);

  // Fan-out remaining students (Using the clean baseMeta)
  const remaining = uniqueParticipants.slice(1);

  const writes = remaining.map(student => {
    const ref = doc(colRef);
    return setDoc(ref, {
      ...baseMeta,
      participant: student,
      id: ref.id,
      storagePath: uploadResult.storagePath,
      downloadURL: uploadResult.downloadURL,
      createdAt: serverTimestamp(),
      status: "ready"
    });
  });

  await Promise.all(writes);
  return uploadResult;
}

/* -------------------------------------------------------------------------- */
/* Offline Handling (IndexedDB wrapper)
/* -------------------------------------------------------------------------- */
async function saveToOfflineQueue(blob, metadata) {
  if (!window.indexedDB) return;
  const request = indexedDB.open(UI.IDB_NAME, 1);
  
  request.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains(UI.IDB_STORE)) {
      db.createObjectStore(UI.IDB_STORE, { autoIncrement: true });
    }
  };

  request.onsuccess = (e) => {
    const db = e.target.result;
    const tx = db.transaction(UI.IDB_STORE, "readwrite");
    tx.objectStore(UI.IDB_STORE).add({ blob, metadata, timestamp: Date.now() });
    UI.toast("Saved to device queue.", "info");
  };
}

export async function flushOfflineQueue() {
  if (!window.indexedDB) return;
  const request = indexedDB.open(UI.IDB_NAME, 1);
  
  request.onsuccess = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains(UI.IDB_STORE)) return;

    const tx = db.transaction(UI.IDB_STORE, "readwrite");
    const store = tx.objectStore(UI.IDB_STORE);
    const getAll = store.getAll();

    getAll.onsuccess = async () => {
      const items = getAll.result;
      if (items.length === 0) return;

      UI.toast(`Uploading ${items.length} offline items...`, "info");
      
      // Clear store first to prevent loops, re-add on fail if needed
      const clearTx = db.transaction(UI.IDB_STORE, "readwrite");
      clearTx.objectStore(UI.IDB_STORE).clear();

      for (const item of items) {
        try {
            // ✅ FIX: Skip "local" items in offline queue so they don't crash uploadFile
            if (item.metadata?.storagePath === "local") continue;

            await uploadFile(item.blob, item.metadata);
        } catch (err) {
            console.error("Offline item upload failed:", err);
            // Optional: You could re-add to IDB here if critical
        }
      }
    };
  };
}

/* -------------------------------------------------------------------------- */
/* Library Management (Updated: Shows Rubric Title)
/* -------------------------------------------------------------------------- */
export async function loadLibrary() {
  if (!UI.db || !UI.currentUser) return;
  const listEl = UI.$("#library-list");
  if (!listEl) return;
  
  listEl.innerHTML = '<p class="text-center text-gray-400">Loading library...</p>';

  try {
    // 1. Fetch Videos (Sorted)
    const q = query(
      collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`), 
      orderBy("recordedAt", "desc") 
    );
    const snap = await getDocs(q);
    
    // 2. NEW: Fetch Rubric Definitions to map IDs to Titles
    const rubricMap = {};
    try {
        const rSnap = await getDocs(collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/rubrics`));
        rSnap.forEach(d => {
            rubricMap[d.id] = d.data().title || "Untitled Rubric";
        });
    } catch (rubricErr) {
        console.warn("Library: Could not fetch rubrics", rubricErr);
    }

    if (snap.empty) {
      listEl.innerHTML = '<p class="text-center text-gray-500">No recordings found.</p>';
      return;
    }

    listEl.innerHTML = "";
    
    snap.forEach((d) => {
      const v = d.data();
      const id = d.id;
      
      const card = document.createElement("div");
      card.className = "bg-black/30 border border-white/10 rounded-lg p-4 mb-4 flex flex-col gap-2";
      
      const title = document.createElement("div");
      title.className = "font-semibold text-white";
      
      // Identity vs Context Logic
      const primaryName = v.participant || "Unknown";
      let groupBadge = "";
      const gName = v.groupName || v.group;
      if ((v.isGroup || v.recordingType === 'group') && gName) {
          groupBadge = ` <span class="ml-2 text-xs text-primary-400 font-normal bg-primary-500/10 px-1.5 py-0.5 rounded">👥 ${gName}</span>`;
      }

      title.innerHTML = `${v.classEventTitle || "Untitled"} — ${primaryName}${groupBadge}`;
      
      // Date Logic
      let dateStr = "Unknown Date";
      if (v.recordedAt) {
          const dateObj = v.recordedAt.toDate ? v.recordedAt.toDate() : new Date(v.recordedAt);
          dateStr = dateObj.toLocaleDateString();
      }
      
      // Rubric Title Logic
      const rubricTitle = (v.rubricId && rubricMap[v.rubricId]) 
         ? rubricMap[v.rubricId] 
         : "No Rubric Selected";

      const meta = document.createElement("div");
      meta.className = "text-xs text-gray-400 flex items-center gap-2 flex-wrap";
      
      // ADDED: Rubric Title Badge in the metadata line
      meta.innerHTML = `
        <span class="text-primary-300 bg-primary-500/10 border border-primary-500/20 px-1.5 py-0.5 rounded font-medium">${rubricTitle}</span>
        <span>•</span>
        <span>${dateStr}</span> 
        <span>•</span> 
        <span>${(v.fileSize / 1024 / 1024).toFixed(1)} MB</span>
      `;
      
      const actions = document.createElement("div");
      actions.className = "flex items-center gap-4 mt-2";

      // Buttons
      const playBtn = document.createElement("button");
      playBtn.className = "text-cyan-400 hover:underline text-sm";
      playBtn.textContent = v.downloadURL ? "▶ Play Video" : "📂 Open File";
      playBtn.onclick = () => UI.openScoringForVideo(id);

      const scoreBtn = document.createElement("button");
      scoreBtn.className = "text-green-400 hover:underline text-sm";
      scoreBtn.textContent = v.hasScore ? `✓ Scored (${v.totalScore || 0} pts)` : "Score";
      scoreBtn.onclick = () => UI.openScoringForVideo(id);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "ml-auto text-red-400 hover:underline text-sm";
      deleteBtn.textContent = "Delete";
      deleteBtn.onclick = () => deleteVideo(id);

      actions.appendChild(playBtn);
      actions.appendChild(scoreBtn);
      actions.appendChild(deleteBtn);

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(actions);

      listEl.appendChild(card);
    });

  } catch (e) {
    console.error("Library load error:", e);
    listEl.innerHTML = '<p class="text-center text-red-400">Failed to load library.</p>';
  }
}

export async function deleteVideo(id) {
  // 1. Fetch document first to check if it is Local or Cloud
  const docRef = doc(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`, id);
  const snap = await getDoc(docRef);
  
  if (!snap.exists()) {
      UI.toast("Video already deleted.", "info");
      loadLibrary();
      return;
  }

  const data = snap.data();
  const isLocal = data.storagePath === "local";

  // 2. Custom Message based on storage type
  let confirmMsg = "Delete this recording permanently?\n(Cannot be undone)";
  if (isLocal) {
      confirmMsg = "⚠️ Remove from App Library?\n\nThis will remove the data and score from Analytics, but the video file will REMAIN on your computer's hard drive.";
  }

  if (!await UI.showConfirm(confirmMsg, "Delete Video?", "Delete")) return;

  try {
    // 3. Delete Cloud File (if not local)
    if (!isLocal && data.storagePath) {
         const sRef = ref(UI.storage, data.storagePath);
         await deleteObject(sRef).catch(e => console.warn("Storage delete failed", e));
    }

    // 4. Delete Firestore Document
    await deleteDoc(docRef);
    
    UI.toast("Video deleted.", "success");
    loadLibrary(); // Refresh Library UI
    
  } catch (e) {
    console.error("Delete failed:", e);
    UI.toast("Could not delete video.", "error");
  }
}

// ⚠️ DEPRECATED/REMOVED: handleOpenLocalVideo 
// Logic moved inside UI.openScoringForVideo for consistency.
export function handleOpenLocalVideo(title) {
    UI.toast("Please use the 'Open File' button on a library card.", "info");
}

/* -------------------------------------------------------------------------- */
/* Scoring Submission
/* -------------------------------------------------------------------------- */
export async function handleScoringSubmit(data) {
  // Logic is now handled inside record.js (the Save Score button listener)
  console.warn("handleScoringSubmit called via DB but should be handled by Record.js listener.");
}

/* -------------------------------------------------------------------------- */
/* NEW: Save Data Only (For Local Mode / Hybrid)
/* -------------------------------------------------------------------------- */
export async function saveLocalData(meta) {
    if (!UI.db || !UI.currentUser) return;

    const appId = UI.getAppId();
    const userUid = UI.currentUser.uid;
    const colRef = collection(UI.db, `artifacts/${appId}/users/${userUid}/videos`);

    // Helper to create one document
    const createDoc = async (participantName) => {
        const newDocRef = doc(colRef);
        await setDoc(newDocRef, {
            ...meta,
            participant: participantName,
            id: newDocRef.id,
            storagePath: "local", // Mark as local so app knows not to fetch from cloud
            downloadURL: null,    // No cloud URL
            createdAt: serverTimestamp(),
            status: "ready"
        });
    };

    // 1. GROUP MODE: Fan-Out to all students
    if (meta.participants && meta.participants.length > 0) {
        const promises = meta.participants.map(student => createDoc(student));
        await Promise.all(promises);
    } 
    // 2. INDIVIDUAL MODE: Save just one
    else {
        await createDoc(meta.participant);
    }
}