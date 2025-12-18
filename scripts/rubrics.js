/* ========================================================================== */
/* MODULE: rubrics.js
/* Handles creation, editing, selection, and persistence of rubric definitions
/* ========================================================================== */

import * as UI from "./ui.js";
import {
  collection,
  addDoc,
  serverTimestamp,
  getDocs,
  query,
  orderBy,
  deleteDoc,
  doc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* ========================================================================== */
/* INTERNAL STATE
/* ========================================================================== */

let currentRowCount = 0;
let activeRubric = null; // Global active rubric (used by recording + library)

/* ========================================================================== */
/* 1. RUBRIC BUILDER UI
/* ========================================================================== */

export function addBuilderRow() {
  const container = UI.$("#rubric-builder-rows");
  if (!container) return;

  currentRowCount++;
  const domId = `builder-row-ui-${currentRowCount}`;

  const div = document.createElement("div");
  div.id = domId;
  div.className =
    "p-4 bg-white/5 rounded-xl border border-white/10 mb-3 relative group transition-all hover:bg-white/10";

  div.innerHTML = `
    <div class="flex gap-4 items-start">
      <div class="flex-1">
        <label class="block text-xs text-gray-400 mb-1 uppercase tracking-wide">
          Row Title
        </label>
        <input
          type="text"
          class="row-title w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white
                 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none placeholder-gray-600"
          placeholder="e.g., Argument & Analysis"
        >
      </div>

      <div class="w-24">
        <label class="block text-xs text-gray-400 mb-1 uppercase tracking-wide">
          Max Pts
        </label>
        <input
          type="number"
          class="row-max w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white text-center
                 focus:border-primary-500 outline-none"
          value="10"
          min="1"
          max="50"
        >
      </div>
    </div>

    <div class="mt-3">
      <label class="block text-xs text-gray-400 mb-1 uppercase tracking-wide">
        Score Tooltip / Description
      </label>
      <textarea
        class="row-desc w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2
               text-xs text-gray-300 h-16 resize-none focus:border-primary-500 outline-none placeholder-gray-600"
        placeholder="This text appears when hovering over score buttons (e.g. what a 4 vs 8 means)"
      ></textarea>
    </div>

    <button
      type="button"
      class="absolute top-3 right-3 text-gray-500 hover:text-red-400 transition-colors p-1"
      onclick="document.getElementById('${domId}').remove()"
      title="Remove row"
    >
      ✕
    </button>
  `;

  container.appendChild(div);
  const titleInput = div.querySelector(".row-title");
  if (titleInput) titleInput.focus();
}

/* ========================================================================== */
/* 2. SAVE RUBRIC
/* ========================================================================== */

export async function saveRubric() {
  if (!UI.db || !UI.currentUser) {
    UI.toast("You must be signed in to save rubrics.", "error");
    return;
  }

  const titleEl = UI.$("#rubric-builder-title");
  const title = titleEl?.value.trim();

  if (!title) {
    UI.toast("Please give your rubric a title.", "error");
    return;
  }

  const rows = [];
  const rowElements = document.querySelectorAll("#rubric-builder-rows > div");

  rowElements.forEach((el) => {
    const label = el.querySelector(".row-title")?.value.trim();
    const maxPoints = parseInt(el.querySelector(".row-max")?.value, 10) || 10;
    const description = el.querySelector(".row-desc")?.value.trim() || "";

    if (!label) return;

    /* ------------------------------------------------------------------
       IMPORTANT: Generate a UNIQUE ID for analytics stability.
       This ensures that even if you delete/reorder rows later, 
       old scores stay attached to the correct criteria.
    ------------------------------------------------------------------ */
    const uniqueId = `row_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    rows.push({
      id: uniqueId, 
      label,
      maxPoints,
      description
    });
  });

  if (rows.length === 0) {
    UI.toast("Add at least one scoring row.", "error");
    return;
  }

  const saveBtn = UI.$("#save-new-rubric-btn");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
  }

  try {
    const rubricsCol = collection(
      UI.db,
      `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/rubrics`
    );

    await addDoc(rubricsCol, {
      title,
      rows,
      rowCount: rows.length,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    UI.toast("Rubric saved successfully!", "success");
    resetBuilder();
    loadSavedRubrics();

  } catch (err) {
    console.error("Error saving rubric:", err);
    UI.toast("Failed to save rubric.", "error");

  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Rubric";
    }
  }
}

function resetBuilder() {
  UI.$("#rubric-builder-title").value = "";
  UI.$("#rubric-builder-rows").innerHTML = "";
  currentRowCount = 0;
  addBuilderRow();
}

/* ========================================================================== */
/* 3. LOAD & SELECT RUBRICS
/* ========================================================================== */

export async function loadSavedRubrics() {
  if (!UI.db || !UI.currentUser) return;

  const list = UI.$("#saved-rubrics-list");
  if (!list) return;

  list.innerHTML =
    '<p class="text-sm text-gray-500 italic text-center py-4">Loading…</p>';

  try {
    const rubricsCol = collection(
      UI.db,
      `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/rubrics`
    );

    const q = query(rubricsCol, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      list.innerHTML =
        '<p class="text-sm text-gray-500 italic text-center py-4">No rubrics yet.</p>';
      return;
    }

    list.innerHTML = "";

    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const isActive = activeRubric?.id === docSnap.id;

      const el = document.createElement("div");
      el.className =
        `p-3 rounded-xl border mb-2 transition-all
         ${isActive
           ? "bg-primary-900/20 border-primary-500/50"
           : "bg-white/5 border-white/10 hover:bg-white/10"}`;

      el.innerHTML = `
        <div class="flex justify-between items-center mb-2">
          <div class="font-semibold text-white">${data.title}</div>
          <span class="text-xs text-gray-400">${data.rowCount} rows</span>
        </div>

        <div class="flex gap-2">
          <button class="select-rubric-btn flex-1 py-1.5 text-xs rounded-lg transition-colors
            ${isActive ? "bg-green-600 text-white cursor-default" : "bg-primary-600 hover:bg-primary-500 text-white"}">
            ${isActive ? "✔ Active" : "Select"}
          </button>

          <button class="delete-rubric-btn px-3 py-1.5 text-xs rounded-lg
            bg-white/5 text-gray-400 hover:text-red-300 hover:bg-red-900/20 transition-colors">
            Delete
          </button>
        </div>
      `;

      el.querySelector(".select-rubric-btn").onclick = () => {
        if (!isActive) {
          setActiveRubric(docSnap.id, data);
          loadSavedRubrics();
        }
      };

      el.querySelector(".delete-rubric-btn").onclick = async () => {
        if (
          await UI.showConfirm(
            "Delete this rubric? Existing scores will remain intact.",
            "Delete Rubric?",
            "Delete"
          )
        ) {
          await deleteDoc(
            doc(
              UI.db,
              `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/rubrics`,
              docSnap.id
            )
          );
          UI.toast("Rubric deleted.", "success");
          loadSavedRubrics();
        }
      };

      list.appendChild(el);
    });

  } catch (err) {
    console.error("Error loading rubrics:", err);
    list.innerHTML =
      '<p class="text-sm text-red-400 text-center py-4">Failed to load rubrics.</p>';
  }
}

/* ========================================================================== */
/* 4. ACTIVE RUBRIC ACCESS (USED BY RECORDING + LIBRARY)
/* ========================================================================== */

export function setActiveRubric(id, data) {
  activeRubric = { id, ...data };

  UI.toast(`Active rubric: ${data.title}`, "success");

  document
    .querySelectorAll(".active-rubric-name-display")
    .forEach(el => (el.textContent = data.title));
}

export function getActiveRubric() {
  return activeRubric;
}