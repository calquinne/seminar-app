/* ========================================================================== */
/* MODULE: firestore.js
/* Firebase, Storage, Library, and Scoring Coordination
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

// App Modules
import * as UI from "./ui.js";
import * as Rubrics from "./rubrics.js";
import * as Record from "./record.js";

/* ========================================================================== */
/* Firebase Initialization
/* ========================================================================== */

export async function initFirebase() {
  try {
    if (getApps().length) {
      console.log("Firebase already initialized.");
      const app = getApps()[0];
      UI.setFirebase(app, getAuth(app), getFirestore(app), getStorage(app));
      await setPersistence(getAuth(app), browserLocalPersistence);
      return true;
    }

    const cfgStr = localStorage.getItem(UI.LS.CFG);
    if (!cfgStr) return false;

    const cfg = JSON.parse(cfgStr);
    const app = initializeApp(cfg);
    UI.setFirebase(app, getAuth(app), getFirestore(app), getStorage(app));
    await setPersistence(getAuth(app), browserLocalPersistence);
    return true;

  } catch (e) {
    console.error("Firebase init failed:", e);
    UI.toast("Firebase init failed.", "error");
    return false;
  }
}

/* ========================================================================== */
/* IndexedDB Offline Queue
/* ========================================================================== */

export function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(UI.IDB_NAME, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(UI.IDB_STORE)) {
        r.result.createObjectStore(UI.IDB_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function cacheOffline(blob, meta) {
  try {
    const dbx = await idbOpen();
    const tx = dbx.transaction(UI.IDB_STORE, "readwrite");
    tx.objectStore(UI.IDB_STORE).add({ blob, meta, createdAt: Date.now() });
    UI.toast("Saved offline. Will upload when online.", "info");
  } catch (e) {
    console.error("Cache offline failed", e);
  }
}

/* ========================================================================== */
/* Quota Management
/* ========================================================================== */

export async function updateUserStorageQuota(deltaBytes) {
  if (!UI.db || !UI.currentUser || !deltaBytes) return;
  try {
    await updateDoc(
      doc(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}`),
      { storageUsedBytes: increment(deltaBytes) }
    );
  } catch(e) { console.warn("Quota update failed", e); }
}

/* ========================================================================== */
/* Video Upload (Local + Firebase)
/* ========================================================================== */

export async function uploadFile(blob, meta) {
  const isLocal = blob === null;
  const appId = UI.getAppId();

  if (!isLocal && (!UI.db || !UI.storage || !UI.currentUser)) {
    await cacheOffline(blob, meta);
    return;
  }

  // ✅ Snapshot rubric metadata for safety & analytics
  const activeRubric = Rubrics.getActiveRubric();
  const rubricSnapshot = activeRubric
    ? {
        rubricId: activeRubric.id,
        rubricTitle: activeRubric.title,
        rubricVersion: activeRubric.updatedAt || activeRubric.createdAt || null,
        rubricRowIds: (activeRubric.rows || []).map(r => r.id)
      }
    : {};

  // ✅ Fix: Ensure scoring fields exist even if 0
  const finalScores = meta.finalScores || {};
  const totalScore = meta.totalScore || 0;

  const baseMeta = {
    ...meta,
    ...rubricSnapshot,
    createdAt: serverTimestamp(),
    archived: false,
    finalScores: finalScores,
    totalScore: totalScore,
    // ✅ Fix: Sync lastScore immediately so Library shows it
    lastScore: totalScore,
    // ✅ Fix: Check keys length so 0 points counts as "Scored"
    hasScore: Object.keys(finalScores).length > 0
  };

  try {
    const progressEl = UI.$("#upload-progress");

    // LOCAL SAVE
    if (isLocal) {
      const docRef = await addDoc(
        collection(UI.db, `artifacts/${appId}/users/${UI.currentUser.uid}/videos`),
        { ...baseMeta, storagePath: "local", downloadURL: null }
      );
      UI.toast("Saved to device & Database!", "success");
      return { id: docRef.id, url: null };
    }

    // CLOUD SAVE
    if (!navigator.onLine) throw new Error("Offline. Caching file.");

    const ts = Date.now();
    const safe = (s) => String(s || "unk").replace(/[^a-z0-9_\-\.]/gi, "_");
    const fileName = `${ts}_${safe(meta.participant)}.webm`;
    const path = `artifacts/${appId}/users/${UI.currentUser.uid}/videos/${meta.classEventId}/${fileName}`;
    const fileRef = sRef(UI.storage, path);

    const uploadTask = uploadBytesResumable(fileRef, blob);
    uploadTask.on("state_changed", snapshot => {
      const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
      if (progressEl) progressEl.style.width = `${pct}%`;
    });

    await uploadTask;
    const url = await getDownloadURL(fileRef);

    const docRef = await addDoc(
      collection(UI.db, `artifacts/${appId}/users/${UI.currentUser.uid}/videos`),
      { ...baseMeta, storagePath: path, downloadURL: url }
    );

    await updateUserStorageQuota(meta.fileSize);
    
    UI.toast("Upload complete!", "success");
    if (progressEl) progressEl.style.width = "0%";
    return { id: docRef.id, url };

  } catch(e) {
    if (!isLocal && blob) await cacheOffline(blob, meta);
    console.error("Upload failed:", e);
    UI.toast("Offline or failed — queued.", "info");
    const progressEl = UI.$("#upload-progress");
    if (progressEl) progressEl.style.width = "0%";
  }
}

// ✅ Fix: Restored Full Implementation
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

  if (!all.length) return;

  UI.toast(`Uploading ${all.length} queued file(s)...`, "info");

  for (const item of all) {
    try {
      if (!UI.storage || !UI.db || !UI.currentUser) break;
      
      await uploadFile(item.blob, item.meta);

      await new Promise((res, rej) => {
        const deleteTx = dbx.transaction(UI.IDB_STORE, "readwrite");
        deleteTx.objectStore(UI.IDB_STORE).delete(item.id);
        deleteTx.oncomplete = res;
        deleteTx.onerror = () => rej(deleteTx.error);
      });
      
      UI.toast("Queued file uploaded!", "success");
    } catch (e) {
      console.error("Failed to flush item:", item.id, e);
    }
  }
}

/* ========================================================================== */
/* Class / Event Helpers (Restored)
/* ========================================================================== */

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
  }
}

export async function handleSaveClass() {
  if (!UI.db || !UI.currentUser) return;
  
  const title = UI.$("#class-title").value.trim();
  if (!title) { UI.toast("Title required.", "error"); return; }
  
  const participants = UI.$("#class-roster").value.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const archiveDate = UI.$("#class-archive-date").value || null;
  const deleteDate = UI.$("#class-delete-date").value || null;
  const selectedClassId = UI.$("#classes-list").value;

  const payload = { title, participants, archiveDate, deleteDate, updatedAt: serverTimestamp() };

  try {
    let newDocId = null;
    if (selectedClassId) {
      await updateDoc(doc(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/classes`, selectedClassId), payload);
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
    console.error(e);
    UI.toast("Save failed.", "error");
  }
}

export async function handleArchiveClass() {
  const id = UI.$("#classes-list").value;
  if (!id) return;
  try {
    await updateDoc(doc(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/classes`, id), {
      archived: true,
      updatedAt: serverTimestamp()
    });
    UI.toast("Class archived.", "success");
    await refreshClassesList();
    UI.clearClassEditor();
  } catch (e) {
    console.error(e);
    UI.toast("Archive failed.", "error");
  }
}

/* ========================================================================== */
/* Library Management
/* ========================================================================== */

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
      const id = d.id;

      const created = v.createdAt?.seconds
        ? new Date(v.createdAt.seconds * 1000)
        : (v.createdAt?.toDate ? v.createdAt.toDate() : null);

      const dateStr = created ? created.toLocaleDateString() : "—";
      const sizeStr = ((v.fileSize || 0) / 1024 / 1024).toFixed(1) + " MB";

      const isLocal = v.isLocal || v.storagePath === "local" || !v.downloadURL;
      const isDrive = v.downloadURL && v.downloadURL.includes("drive.google.com");

      // Rubric Badge
      const rubricBadge = v.rubricTitle 
        ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20 ml-2">${v.rubricTitle}</span>`
        : ``;

      const li = document.createElement("div");
      li.className = "p-4 bg-white/5 border border-white/10 rounded-xl mb-3 flex flex-col gap-3 transition-all hover:bg-white/10";

      let badge = "";
      let action = "";

      if (isLocal) {
        badge = `<span class="px-2 py-0.5 text-[10px] rounded bg-yellow-500/20 border border-yellow-500/40 text-yellow-200 uppercase tracking-wide">LOCAL ONLY</span>`;
        action = `<button class="text-yellow-400 text-sm hover:text-yellow-300 hover:underline flex items-center gap-2" data-open-local="true" data-title="${v.participant}">📂 Open File</button>`;
      } else if (isDrive) {
        badge = `<span class="px-2 py-0.5 text-[10px] rounded bg-green-500/20 border border-green-500/40 text-green-200 uppercase tracking-wide">GOOGLE DRIVE</span>`;
        action = `<a href="${v.downloadURL}" target="_blank" class="text-green-400 text-sm hover:underline flex items-center gap-1">↗ Open Drive</a>`;
      } else {
        badge = `<span class="px-2 py-0.5 text-[10px] rounded bg-blue-500/20 border border-blue-500/40 text-blue-200 uppercase tracking-wide">CLOUD</span>`;
        action = `<button class="text-primary-300 text-sm hover:underline flex items-center gap-1" data-play-url="${v.downloadURL}" data-title="${v.participant}">▶ Play Video</button>`;
      }

      // Scoring Payload
      const scorePayload = encodeURIComponent(JSON.stringify({ id, ...v }));

      li.innerHTML = `
        <div class="flex justify-between items-start">
          <div class="flex flex-col">
            <div class="font-semibold text-white text-base">
              ${v.classEventTitle || "Untitled"} — ${v.participant}
            </div>
            <div class="text-xs text-gray-400 mt-1 flex flex-wrap items-center gap-1">
              <span>${dateStr}</span><span>•</span><span>${v.recordingType || "Presentation"}</span><span>•</span><span>${sizeStr}</span>
              ${rubricBadge}
            </div>
          </div>
          ${badge}
        </div>
        <div class="flex justify-between items-center border-t border-white/10 pt-3 mt-1">
          <div class="flex items-center gap-4 flex-wrap">
            ${action}
            ${v.hasScore
              ? `<button class="text-green-400 text-sm hover:text-green-300 hover:underline flex items-center gap-1" data-score-video="${scorePayload}">✔ Scored (${v.lastScore || v.totalScore} pts)</button>`
              : `<button class="text-amber-400 text-sm hover:text-amber-300 hover:underline flex items-center gap-1" data-score-video="${scorePayload}">⭐ Score</button>`
            }
          </div>
          <button class="text-sm text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors" data-del="${id}">🗑 Delete</button>
        </div>
      `;
      listEl.appendChild(li);
    });

  } catch (e) {
    console.error("Error loading library:", e);
    listEl.innerHTML = '<p class="text-sm text-red-400 py-3">Error loading library.</p>';
  }
}

export async function handleDeleteVideo(docId) {
  if (!UI.db || !UI.storage || !UI.currentUser) return;
  
  const confirmed = await UI.showConfirm("Are you sure you want to permanently delete this video?", "Delete Video?", "Delete");
  if (!confirmed) return;

  const ref = doc(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`, docId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const { storagePath, fileSize } = snap.data();
      if (storagePath && storagePath !== "local") {
        await deleteObject(sRef(UI.storage, storagePath)).catch(e => console.warn(e));
      }
      await deleteDoc(ref);
      await updateUserStorageQuota(-fileSize);
      UI.toast("Video deleted.", "success");
      loadLibrary();
    }
  } catch (e) {
    console.error("Delete failed:", e);
    UI.toast("Delete failed.", "error");
  }
}

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

export async function openScoringForVideo(videoId) {
  if (!UI.db || !UI.currentUser) {
    UI.toast("Not signed in.", "error");
    return;
  }

  const ref = doc(
    UI.db,
    `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`,
    videoId
  );

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      UI.toast("Video not found.", "error");
      return;
    }

    const video = { id: snap.id, ...snap.data() };

    // 1️⃣ Critical for Save Score
    Record.setCurrentLibraryVideoId(video.id);

    // 2️⃣ Resolve rubric
    let rubric = null;
    if (video.rubricId) {
      const rSnap = await getDoc(
        doc(
          UI.db,
          `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/rubrics`,
          video.rubricId
        )
      );
      if (rSnap.exists()) rubric = { id: rSnap.id, ...rSnap.data() };
    }

    if (!rubric) {
      rubric = Rubrics.getActiveRubric();
      if (!rubric) {
        UI.toast("No rubric attached. Select one in Rubrics tab.", "warn");
        return;
      }
    }

    // 3️⃣ 🔑 Make rubric globally active
    Rubrics.setActiveRubric(rubric.id, rubric);

    // 4️⃣ Prepare saved scores
    const existingScores = {
      scores: video.finalScores || {},
      notes: video.rowNotes || {}
    };

    // 5️⃣ Open video
    if (video.downloadURL) {
      UI.openVideoPlayer(video.downloadURL, video.participant);
    }

    // 6️⃣ Show scoring UI shell
    UI.renderScoringUI({ rubric, existingScores });

    // ✅ 7️⃣ ACTUALLY RENDER ROWS (THIS WAS MISSING)
    Record.renderLiveScoringFromRubric(existingScores);

    const playerScreen = document.getElementById("player-screen");
    if (playerScreen) playerScreen.classList.remove("hidden");

  } catch (e) {
    console.error("Error opening scoring:", e);
    UI.toast("Could not open scoring.", "error");
  }
}

/* ========================================================================== */
/* 🔗 BRIDGE: BACKWARD COMPATIBILITY
/* Redirects old main.js calls to the new Rubrics module
/* ========================================================================== */

export async function handleSaveNewRubric() { 
  console.log("Bridge: Delegating to Rubrics.saveRubric()");
  return Rubrics.saveRubric(); 
}

export async function refreshMyRubrics() { 
  console.log("Bridge: Delegating to Rubrics.loadSavedRubrics()");
  return Rubrics.loadSavedRubrics(); 
}

// Ensure these are available globally if your HTML onclicks use them
window.handleSaveNewRubric = handleSaveNewRubric;
window.refreshMyRubrics = refreshMyRubrics;