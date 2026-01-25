/* ========================================================================== */
/* MODULE: firestore.js (FINAL: Filtering + Caching + Offline Support)
/* Handles all Firestore interactions (read/write/upload) & Library rendering.
/* ========================================================================== */

import * as UI from "./ui.js"; 

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
  getFirestore, collection, doc, addDoc, setDoc, getDoc, getDocs, 
  updateDoc, deleteDoc, query, orderBy, serverTimestamp, enableIndexedDbPersistence 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { 
  getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

/* -------------------------------------------------------------------------- */
/* STATE MANAGEMENT (For Filtering)
/* -------------------------------------------------------------------------- */
let LIBRARY_CACHE = []; // Stores videos
let RUBRIC_CACHE = {};  // Stores rubric titles

/* -------------------------------------------------------------------------- */
/* Initialization
/* -------------------------------------------------------------------------- */
export async function initFirebase() {
  try {
    const configStr = localStorage.getItem(UI.LS.CFG);
    if (!configStr) return false;

    const config = JSON.parse(configStr);
    const app = initializeApp(config);
    const db = getFirestore(app);
    const storage = getStorage(app);
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
    
    // EXPOSE HELPERS GLOBALLY FOR HTML ONCHANGE EVENTS
    window.renderLibraryFiltered = renderLibraryFiltered;
    window.resetLibraryFilters = resetLibraryFilters;
    
    return true;
  } catch (e) {
    console.error("Firebase Init Error:", e);
    return false;
  }
}

export async function loadClasses() {
  if (!UI.db || !UI.currentUser) return {};

  const q = query(
    collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/classes`)
  );

  const snapshot = await getDocs(q);
  const classes = {};

  snapshot.forEach(docSnap => {
    classes[docSnap.id] = {
      id: docSnap.id,
      ...docSnap.data()
    };
  });

  console.log("[DB] loadClasses result:", classes);

  return classes;
}


/* -------------------------------------------------------------------------- */
/* Class / Event Management
/* -------------------------------------------------------------------------- */
export async function refreshClassesList() {
  const list = UI.$("#classes-list");
  if (!list) return;

  list.innerHTML = "<option>Loading...</option>";

  try {
    // 🔹 Get already-loaded class data (Firestore no longer renders UI)
    const classData = UI.classData || {};

    list.innerHTML = '<option value="">-- Select a Class to Edit --</option>';

    Object.values(classData).forEach(cls => {
      const opt = document.createElement("option");
      opt.value = cls.id;
      opt.textContent = `${cls.title}${cls.archived ? " (Archived)" : ""}`;
      list.appendChild(opt);
    });

  } catch (e) {
    console.error("Error rendering classes:", e);
    UI.toast("Failed to load classes.", "error");
  }
}


export async function saveClass({ id, title, participants }) {
  const colRef = collection(
    db,
    `artifacts/${getAppId()}/users/${currentUser.uid}/classes`
  );

  if (id) {
    await updateDoc(doc(colRef, id), {
      title,
      participants,
      updatedAt: serverTimestamp()
    });
  } else {
    await addDoc(colRef, {
      title,
      participants,
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
}


// firestore.js
export async function archiveClass({ db, appId, uid, id }) {
  if (!db) throw new Error("archiveClass: db missing");
  if (!appId) throw new Error("archiveClass: appId missing");
  if (!uid) throw new Error("archiveClass: uid missing");
  if (!id) throw new Error("archiveClass: id missing");

  await updateDoc(
    doc(db, `artifacts/${appId}/users/${uid}/classes`, id),
    { archived: true }
  );
}


/* -------------------------------------------------------------------------- */
/* File Upload & Metadata
/* -------------------------------------------------------------------------- */
export async function uploadFile(blob, metadata) {
  if (!UI.db || !UI.currentUser) throw new Error("Not signed in.");
  if (!blob) throw new Error("CRITICAL: uploadFile called without blob.");

  const appId = UI.getAppId();
  const newDocRef = doc(collection(UI.db, `artifacts/${appId}/users/${UI.currentUser.uid}/videos`));
  const videoId = newDocRef.id;
  const filename = `${videoId}_${Date.now()}.webm`;
  const storagePath = `artifacts/${appId}/users/${UI.currentUser.uid}/videos/${filename}`;
  
  // Set Content Type
  const contentType = blob.type || "video/webm";
  const uploadMeta = { contentType };

  UI.$("#upload-progress-container")?.classList.remove("hidden");

  try {
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
/* Smart Save
/* -------------------------------------------------------------------------- */
export async function saveRecording(meta, blob) {
  if (!Array.isArray(meta.participants) || meta.participants.length === 0) {
    return await uploadFile(blob, meta);
  }

  const uniqueParticipants = [...new Set(meta.participants.map(p => p?.trim()).filter(Boolean))];
  if (uniqueParticipants.length < 2) throw new Error("GROUP_REQUIRES_2");

  const primaryStudent = uniqueParticipants[0];
  const { participants, ...safeMeta } = meta;

  const baseMeta = { ...safeMeta, participant: primaryStudent, isGroup: true };
  const uploadResult = await uploadFile(blob, baseMeta);

  const remaining = uniqueParticipants.slice(1);
  const colRef = collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`);

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
/* Offline Handling (RESTORED FROM CODE 1)
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
      
      const clearTx = db.transaction(UI.IDB_STORE, "readwrite");
      clearTx.objectStore(UI.IDB_STORE).clear();

      for (const item of items) {
        try {
            if (item.metadata?.storagePath === "local") continue;
            await uploadFile(item.blob, item.metadata);
        } catch (err) {
            console.error("Offline item upload failed:", err);
        }
      }
    };
  };
}

/* -------------------------------------------------------------------------- */
/* Library Management (NEW: Fetch -> Cache -> Render)
/* -------------------------------------------------------------------------- */
export async function loadLibrary() {
  if (!UI.db || !UI.currentUser) return;
  const listEl = UI.$("#library-list");
  if (!listEl) return;
  
  listEl.innerHTML = '<p class="text-center text-gray-400">Loading library...</p>';

  try {
    // 1. Fetch Videos (Fetch Once)
    const q = query(
      collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`), 
      orderBy("recordedAt", "desc") 
    );
    const snap = await getDocs(q);
    
    // 2. Cache Videos
    LIBRARY_CACHE = [];
    snap.forEach(d => LIBRARY_CACHE.push({ id: d.id, ...d.data() }));

    // 3. Fetch & Cache Rubrics
    RUBRIC_CACHE = {};
    try {
        const rSnap = await getDocs(collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/rubrics`));
        rSnap.forEach(d => {
            RUBRIC_CACHE[d.id] = d.data().title || "Untitled Rubric";
        });
    } catch (rubricErr) { console.warn("Library: Could not fetch rubrics", rubricErr); }

    // 4. Populate Dropdowns (Only if cache has data)
    populateLibraryFilters();

    // 5. Initial Render
    renderLibraryFiltered();

  } catch (e) {
    console.error("Library load error:", e);
    listEl.innerHTML = '<p class="text-center text-red-400">Failed to load library.</p>';
  }
}

