/* ==========================================================================
 * MODULE: firestore.js (FINAL GOLD: Polished & Verified)
 * Handles all Firestore interactions (read/write/upload), Library rendering,
 * Offline Queue, Smart Delete, and Class Management.
 * ========================================================================== */

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
/* STATE MANAGEMENT */
/* -------------------------------------------------------------------------- */
let LIBRARY_CACHE = []; // Stores videos
let RUBRIC_CACHE = {};  // Stores rubric titles

/* -------------------------------------------------------------------------- */
/* Initialization */
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
    window.duplicateVideo = duplicateVideo;
    window.openEditVideo = openEditVideo;
    window.deleteVideo = deleteVideo;
    
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
  return classes;
}

/* -------------------------------------------------------------------------- */
/* Class / Event Management */
/* -------------------------------------------------------------------------- */
export async function refreshClassesList() {
  const list = UI.$("#classes-list");
  if (!list) return;

  list.innerHTML = "<option>Loading...</option>";

  try {
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

export async function handleSaveClass() {
  const id = UI.$("#classes-list").value;
  const title = UI.$("#class-title").value.trim();
  const rosterStr = UI.$("#class-roster").value.trim();
  
  // ✅ Capture Date Inputs from UI
  const archiveDate = UI.$("#class-archive-date").value;
  const deleteDate = UI.$("#class-delete-date").value;
  
  if (!title) {
    UI.toast("Class title is required.", "error");
    return;
  }

  const participants = rosterStr 
    ? rosterStr.split("\n").map(s => s.trim()).filter(s => s) 
    : [];

  const classData = {
      title,
      participants,
      archiveDate, 
      deleteDate,  
      updatedAt: serverTimestamp()
  };

  try {
    const colRef = collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/classes`);
    
    if (id) {
      await updateDoc(doc(colRef, id), classData);
      UI.toast("Class updated!", "success");
    } else {
      await addDoc(colRef, {
        ...classData,
        archived: false,
        createdAt: serverTimestamp()
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

// ✅ FIX: Safer Rename (Doesn't wipe roster if participants undefined)
export async function handleRenameClass({ classId, newTitle, participants }) {
  if (!classId || !newTitle) throw new Error("Missing rename data");

  const updates = { title: newTitle, updatedAt: serverTimestamp() };
  if (Array.isArray(participants)) updates.participants = participants;

  const docRef = doc(
    UI.db,
    `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/classes`,
    classId
  );

  await updateDoc(docRef, updates);

  // Update Local Cache
  if (UI.classData && UI.classData[classId]) {
      UI.classData[classId].title = newTitle;
      if (Array.isArray(participants)) UI.classData[classId].participants = participants;
  }

  UI.toast("Class renamed.", "success");
  refreshClassesList();
}

export async function archiveClass({ db, appId, uid, id }) {
  if (!db || !appId || !uid || !id) throw new Error("archiveClass: missing params");

  await updateDoc(
    doc(db, `artifacts/${appId}/users/${uid}/classes`, id),
    { archived: true }
  );
}

/* -------------------------------------------------------------------------- */
/* File Upload & Metadata (Fixed: Header Safe Content-Type + Offline Queue) */
/* -------------------------------------------------------------------------- */
export async function uploadFile(blob, metadata) {
  if (!UI.db || !UI.currentUser) throw new Error("Not signed in.");
  if (!blob) throw new Error("NO_BLOB");

  // ---- HARD TOKEN REFRESH (REQUIRED) ----
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("AUTH_LOST");

  // 🔑 THIS is mandatory
  await user.getIdToken(true);

  // ---- STORAGE LIMIT CHECK ----
  const limit = UI.userDoc?.planStorageLimit ?? 1_000_000_000;
  const used  = UI.userDoc?.storageUsedBytes ?? 0;
  if (used + blob.size > limit) {
    throw new Error("STORAGE_LIMIT_EXCEEDED");
  }

  const appId = UI.getAppId();
  const videoRef = doc(
    collection(UI.db, `artifacts/${appId}/users/${user.uid}/videos`)
  );

  const videoId = videoRef.id;
  const storagePath =
    `artifacts/${appId}/users/${user.uid}/videos/${videoId}.webm`;

  const storageRef = ref(UI.storage, storagePath);

  const metadataSafe = {
    contentType: "video/webm",
    customMetadata: {
      participant: String(metadata.participant ?? "Unknown"),
      class_title: String(metadata.classEventTitle ?? "Unknown"),
    }
  };

  UI.$("#upload-progress-container")?.classList.remove("hidden");

  try {
    // 🚫 DO NOT touch blob
    const uploadTask = uploadBytesResumable(
      storageRef,
      blob,
      metadataSafe
    );

    await new Promise((resolve, reject) => {
      uploadTask.on(
        "state_changed",
        snap => {
          const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
          const bar = UI.$("#upload-progress");
          if (bar) bar.style.width = `${pct}%`;
        },
        reject,
        resolve
      );
    });

    const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

    await setDoc(videoRef, {
      ...metadata,
      id: videoId,
      storagePath,
      downloadURL,
      fileSize: blob.size,
      createdAt: serverTimestamp(),
      status: "ready"
    });

    UI.mockUpdateStorageUsage?.(used + blob.size);

    return { id: videoId, storagePath, downloadURL };

  } catch (err) {
    console.error("UPLOAD FAILED:", err);

    if (!navigator.onLine) {
      await saveToOfflineQueue(blob, metadata);
      return { queued: true };
    }

    throw err;

  } finally {
    UI.$("#upload-progress-container")?.classList.add("hidden");
  }
}

/* -------------------------------------------------------------------------- */
/* Smart Save (Routes Single vs. Group Logic) */
/* -------------------------------------------------------------------------- */
export async function saveRecording(meta, blob) {
    if (!blob) throw new Error("NO_BLOB");

    // ✅ FIX: Robust Group Detection (Prevents "1-person group" crash)
    if (meta.recordingType !== "group" || !Array.isArray(meta.participants) || meta.participants.length <= 1) {
        return await uploadFile(blob, meta);
    }

    // --- GROUP LOGIC (Only runs if 2+ people) ---
    const participants = Array.isArray(meta.participants)
       ? [...new Set(meta.participants.map(p => p?.trim()).filter(Boolean))]
       : [];

    if (participants.length < 2) throw new Error("GROUP_REQUIRES_2");

    // Identify Primary Student
    const primaryStudent = participants[0];
    const { participants: _, ...safeMeta } = meta;

    // Upload ONCE for the primary student
    const baseMeta = { ...safeMeta, participant: primaryStudent, isGroup: true };
    const uploadResult = await uploadFile(blob, baseMeta);

    // Create "Reference Copies" for everyone else
    const remaining = participants.slice(1);
    const colRef = collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`);

    const writes = remaining.map(student => {
        return addDoc(colRef, {
            ...baseMeta,
            id: undefined, 
            participant: student, 
            
            storagePath: uploadResult.storagePath,
            downloadURL: uploadResult.downloadURL, 
            isDuplicate: true, 
            originalVideoId: uploadResult.id,
            
            createdAt: serverTimestamp(),
            status: "ready"
        });
    });

    await Promise.all(writes);
    return uploadResult;
}

/* -------------------------------------------------------------------------- */
/* Offline Handling */
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

/* -------------------------------------------------------------------------- */
/* Library Management (Fetch -> Cache -> Render) */
/* -------------------------------------------------------------------------- */
export async function loadLibrary() {
  if (!UI.db || !UI.currentUser) return;
  const listEl = UI.$("#library-list");
  if (!listEl) return;
  
  listEl.innerHTML = '<p class="text-center text-gray-400">Loading library...</p>';

  try {
    // 1. Fetch Videos
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

    // 4. Populate Dropdowns
    populateLibraryFilters();

    // 5. Initial Render
    renderLibraryFiltered();

  } catch (e) {
    console.error("Library load error:", e);
    listEl.innerHTML = '<p class="text-center text-red-400">Failed to load library.</p>';
  }
}

function populateLibraryFilters() {
    const classSelect = document.getElementById("lib-filter-class");
    const rubricSelect = document.getElementById("lib-filter-rubric");

    if (classSelect) {
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

// ✅ NEW: Reads filters and draws the list (With Duplicate & Edit Buttons)
export function renderLibraryFiltered() {
    const listEl = UI.$("#library-list");
    if (!listEl) return;

    // 1. Read Filter Values
    const classFilter = document.getElementById("lib-filter-class")?.value || "all";
    const rubricFilter = document.getElementById("lib-filter-rubric")?.value || "all";

    // 2. Filter Data
    if (!Array.isArray(LIBRARY_CACHE)) return;

    const filtered = LIBRARY_CACHE.filter(v => {
        const matchClass = (classFilter === "all") || (v.classEventTitle === classFilter);
        const matchRubric = (rubricFilter === "all") || (v.rubricId === rubricFilter);
        return matchClass && matchRubric;
    });

    if (filtered.length === 0) {
        listEl.innerHTML = '<p class="text-center text-gray-500 py-8">No recordings match your filters.</p>';
        return;
    }

    listEl.innerHTML = "";
    
    filtered.forEach((v) => {
      const card = document.createElement("div");
      card.className = "bg-black/30 border border-white/10 rounded-lg p-4 mb-4 flex flex-col gap-2 animate-fade-in group"; 
      
      const title = document.createElement("div");
      title.className = "font-semibold text-white flex justify-between";
      
      const primaryName = v.participant || "Unknown";
      let groupBadge = "";
      const gName = v.groupName || v.group;
      if ((v.isGroup || v.recordingType === 'group') && gName) {
          groupBadge = ` <span class="ml-2 text-xs text-primary-400 font-normal bg-primary-500/10 px-1.5 py-0.5 rounded">👥 ${gName}</span>`;
      }
      
      // Duplicate Badge
      const dupBadge = v.isDuplicate ? ` <span class="ml-2 text-[10px] text-amber-300 border border-amber-500/30 px-1 rounded uppercase tracking-wide">Copy</span>` : "";

      title.innerHTML = `<span>${v.classEventTitle || "Untitled"} — ${primaryName}${groupBadge}${dupBadge}</span>`;
      
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
      
      // ✅ FIX: Safe File Size (Prevent NaN)
      const sizeMB = v.fileSize ? (v.fileSize / 1024 / 1024).toFixed(1) : "—";

      meta.innerHTML = `
        <span class="text-primary-300 bg-primary-500/10 border border-primary-500/20 px-1.5 py-0.5 rounded font-medium">${rubricTitle}</span>
        <span>•</span>
        <span>${dateStr}</span> 
        <span>•</span> 
        <span>${sizeMB} MB</span>
      `;
      
      const actions = document.createElement("div");
      actions.className = "flex items-center gap-3 mt-2";

      // 1. Play
      const playBtn = document.createElement("button");
      playBtn.className = "text-cyan-400 hover:text-cyan-300 text-sm font-medium flex items-center gap-1";
      playBtn.innerHTML = v.downloadURL ? "▶ Play" : "📂 Open";
      playBtn.onclick = () => UI.openScoringForVideo(v.id);

      // 2. Score
      const scoreBtn = document.createElement("button");
      scoreBtn.className = "text-green-400 hover:text-green-300 text-sm font-medium flex items-center gap-1";
      scoreBtn.innerHTML = v.hasScore ? `✓ ${v.totalScore} pts` : "✎ Score";
      scoreBtn.onclick = () => UI.openScoringForVideo(v.id);

      // 3. COPY (New)
      const copyBtn = document.createElement("button");
      copyBtn.className = "ml-auto text-gray-500 hover:text-white transition-colors p-1.5 rounded hover:bg-white/10";
      copyBtn.title = "Duplicate / Re-Assess\n• Creates a fresh scorecard for this video.\n• Perfect for '2 Birds, 1 Stone'.";
      copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5" /></svg>`;
      copyBtn.onclick = () => duplicateVideo(v.id);

      // 4. EDIT (New)
      const editBtn = document.createElement("button");
      editBtn.className = "text-gray-500 hover:text-white transition-colors p-1.5 rounded hover:bg-white/10";
      editBtn.title = "Edit Details\n• Change the Student, Class or Rubric.\n⚠️ Warning: Changing the rubric resets the score.";
      editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" /></svg>`;
      editBtn.onclick = () => openEditVideo(v.id);

      // 5. Delete
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "text-gray-500 hover:text-red-400 transition-colors p-1.5 rounded hover:bg-white/10";
      deleteBtn.title = "Delete this record";
      deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>`;
      deleteBtn.onclick = () => deleteVideo(v.id);

      actions.appendChild(playBtn);
      actions.appendChild(scoreBtn);
      actions.appendChild(copyBtn);
      actions.appendChild(editBtn);
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

export function handleOpenLocalVideo(title) {
    UI.toast("Please use the 'Open File' button on a library card.", "info");
}

export async function handleScoringSubmit(data) {
  console.warn("handleScoringSubmit called via DB but should be handled by Record.js listener.");
}

/* ========================================================================== */
/* PHASE B: VIDEO LIFECYCLE TOOLS (Duplicate, Edit, Safe Delete)
/* ========================================================================== */

// 1. DUPLICATE VIDEO ("2 Birds, 1 Stone")
export async function duplicateVideo(originalId) {
    if (!originalId || !Array.isArray(LIBRARY_CACHE)) {
        UI.toast("Library not ready. Please wait.", "error"); 
        return; 
    }
    
    const original = LIBRARY_CACHE.find(v => v.id === originalId);
    if (!original) { UI.toast("Original video not found.", "error"); return; }

    const confirmMsg = `Duplicate this video?\n\nThis creates a NEW scorecard for "${original.participant}" linked to the SAME video file.\n\nUseful for:\n1. Grading the same student on a second rubric.\n2. Grading a group member using this same recording.`;
    
    if (!await UI.showConfirm(confirmMsg, "Duplicate Video", "Duplicate")) return;

    try {
        const colRef = collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`);
        
        const newDocData = {
            storagePath: original.storagePath,
            downloadURL: original.downloadURL,
            fileSize: original.fileSize || 0,
            duration: original.duration || 0,
            recordedAt: original.recordedAt,
            
            participant: original.participant, // Don't change the name!
            classEventTitle: original.classEventTitle || "",
            rubricId: original.rubricId || "",
            recordingType: original.recordingType || "individual",
            isGroup: original.isGroup || false,
            groupName: original.groupName || null,

            isDuplicate: true,
            originalVideoId: originalId,
            status: "ready",
            createdAt: serverTimestamp(),

            totalScore: 0,
            finalScores: {},
            rowNotes: {},
            hasScore: false
        };

        const newDocRef = await addDoc(colRef, newDocData);

        UI.toast("Video duplicated!", "success");
        await loadLibrary(); 
        openEditVideo(newDocRef.id);

    } catch (e) {
        console.error("Duplicate failed:", e);
        UI.toast("Failed to duplicate.", "error");
    }
}

// 2. OPEN EDIT MODAL
export function openEditVideo(videoId) {
    if (!Array.isArray(LIBRARY_CACHE)) return;

    const video = LIBRARY_CACHE.find(v => v.id === videoId);
    if (!video) return;

    const modal = document.getElementById("edit-video-modal");
    const idInput = document.getElementById("edit-video-id");
    const nameInput = document.getElementById("edit-video-participant");
    const classSelect = document.getElementById("edit-video-class");
    const rubricSelect = document.getElementById("edit-video-rubric");
    
    if (!modal) return;

    idInput.value = videoId;
    nameInput.value = video.participant || "";
    
    classSelect.innerHTML = '<option value="">-- No Class --</option>';
    const classes = UI.classData || {}; 
    Object.values(classes).forEach(c => {
        const sel = (c.title === video.classEventTitle) ? "selected" : "";
        classSelect.innerHTML += `<option value="${c.title}" ${sel}>${c.title}</option>`;
    });

    rubricSelect.innerHTML = '<option value="">-- No Rubric --</option>';
    Object.entries(RUBRIC_CACHE).forEach(([rId, rTitle]) => {
        const sel = (rId === video.rubricId) ? "selected" : "";
        rubricSelect.innerHTML += `<option value="${rId}" ${sel}>${rTitle}</option>`;
    });

    modal.showModal();
    
    document.getElementById("cancel-edit-btn").onclick = () => modal.close();
    document.getElementById("save-edit-btn").onclick = () => saveVideoEdits();
}

// 3. SAVE EDITS
async function saveVideoEdits() {
    const modal = document.getElementById("edit-video-modal");
    const id = document.getElementById("edit-video-id").value;
    const newName = document.getElementById("edit-video-participant").value;
    const newClass = document.getElementById("edit-video-class").value;
    const newRubricId = document.getElementById("edit-video-rubric").value;

    if (!id) return;

    const video = LIBRARY_CACHE.find(v => v.id === id);
    
    const updates = {
        participant: newName,
        classEventTitle: newClass,
        rubricId: newRubricId
    };

    if (video && video.rubricId !== newRubricId) {
        updates.totalScore = 0;
        updates.finalScores = {};
        updates.hasScore = false;
        UI.toast("Rubric changed - Score reset to 0", "info");
    }

    try {
        const docRef = doc(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`, id);
        await updateDoc(docRef, updates);
        
        UI.toast("Video updated.", "success");
        modal.close();
        loadLibrary(); 
    } catch (e) {
        console.error("Edit failed:", e);
        UI.toast("Failed to save changes.", "error");
    }
}

// 4. SMART DELETE (Protects Shared Files)
// ✅ FINAL SAFE DELETE (Uses Native Popup for Safety)
export async function deleteVideo(videoId) {
    if (!Array.isArray(LIBRARY_CACHE)) return;
    
    const video = LIBRARY_CACHE.find(v => v.id === videoId);
    if (!video) { UI.toast("Video not found.", "error"); return; }
    
    const isLocal = video.storagePath === "local";
    
    // 1. Initial Confirmation (Standard UI is fine here)
    let confirmed = false;
    if (isLocal) {
        confirmed = await UI.showConfirm("⚠️ Remove from App Library?\n\nThis will remove the data and score from Analytics, but the video file will REMAIN on your computer's hard drive.", "Delete Local Record", "Delete");
    } else {
        confirmed = await UI.showConfirm("Are you sure you want to delete this record?", "Delete Video", "Delete");
    }

    if (!confirmed) return;

    try {
        UI.toast("Deleting...", "info");

        // 2. CHECK FOR DEPENDENTS
        const othersUsingFile = LIBRARY_CACHE.filter(v => 
            v.id !== videoId && 
            v.storagePath === video.storagePath
        );

        let deleteFile = false;

        if (!isLocal && othersUsingFile.length > 0) {
            // Case A: File is shared. PROTECT IT.
            // 🛑 USE NATIVE BROWSER POPUP TO AVOID UI BUGS 🛑
            const protectConfirmed = window.confirm(
                `Protected Mode Active:\n\nThis video file is currently shared with ${othersUsingFile.length} other scorecard(s).\n\nWe will delete THIS scorecard, but the video file will remain safe for the others.\n\nClick OK to Delete Scorecard.`
            );
            
            if (!protectConfirmed) return; // User clicked Cancel
            
            deleteFile = false; 

        } else if (!isLocal) {
            // Case B: No one else uses this file. DESTROY IT.
            deleteFile = true; 
        }

        const docRef = doc(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`, videoId);
        await deleteDoc(docRef);

        if (deleteFile && video.storagePath) {
            try {
                const fileRef = ref(UI.storage, video.storagePath);
                await deleteObject(fileRef);
                console.log("File deleted from cloud.");
            } catch (err) {
                console.warn("File delete error (might already be gone):", err);
            }
        }

        UI.toast("Deleted successfully.", "success");
        await loadLibrary(); 

    } catch (e) {
        console.error("Delete failed:", e);
        UI.toast("Delete failed.", "error");
    }
}