/* ========================================================================== */
/* MODULE: firestore.js
/* Exports all Firebase and IndexedDB logic.
/* ========================================================================== */

// Firebase SDK Imports
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence } 
  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc,
  collection, addDoc, query, getDocs, orderBy, serverTimestamp,
  deleteDoc, increment
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
  getStorage, ref as sRef, uploadBytesResumable, getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// Import UI module for state and utils
import * as UI from './ui.js';

// Internal scoring context (which video + rubric are we scoring?)
let currentScoringContext = null;

/* -------------------------------------------------------------------------- */
/* Firebase Initialization
/* -------------------------------------------------------------------------- */
export async function initFirebase() {
  try {
    if (getApps().length) {
      console.log("Firebase already initialized, reusing app.");
      const app = getApps()[0];
      const auth = getAuth(app);
      const db = getFirestore(app);
      const storage = getStorage(app);
      UI.setFirebase(app, auth, db, storage);
      await setPersistence(auth, browserLocalPersistence);
      return true;
    }

    const cfgStr = localStorage.getItem(UI.LS.CFG);
    if (!cfgStr) {
      console.warn("⚠️ No Firebase config found in localStorage.");
      return false;
    }

    const cfg = JSON.parse(cfgStr);
    const app = initializeApp(cfg);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const storage = getStorage(app);
    
    UI.setFirebase(app, auth, db, storage);
    await setPersistence(auth, browserLocalPersistence);

    console.log("✅ Firebase initialized successfully.");
    return true;
  } catch (e) {
    console.error("❌ Firebase init error:", e);
    UI.toast("Firebase init failed: " + e.message, "error");
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* IndexedDB Offline Queue
/* -------------------------------------------------------------------------- */
export function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(UI.IDB_NAME, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(UI.IDB_STORE))
        r.result.createObjectStore(UI.IDB_STORE, { keyPath: "id", autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function cacheOffline(blob, meta) {
  try {
    const dbx = await idbOpen();
    await new Promise((res, rej) => {
      const tx = dbx.transaction(UI.IDB_STORE, "readwrite");
      tx.objectStore(UI.IDB_STORE).add({ blob, meta, createdAt: Date.now() });
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    UI.toast("Saved offline. Will upload when back online.", "info");
  } catch (e) {
    console.error("Failed to cache offline", e);
    UI.toast("Failed to save offline. Storage may be full.", "error");
  }
}

/* -------------------------------------------------------------------------- */
/* Quota Management
/* -------------------------------------------------------------------------- */
export async function updateUserStorageQuota(deltaBytes) {
  if (!UI.db || !UI.currentUser || deltaBytes === 0) return;
  
  try {
    const ref = doc(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}`);
    await updateDoc(ref, { 
      storageUsedBytes: increment(deltaBytes) 
    });
    console.log(`Quota updated by ${deltaBytes} bytes.`);
  } catch (e) {
    console.warn("User quota update failed:", e);
  }
}

/* -------------------------------------------------------------------------- */
/* Class / Event Management
/* -------------------------------------------------------------------------- */
export async function refreshClassesList() {
  if (!UI.db || !UI.currentUser) return;
  const col = collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/classes`);
  const q = query(col, orderBy("createdAt", "desc"));
  
  const classListSelect = UI.$("#classes-list");
  const metaClassSelect = UI.$("#meta-class");
  classListSelect.innerHTML = '<option value="">-- Select class to edit --</option>';
  metaClassSelect.innerHTML = '<option value="">-- Select a Class / Event --</option>';
  
  try {
    const snap = await getDocs(q);
    if (snap.empty) {
      UI.setClassData({});
      return;
    }
    
    let firstClassId = null;
    let newClassData = {};

    snap.forEach(d => {
      const classDoc = { id: d.id, ...d.data() };
      newClassData[d.id] = classDoc;
      
      const o = document.createElement("option");
      o.value = d.id;
      o.textContent = classDoc.title || "Untitled";
      
      if(classDoc.archived) {
        o.textContent += " (Archived)";
      } else {
        const metaOpt = o.cloneNode(true);
        metaClassSelect.appendChild(metaOpt);
      }
      
      classListSelect.appendChild(o);
      
      if (!firstClassId) firstClassId = d.id;
    });
    
    UI.setClassData(newClassData);
    
    if (firstClassId) {
      classListSelect.value = firstClassId;
      UI.loadClassIntoEditor(firstClassId);
    }

  } catch (e) {
    console.error("Error refreshing classes:", e);
    UI.toast("Could not load classes.", "error");
  }
}

export async function handleSaveClass() {
  if (!UI.db || !UI.currentUser) {
    UI.toast("Not signed in.", "error");
    return;
  }
  
  if (!UI.hasAccess()) {
    UI.toast("Saving classes requires an active subscription.", "error");
    return;
  }

  const title = UI.$("#class-title").value.trim();
  if (!title) {
    UI.toast("Class Title is required.", "error");
    return;
  }
  
  const participants = UI.$("#class-roster").value.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const archiveDate = UI.$("#class-archive-date").value || null;
  const deleteDate = UI.$("#class-delete-date").value || null;
  const selectedClassId = UI.$("#classes-list").value;

  const payload = {
    title,
    participants,
    archiveDate,
    deleteDate,
    updatedAt: serverTimestamp()
  };

  try {
    let newDocId = null;
    if (selectedClassId) {
      const docRef = doc(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/classes`, selectedClassId);
      await updateDoc(docRef, payload);
      UI.toast("Class updated!", "success");
      newDocId = selectedClassId;
    } else {
      payload.createdAt = serverTimestamp();
      payload.archived = false;
      const newDoc = await addDoc(collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/classes`), payload);
      newDocId = newDoc.id;
      UI.toast("Class created!", "success");
    }
    
    await refreshClassesList();
    UI.$("#classes-list").value = newDocId; 
    
  } catch (e) {
    console.error("Error saving class:", e);
    UI.toast(`Failed to save class: ${e.message}`, "error");
  }
}

export async function handleArchiveClass() {
  const id = UI.$("#classes-list").value;
  if (!id) {
    UI.toast("Select a class to archive first.", "error");
    return;
  }
  
  if (!UI.hasAccess()) {
    UI.toast("Archiving requires an active subscription.", "error");
    return;
  }

  let doExport = false;
  if (UI.getStorageChoice() === 'firebase') {
    doExport = await UI.showConfirm(
      "Archiving will hide this class. Videos remain accessible. Do you want to export videos now? (Recommended before potential deletion).",
      "Archive Class?",
      "Export & Archive"
    );
  } else {
    const proceed = await UI.showConfirm(
      "Archiving will hide this class from active lists. Videos remain accessible until auto-deletion.",
      "Archive Class?",
      "Archive"
    );
    if (!proceed) return;
  }

  if (doExport) {
    console.log("Triggering export for class:", id);
    UI.toast("Exporting... (This feature is under construction)", "info");
  }

  try {
    const appId = UI.getAppId();
    await updateDoc(doc(UI.db, `artifacts/${appId}/users/${UI.currentUser.uid}/classes`, id), {
      archived: true,
      updatedAt: serverTimestamp()
    });
    UI.toast("Class archived.", "success");
    await refreshClassesList();
    UI.clearClassEditor();
  } catch (e) {
    console.error("Error archiving class:", e);
    UI.toast(`Failed to archive class: ${e.message}`, "error");
  }
}

/* -------------------------------------------------------------------------- */
/* Rubric Management
/* -------------------------------------------------------------------------- */
export async function handleSaveNewRubric() {
  if (!UI.db || !UI.currentUser || !UI.storage) {
    UI.toast("Not signed in or storage not ready.", "error");
    return;
  }
  
  if (!UI.hasAccess()) {
    UI.toast("Saving rubrics requires an active subscription.", "error");
    return;
  }

  const title = UI.$("#new-rubric-title").value.trim();
  const file = UI.$("#new-rubric-file").files[0];
  const componentNames = UI.$$(".new-rubric-row")
    .map(input => input.value.trim())
    .filter(name => name);
    
  if (!title || !file || componentNames.length === 0) {
    UI.toast("Title, file, and at least one scoring row are required.", "error");
    return;
  }
  
  const btn = UI.$("#save-new-rubric-btn");
  btn.disabled = true;
  btn.textContent = "Uploading file...";

  try {
    const fileRef = sRef(UI.storage, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/rubric-files/${Date.now()}_${file.name}`);
    
    const uploadTask = uploadBytesResumable(fileRef, file);
    uploadTask.on('state_changed', snapshot => {
      const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
      btn.textContent = `Uploading... ${pct}%`;
    });
    await uploadTask;

    // ✅ FIX: Use fileRef instead of uploadTask.ref
    const fileURL = await getDownloadURL(fileRef);
    btn.textContent = "Saving to database...";

    const payload = {
      title: title,
      referenceFilePath: fileURL,
      componentNames: componentNames,
      createdAt: serverTimestamp()
    };
    
    await addDoc(collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/rubrics`), payload);
    
    UI.toast("Rubric saved successfully!", "success");
    
    UI.$("#new-rubric-title").value = "";
    UI.$("#new-rubric-file").value = "";
    UI.$("#new-rubric-rows-container").innerHTML = `
      <input type="text" class="new-rubric-row w-full rounded-lg bg-black/30 border border-white/10 p-2 text-sm" placeholder="Row 1: e.g., Context">
      <input type="text" class="new-rubric-row w-full rounded-lg bg-black/30 border border-white/10 p-2 text-sm" placeholder="Row 2: e.g., Argument">
    `;
    
    await refreshMyRubrics();

  } catch (e) {
    console.error("Failed to save rubric:", e);
    UI.toast(`Error saving rubric: ${e.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save New Rubric";
  }
}

export async function refreshMyRubrics() {
  if (!UI.db || !UI.currentUser) return;
  
  const listEl = UI.$("#my-rubrics-list");
  listEl.innerHTML = '<p class="text-sm text-gray-400">Loading rubrics...</p>';
  
  try {
    const col = collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/rubrics`);
    const q = query(col, orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    
    if (snap.empty) {
      listEl.innerHTML = '<p class="text-sm text-gray-400">No rubrics saved yet.</p>';
      return;
    }
    
    listEl.innerHTML = "";
    snap.forEach(d => {
      const rubric = d.data();
      const el = document.createElement("div");
      el.className = "p-3 bg-gray-800 rounded-lg flex justify-between items-center";
      el.innerHTML = `
        <div>
          <span class="font-medium">${rubric.title}</span>
          <span class="text-xs text-gray-400 ml-2">(${rubric.componentNames?.length || 0} rows)</span>
        </div>
        <div class="flex gap-2">
          <button class="share-rubric-btn text-xs text-primary-400 hover:underline" data-id="${d.id}">Share</button>
          <button class="delete-rubric-btn text-xs text-red-400 hover:underline" data-id="${d.id}">Delete</button>
        </div>
      `;
      listEl.appendChild(el);
    });
    
  } catch (e) {
    console.error("Failed to refresh rubrics:", e);
    UI.toast("Could not load rubrics.", "error");
    listEl.innerHTML = '<p class="text-sm text-red-400">Error loading rubrics.</p>';
  }
}

export async function handleShareRubric(e) {
  if (!e.target.classList.contains('share-rubric-btn')) return;
  const rubricId = e.target.dataset.id;
  
  if (await UI.showConfirm("Share this rubric to the Public Library? You confirm you have the rights to share this content.", "Share Rubric?", "Share")) {
    UI.toast("Submitting rubric for review... (placeholder)", "info");
  }
}

export async function handleDeleteRubric(e) {
  if (!e.target.classList.contains('delete-rubric-btn')) return;
  const rubricId = e.target.dataset.id;
  
  if (await UI.showConfirm("Are you sure you want to delete this rubric? This cannot be undone.", "Delete Rubric?", "Delete")) {
    UI.toast("Deleting rubric... (placeholder)", "info");
  }
}

/* -------------------------------------------------------------------------- */
/* Video Upload & Library  — supports Local + Firebase                        */
/* -------------------------------------------------------------------------- */
export async function uploadFile(blob, meta) {
  const isLocal = (blob === null); // If null = Local/USB save

  // If Cloud upload required but Firebase not ready
  if (!isLocal && (!UI.storage || !UI.db || !UI.currentUser)) {
    UI.toast("Storage/auth not ready.", "error");
    if (blob) await cacheOffline(blob, meta);
    return;
  }

  const appId = UI.getAppId();
  const progressEl = UI.$("#upload-progress");

  try {
    /* -------------------------------------------------------------- */
    /* A) LOCAL / USB SAVE (only metadata written to Firestore)       */
    /* -------------------------------------------------------------- */
    if (isLocal) {
      console.log("[uploadFile] Local save — metadata only");

      const docRef = await addDoc(
        collection(UI.db, `artifacts/${appId}/users/${UI.currentUser.uid}/videos`),
        {
          ...meta,
          storagePath: "local",     // Mark as local
          downloadURL: null,        // No cloud URL
          createdAt: serverTimestamp(),
          archived: false
        }
      );

      UI.toast("Saved to device & Database!", "success");
      return { id: docRef.id, url: null };
    }

    /* -------------------------------------------------------------- */
    /* B) FIREBASE CLOUD UPLOAD                                      */
    /* -------------------------------------------------------------- */
    if (!navigator.onLine) throw new Error("Offline. Caching file.");

    UI.toast(`Uploading ${meta.participant}'s video...`, "info");

    const ts = Date.now();
    const safe = (s) => String(s || "unk").replace(/[^a-z0-9_\-\.]/gi, "_");
    const fileName = `${ts}_${safe(meta.participant)}.webm`;

    const path = `artifacts/${appId}/users/${UI.currentUser.uid}/videos/${meta.classEventId}/${fileName}`;
    const fileRef = sRef(UI.storage, path);

    // Start upload
    const uploadTask = uploadBytesResumable(fileRef, blob);
    uploadTask.on("state_changed", snapshot => {
      const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
      if (progressEl) progressEl.style.width = `${pct}%`;
    });

    await uploadTask;

    // Get URL
    const url = await getDownloadURL(fileRef);

    // Save metadata
    const docRef = await addDoc(
      collection(UI.db, `artifacts/${appId}/users/${UI.currentUser.uid}/videos`),
      {
        ...meta,
        storagePath: path,
        downloadURL: url,
        createdAt: serverTimestamp(),
        archived: false
      }
    );

    UI.toast("Upload complete!", "success");
    await updateUserStorageQuota(meta.fileSize);

    if (progressEl) progressEl.style.width = "0%";
    return { id: docRef.id, url };

  } catch (e) {
    // Only cache if cloud upload failed
    if (!isLocal && blob) await cacheOffline(blob, meta);

    console.error("Upload failed:", e);
    UI.toast("Offline or failed — queued.", "info");

    if (progressEl) progressEl.style.width = "0%";
  }
}

export async function flushOfflineQueue() {
  if (!navigator.onLine) return;
  
  let dbx;
  try {
    dbx = await idbOpen();
  } catch (e) {
    console.error("Failed to open IDB for flushing:", e);
    return;
  }

  let all;
  try {
    all = await new Promise((res, rej) => {
      const tx = dbx.transaction(UI.IDB_STORE, "readonly");
      const store = tx.objectStore(UI.IDB_STORE);
      const req = store.getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  } catch (e) {
    console.error("Failed to read from IDB queue:", e);
    return;
  }

  if (!all.length) {
    console.log("Offline queue is empty.");
    return;
  }

  UI.toast(`Uploading ${all.length} queued file(s)...`, "info");

  for (const item of all) {
    try {
      if (!UI.storage || !UI.db || !UI.currentUser) {
         console.warn("Auth not ready, skipping queue flush.");
         break;
      }
      
      // 1. Upload the file (and wait for it)
      await uploadFile(item.blob, item.meta);

      // 2. Delete in a *new* transaction
      await new Promise((res, rej) => {
        const deleteTx = dbx.transaction(UI.IDB_STORE, "readwrite");
        deleteTx.objectStore(UI.IDB_STORE).delete(item.id);
        deleteTx.oncomplete = res;
        deleteTx.onerror = () => rej(deleteTx.error);
      });
      
      UI.toast("Queued file uploaded!", "success");

    } catch (e) {
      console.error("Failed to flush item, will retry later:", item.id, e);
    }
  }
}

 export async function loadLibrary() {
  if (!UI.db || !UI.currentUser) return;

  const appId = UI.getAppId();
  const listEl = UI.$("#library-list");
  listEl.innerHTML = '<p class="text-sm text-gray-400 py-3">Loading your videos...</p>';

  try {
    const qRef = query(
      collection(UI.db, `artifacts/${appId}/users/${UI.currentUser.uid}/videos`),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(qRef);

    if (snap.empty) {
      listEl.innerHTML = '<p class="text-sm text-gray-400 py-4">No videos saved yet.</p>';
      return;
    }

    listEl.innerHTML = "";

    snap.forEach((d) => {
      const v = d.data();

      const created = v.createdAt?.seconds
        ? new Date(v.createdAt.seconds * 1000)
        : (v.createdAt?.toDate ? v.createdAt.toDate() : null);

      const dateStr = created ? created.toLocaleDateString() : "—";
      const sizeStr = ((v.fileSize || 0) / 1024 / 1024).toFixed(1) + " MB";

      const isLocal =
        v.isLocal || v.storagePath === "local" || !v.downloadURL;
      const isDrive =
        v.downloadURL && v.downloadURL.includes("drive.google.com");

      const li = document.createElement("div");
      li.className =
        "p-4 bg-white/5 border border-white/10 rounded-xl mb-3 flex flex-col gap-3";

      let badge = "";
      let action = "";

      // -------------------------
      // LOCAL VIDEO
      // -------------------------
      if (isLocal) {
        badge = `
          <span class="px-2 py-0.5 text-[10px] rounded bg-yellow-500/20 
                 border border-yellow-500/40 text-yellow-200 uppercase tracking-wide">
            LOCAL ONLY
          </span>
        `;

        action = `
          <button 
            class="text-yellow-400 text-sm hover:text-yellow-300 hover:underline 
                   flex items-center gap-2 transition-colors"
            data-open-local="true"
            data-title="${v.participant || 'Video'}"
            title="Click to locate and play this file">
            📂 Open File
          </button>
        `;
      }

      // -------------------------
      // GOOGLE DRIVE
      // -------------------------
      else if (isDrive) {
        badge = `
          <span class="px-2 py-0.5 text-[10px] rounded bg-green-500/20 
                 border border-green-500/40 text-green-200 uppercase tracking-wide">
            GOOGLE DRIVE
          </span>
        `;

        action = `
          <a href="${v.downloadURL}" target="_blank"
             class="text-green-400 text-sm hover:underline flex items-center gap-1">
            ↗ Open Drive
          </a>
        `;
      }

      // -------------------------
      // FIREBASE CLOUD VIDEO
      // -------------------------
      else {
        badge = `
          <span class="px-2 py-0.5 text-[10px] rounded bg-blue-500/20 
                 border border-blue-500/40 text-blue-200 uppercase tracking-wide">
            CLOUD
          </span>
        `;

        action = `
          <button 
            class="text-primary-300 text-sm hover:underline flex items-center gap-1"
            data-play-url="${v.downloadURL}"
            data-title="${v.participant || 'Video'}">
            ▶ Play Video
          </button>
        `;
      }

      // -------------------------
      // SCORING BUTTON (SAFE JSON)
      // -------------------------
      const scorePayload = encodeURIComponent(
        JSON.stringify({ id: d.id, ...v })
      );

      const scoreBtn = `
        <button 
          class="text-amber-400 text-sm hover:text-amber-300 hover:underline flex items-center gap-1"
          data-score-video="${scorePayload}">
          ⭐ Score
        </button>
      `;

    // -------------------------
// MAIN ROW TEMPLATE
// -------------------------
li.innerHTML = `
  <div class="flex justify-between items-start">
    <div class="flex flex-col">
      <div class="font-semibold text-white text-base">
        ${v.classEventTitle || "Untitled"} — ${v.participant}
      </div>
      <div class="text-xs text-gray-400 mt-1">
        ${dateStr} • ${v.recordingType || "Presentation"} • ${sizeStr}
      </div>
    </div>
    ${badge}
  </div>

  <div class="flex justify-between items-center border-t border-white/10 pt-3 mt-1">
    <div class="flex items-center gap-4 flex-wrap">
      ${action}

      <!-- ⭐ Score or View Score -->
     ${
  v.hasScore
    ? `
      <button 
        class="text-green-400 text-sm hover:text-green-300 hover:underline flex items-center gap-1"
        data-open-score="${d.id}">
        ✔ Scored (${v.lastScore} pts)
      </button>
    `
    : `
      <button 
        class="text-amber-400 text-sm hover:text-amber-300 hover:underline flex items-center gap-1"
        data-score-video="${d.id}">
        ⭐ Score
      </button>
    `
}

    </div>

    <button class="text-sm text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors"
      data-del="${d.id}">
      🗑 Delete
    </button>
  </div>
`;

listEl.appendChild(li);

    });
  } catch (e) {
    console.error("Error loading library:", e);
    listEl.innerHTML =
      '<p class="text-sm text-red-400 py-3">Error loading library.</p>';
  }
}

export async function handleDeleteVideo(docId) {
  if (!UI.db || !UI.storage || !UI.currentUser) return;
  
  const confirmed = await UI.showConfirm("Are you sure you want to permanently delete this video?", "Delete Video?", "Delete");
  if (!confirmed) return;

  const appId = UI.getAppId();
  const docRef = doc(UI.db, `artifacts/${appId}/users/${UI.currentUser.uid}/videos`, docId);

  try {
    const videoDoc = await getDoc(docRef);
    if (!videoDoc.exists()) {
      UI.toast("Document already deleted.", "warn");
      return;
    }

    const storagePath = videoDoc.data().storagePath;
    const fileSize = videoDoc.data().fileSize || 0;
    
    if (storagePath) {
      const fileRef = sRef(UI.storage, storagePath);
      await deleteObject(fileRef);
    } else {
      console.warn("No storagePath found on doc, skipping file deletion.");
    }

    await deleteDoc(docRef);
    
    await updateUserStorageQuota(-fileSize);

    UI.toast("Video deleted.", "success");
    loadLibrary(); // Refresh the list

  } catch (e) {
    console.error("Error deleting video:", e);
    UI.toast(`Delete failed: ${e.message}`, "error");
  }
}
// ---------------------------------------------------------------------------
// Local video opener for "LOCAL ONLY" entries
// ---------------------------------------------------------------------------
export function handleOpenLocalVideo(titleFromDoc) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "video/*";

  input.onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const title = titleFromDoc || file.name || "Local Video";

    UI.openVideoPlayer(url, title);
  };

  input.click();
}
/* -------------------------------------------------------------------------- */
/* Scoring: Open dialog for a video — INCLUDING loading saved scores          */
/* -------------------------------------------------------------------------- */

export async function openScoringForVideo(docId) {
  if (!UI.db || !UI.currentUser) {
    UI.toast("Not signed in.", "error");
    return;
  }

  const appId = UI.getAppId();

  try {
    // -----------------------------
    // 1) Load the video document
    // -----------------------------
    const videoRef = doc(
      UI.db,
      `artifacts/${appId}/users/${UI.currentUser.uid}/videos`,
      docId
    );
    const videoSnap = await getDoc(videoRef);

    if (!videoSnap.exists()) {
      UI.toast("Video not found.", "error");
      return;
    }

    const video = { id: videoSnap.id, ...videoSnap.data() };

    // -----------------------------
    // 2) Load rubrics (use first)
    // -----------------------------
    const rubCol = collection(
      UI.db,
      `artifacts/${appId}/users/${UI.currentUser.uid}/rubrics`
    );
    const rubSnap = await getDocs(rubCol);

    if (rubSnap.empty) {
      UI.toast("Create a rubric first in the Rubrics tab.", "error");
      return;
    }

    const rubrics = [];
    rubSnap.forEach((d) => rubrics.push({ id: d.id, ...d.data() }));
    const rubric = rubrics[0];

    // Build scoring rows
    const rows = (rubric.componentNames || []).map((name, idx) => ({
      label: name,
      maxPoints: 6,
      index: idx,
    }));

    // -----------------------------
    // 3) LOAD EXISTING SCORE (⭐ NEW)
    // scores doc ID = video.id
    // -----------------------------
    const scoreRef = doc(
      UI.db,
      `artifacts/${appId}/users/${UI.currentUser.uid}/scores`,
      video.id
    );

    let existingScores = null;
    const scoreSnap = await getDoc(scoreRef);

    if (scoreSnap.exists()) {
      existingScores = scoreSnap.data();
    }

    // -----------------------------
    // 4) Store context for save
    // -----------------------------
    currentScoringContext = { video, rubric, existingScores };

    // -----------------------------
    // 5) Render dialog with saved scores
    // -----------------------------
    UI.renderScoringDialog({
      video,
      rubric,
      rows,
      existingScores, // ⭐ Pass to UI
    });

    UI.openScoringDialog();

  } catch (e) {
    console.error("Error opening scoring:", e);
    UI.toast("Could not open scoring dialog.", "error");
  }
}

/* -------------------------------------------------------------------------- */
/* SAVE SCORES — Overwrite Mode (One score per video)                        */
/* -------------------------------------------------------------------------- */

export async function handleScoringSubmit(rowScores) {
  if (!UI.db || !UI.currentUser || !currentScoringContext) {
    UI.toast("Scoring context missing.", "error");
    return;
  }

  const { video, rubric } = currentScoringContext;
  const appId = UI.getAppId();

  try {
    // Create new score record
    const scoresCol = collection(
      UI.db,
      `artifacts/${appId}/users/${UI.currentUser.uid}/scores`
    );

    const totalPoints = rowScores.reduce((sum, r) => sum + (r.score || 0), 0);

    await addDoc(scoresCol, {
      videoId: video.id,
      classEventId: video.classEventId || null,
      classEventTitle: video.classEventTitle || null,
      participant: video.participant || null,
      rubricId: rubric.id,
      rubricTitle: rubric.title || null,
      totalPoints,
      rowScores,
      scoredAt: serverTimestamp()
    });

    // Update video document for Library display
    const videoRef = doc(
      UI.db,
      `artifacts/${appId}/users/${UI.currentUser.uid}/videos`,
      video.id
    );

    await updateDoc(videoRef, {
      hasScore: true,
      lastScore: totalPoints,
      rubricTitle: rubric.title || null,
      lastScoredAt: serverTimestamp()
    });

    UI.toast("Scores saved.", "success");
    UI.closeScoringDialog();
    currentScoringContext = null;

    // Refresh Library to show the new badge
    loadLibrary();

  } catch (e) {
    console.error("Error saving scores:", e);
    UI.toast("Failed to save scores.", "error");
  }
}