// ✅ NEW: Populates the <select> menus based on actual data
function populateLibraryFilters() {
    const classSelect = document.getElementById("lib-filter-class");
    const rubricSelect = document.getElementById("lib-filter-rubric");

    if (classSelect) {
        // preserve selection if re-populating, else "all"
        const currentVal = classSelect.value;
        const classes = [...new Set(LIBRARY_CACHE.map(v => v.classEventTitle).filter(Boolean))].sort();
        
        classSelect.innerHTML = `<option value="all">All Classes</option>`;
        classes.forEach(c => {
            classSelect.innerHTML += `<option value="${c}">${c}</option>`;
        });
        classSelect.value = classes.includes(currentVal) ? currentVal : "all";
    }

    if (rubricSelect) {
        const currentVal = rubricSelect.value;
        const usedRubricIds = [...new Set(LIBRARY_CACHE.map(v => v.rubricId).filter(Boolean))];
        
        rubricSelect.innerHTML = `<option value="all">All Rubrics</option>`;
        usedRubricIds.forEach(id => {
            if (RUBRIC_CACHE[id]) {
                rubricSelect.innerHTML += `<option value="${id}">${RUBRIC_CACHE[id]}</option>`;
            }
        });
        rubricSelect.value = usedRubricIds.includes(currentVal) ? currentVal : "all";
    }
}

// ✅ NEW: Reads filters and draws the list
export function renderLibraryFiltered() {
    const listEl = UI.$("#library-list");
    if (!listEl) return;

    // 1. Read Filter Values
    const classFilter = document.getElementById("lib-filter-class")?.value || "all";
    const rubricFilter = document.getElementById("lib-filter-rubric")?.value || "all";

    // 2. Filter Data
    const filtered = LIBRARY_CACHE.filter(v => {
        const matchClass = (classFilter === "all") || (v.classEventTitle === classFilter);
        const matchRubric = (rubricFilter === "all") || (v.rubricId === rubricFilter);
        return matchClass && matchRubric;
    });

    // 3. Render
    if (filtered.length === 0) {
        listEl.innerHTML = '<p class="text-center text-gray-500 py-8">No recordings match your filters.</p>';
        return;
    }

    listEl.innerHTML = "";
    
    filtered.forEach((v) => {
      const card = document.createElement("div");
      card.className = "bg-black/30 border border-white/10 rounded-lg p-4 mb-4 flex flex-col gap-2 animate-fade-in";
      
      const title = document.createElement("div");
      title.className = "font-semibold text-white";
      
      const primaryName = v.participant || "Unknown";
      let groupBadge = "";
      const gName = v.groupName || v.group;
      if ((v.isGroup || v.recordingType === 'group') && gName) {
          groupBadge = ` <span class="ml-2 text-xs text-primary-400 font-normal bg-primary-500/10 px-1.5 py-0.5 rounded">👥 ${gName}</span>`;
      }

      title.innerHTML = `${v.classEventTitle || "Untitled"} — ${primaryName}${groupBadge}`;
      
      let dateStr = "Unknown Date";
      if (v.recordedAt) {
          const dateObj = v.recordedAt.toDate ? v.recordedAt.toDate() : new Date(v.recordedAt);
          dateStr = dateObj.toLocaleDateString();
      }
      
      const rubricTitle = (v.rubricId && RUBRIC_CACHE[v.rubricId]) 
         ? RUBRIC_CACHE[v.rubricId] 
         : "No Rubric Selected";

      const meta = document.createElement("div");
      meta.className = "text-xs text-gray-400 flex items-center gap-2 flex-wrap";
      meta.innerHTML = `
        <span class="text-primary-300 bg-primary-500/10 border border-primary-500/20 px-1.5 py-0.5 rounded font-medium">${rubricTitle}</span>
        <span>•</span>
        <span>${dateStr}</span> 
        <span>•</span> 
        <span>${(v.fileSize / 1024 / 1024).toFixed(1)} MB</span>
      `;
      
      const actions = document.createElement("div");
      actions.className = "flex items-center gap-4 mt-2";

      const playBtn = document.createElement("button");
      playBtn.className = "text-cyan-400 hover:underline text-sm";
      playBtn.textContent = v.downloadURL ? "▶ Play Video" : "📂 Open File";
      playBtn.onclick = () => UI.openScoringForVideo(v.id);

      const scoreBtn = document.createElement("button");
      scoreBtn.className = "text-green-400 hover:underline text-sm";
      scoreBtn.textContent = v.hasScore ? `✓ Scored (${v.totalScore || 0} pts)` : "Score";
      scoreBtn.onclick = () => UI.openScoringForVideo(v.id);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "ml-auto text-red-400 hover:underline text-sm";
      deleteBtn.textContent = "Delete";
      deleteBtn.onclick = () => deleteVideo(v.id);

      actions.appendChild(playBtn);
      actions.appendChild(scoreBtn);
      actions.appendChild(deleteBtn);

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(actions);

      listEl.appendChild(card);
    });
}

// ✅ NEW: Reset Helper
export function resetLibraryFilters() {
    const c = document.getElementById("lib-filter-class");
    const r = document.getElementById("lib-filter-rubric");
    if(c) c.value = "all";
    if(r) r.value = "all";
    renderLibraryFiltered();
}

/* -------------------------------------------------------------------------- */
/* Delete & Helpers
/* -------------------------------------------------------------------------- */
export async function deleteVideo(id) {
  const docRef = doc(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`, id);
  const snap = await getDoc(docRef);
  
  if (!snap.exists()) {
      UI.toast("Video already deleted.", "info");
      loadLibrary();
      return;
  }

  const data = snap.data();
  const isLocal = data.storagePath === "local";

  let confirmMsg = "Delete this recording permanently?\n(Cannot be undone)";
  if (isLocal) {
      confirmMsg = "⚠️ Remove from App Library?\n\nThis will remove the data and score from Analytics, but the video file will REMAIN on your computer's hard drive.";
  }

  if (!await UI.showConfirm(confirmMsg, "Delete Video?", "Delete")) return;

  try {
    if (!isLocal && data.storagePath) {
         const sRef = ref(UI.storage, data.storagePath);
         await deleteObject(sRef).catch(e => console.warn("Storage delete failed", e));
    }
    await deleteDoc(docRef);
    UI.toast("Video deleted.", "success");
    loadLibrary(); 
  } catch (e) {
    console.error("Delete failed:", e);
    UI.toast("Could not delete video.", "error");
  }
}

export function handleOpenLocalVideo(title) {
    UI.toast("Please use the 'Open File' button on a library card.", "info");
}

export async function handleScoringSubmit(data) {
  console.warn("handleScoringSubmit called via DB but should be handled by Record.js listener.");
}

export async function saveLocalData(meta) {
    if (!UI.db || !UI.currentUser) return;
    const appId = UI.getAppId();
    const userUid = UI.currentUser.uid;
    const colRef = collection(UI.db, `artifacts/${appId}/users/${userUid}/videos`);

    const createDoc = async (participantName) => {
        const newDocRef = doc(colRef);
        await setDoc(newDocRef, {
            ...meta,
            participant: participantName,
            id: newDocRef.id,
            storagePath: "local", 
            downloadURL: null,    
            createdAt: serverTimestamp(),
            status: "ready"
        });
    };

    if (meta.participants && meta.participants.length > 0) {
        const promises = meta.participants.map(student => createDoc(student));
        await Promise.all(promises);
    } else {
        await createDoc(meta.participant);
    }
}