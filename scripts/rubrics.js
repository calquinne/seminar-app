/* ========================================================================== */
/* MODULE: rubrics.js
/* Handles creation, editing, duplication, selection, and persistence of rubrics
/* - Preserves row IDs on edit
/* - Adds Duplicate Rubric (safe variant testing)
/* - Adds rubric versioning (increments on update)
/* - Optional safety: lock rubric structure once used (allow text edits only)
/* ========================================================================== */

import * as UI from "./ui.js";
import {
  collection,
  addDoc,
  setDoc,
  getDoc,
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
let activeRubric = null;           // { id, ...data }
let editingRubricId = null;        // existing rubric doc id if editing
let editingRubricLocked = false;   // structure lock state for the rubric currently in builder

/* ========================================================================== */
/* HELPERS
/* ========================================================================== */

function rubricsCollectionRef() {
  return collection(
    UI.db,
    `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/rubrics`
  );
}

function isRubricLocked(data) {
  // Either explicit locked flag OR usedCount > 0 means: no structural edits
  return !!data?.locked || (Number(data?.usedCount || 0) > 0);
}

function makeStableRowId() {
  return `row_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function normalizeAllowedScores(rowEl) {
  // Only scores represented by inputs in .score-descriptions are persisted
  const allowedScores = [];
  const descInputs = rowEl.querySelectorAll(".score-descriptions input");
  descInputs.forEach((inp) => {
    allowedScores.push({
      value: parseInt(inp.dataset.score, 10),
      label: (inp.value || "").trim()
    });
  });

  const maxPoints =
    allowedScores.length > 0
      ? Math.max(...allowedScores.map((s) => s.value))
      : 0;

  return { allowedScores, maxPoints };
}

function setBuilderLockUI(locked) {
  editingRubricLocked = !!locked;

  // Save button text hint
  const saveBtn = UI.$("#save-new-rubric-btn");
  if (saveBtn) {
    saveBtn.textContent = editingRubricId ? "Update Rubric" : "Save Rubric";
    if (editingRubricLocked && editingRubricId) {
      // Still allowed to save (text-only edits)
      saveBtn.title = "This rubric is locked (used). Text edits only.";
    } else {
      saveBtn.title = "";
    }
  }

  // If locked: disable checkbox changes + disable remove-row buttons visually
  document.querySelectorAll("#rubric-builder-rows > div").forEach((rowDiv) => {
    const removeBtn = rowDiv.querySelector("[data-remove-row='true']");
    if (removeBtn) {
      removeBtn.disabled = editingRubricLocked;
      removeBtn.classList.toggle("opacity-40", editingRubricLocked);
      removeBtn.classList.toggle("cursor-not-allowed", editingRubricLocked);
      removeBtn.title = editingRubricLocked
        ? "This rubric is locked. You can’t remove rows."
        : "Remove row";
    }

    rowDiv.querySelectorAll(".score-cb").forEach((cb) => {
      cb.disabled = editingRubricLocked;
      cb.closest("label")?.classList.toggle("opacity-40", editingRubricLocked);
      cb.closest("label")?.classList.toggle("cursor-not-allowed", editingRubricLocked);
      if (editingRubricLocked) cb.title = "Locked rubric: score options cannot be changed.";
      else cb.title = "";
    });
  });

  // If locked: disable Add Row button if present
  const addRowBtn = UI.$("#add-rubric-row-btn");
  if (addRowBtn) {
    addRowBtn.disabled = editingRubricLocked;
    addRowBtn.classList.toggle("opacity-40", editingRubricLocked);
    addRowBtn.classList.toggle("cursor-not-allowed", editingRubricLocked);
    addRowBtn.title = editingRubricLocked
      ? "This rubric is locked. Duplicate it to make structural changes."
      : "";
  }
}

/* ========================================================================== */
/* 1. RUBRIC BUILDER UI
/* ========================================================================== */

export function addBuilderRow(existingData = null) {
  const container = UI.$("#rubric-builder-rows");
  if (!container) return;

  // If locked, block creating new rows (structure change)
  if (editingRubricLocked) {
    UI.toast("This rubric is locked. Duplicate it to add/remove rows.", "warn");
    return;
  }

  currentRowCount++;
  const domId = `builder-row-ui-${currentRowCount}`;

  const div = document.createElement("div");
  div.id = domId;
  div.className =
    "p-4 bg-white/5 rounded-xl border border-white/10 mb-3 relative group transition-all hover:bg-white/10";

  // Preserve existing Row ID in DOM so edits don't orphan historical scoring
  if (existingData?.id) div.dataset.rowId = existingData.id;

  // Pre-fill
  const titleVal = existingData ? (existingData.label || "") : "";

  // Which score checkboxes are checked?
  const checkedValues = existingData?.allowedScores?.length
    ? existingData.allowedScores.map((s) => s.value)
    : [0, 2, 4, 6, 8, 10];

  // Map of value -> tooltip label
  const tooltips = {};
  if (existingData?.allowedScores?.length) {
    existingData.allowedScores.forEach((s) => {
      tooltips[String(s.value)] = s.label || "";
    });
  }

  div.innerHTML = `
    <div class="flex gap-4 items-start mb-3">
      <div class="flex-1">
        <label class="block text-xs text-gray-400 mb-1 uppercase tracking-wide">Row Title</label>
        <input
          type="text"
          class="row-title w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white
                 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none placeholder-gray-600"
          placeholder="e.g., Argument & Analysis"
          value="${escapeHtml(titleVal)}"
        >
      </div>

      <button
        type="button"
        class="text-gray-500 hover:text-red-400 transition-colors p-1"
        data-remove-row="true"
        title="Remove row"
      >✕</button>
    </div>

    <div class="mb-3">
      <label class="block text-xs text-gray-400 mb-2 uppercase tracking-wide">Allowed Scores</label>
      <div class="flex flex-wrap gap-2 score-checkboxes">
        ${[0,1,2,3,4,5,6,7,8,9,10].map(n => `
          <label class="flex items-center gap-1.5 cursor-pointer bg-black/20 px-2 py-1 rounded border border-white/5 hover:border-white/20 transition-colors">
            <input type="checkbox" value="${n}" class="accent-primary-500 w-3 h-3 score-cb" ${checkedValues.includes(n) ? "checked" : ""}>
            <span class="text-xs text-gray-300 font-mono">${n}</span>
          </label>
        `).join("")}
      </div>
    </div>

    <div>
      <label class="block text-xs text-gray-400 mb-1 uppercase tracking-wide">Score Descriptions (Tooltips)</label>
      <div class="score-descriptions space-y-2 pl-1 border-l-2 border-white/5"></div>
    </div>
  `;

  container.appendChild(div);

  // Remove row
  div.querySelector("[data-remove-row='true']").onclick = () => {
    if (editingRubricLocked) {
      UI.toast("This rubric is locked. Duplicate it to remove rows.", "warn");
      return;
    }
    div.remove();
  };

  // Checkbox listeners
  div.querySelectorAll(".score-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (editingRubricLocked) return;
      updateScoreDescriptions(div);
    });
  });

  // Initial render of description inputs (with prefilled tooltips)
  updateScoreDescriptions(div, tooltips);

  // Focus title on new row
  if (!existingData) {
    const titleInput = div.querySelector(".row-title");
    if (titleInput) titleInput.focus();
  }

  // If we're in locked mode, enforce lock UI state for the new row
  setBuilderLockUI(editingRubricLocked);
}

function updateScoreDescriptions(rowEl, existingTooltips = {}) {
  const container = rowEl.querySelector(".score-descriptions");
  const checked = Array.from(rowEl.querySelectorAll(".score-cb:checked"))
    .map((cb) => parseInt(cb.value, 10))
    .sort((a, b) => a - b);

  // Preserve currently typed values
  const currentValues = { ...existingTooltips };
  container.querySelectorAll("input").forEach((inp) => {
    const k = String(inp.dataset.score);
    if (inp.value) currentValues[k] = inp.value;
  });

  container.innerHTML = "";

  if (checked.length === 0) {
    container.innerHTML =
      '<p class="text-[10px] text-gray-500 italic py-1">Select scores above to add descriptions.</p>';
    return;
  }

  checked.forEach((score) => {
    const wrap = document.createElement("div");
    wrap.className = "flex items-center gap-3";

    const key = String(score);
    wrap.innerHTML = `
      <span class="text-xs font-bold text-primary-400 w-4 text-right">${score}</span>
      <input
        type="text"
        class="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-300 focus:border-primary-500 outline-none placeholder-gray-700"
        placeholder="Description for score ${score}"
        data-score="${score}"
        value="${escapeHtml(currentValues[key] || "")}"
      >
    `;
    container.appendChild(wrap);
  });

  // If rubric is locked, allow tooltip text edits but disable checkboxes (handled elsewhere)
}

/* ========================================================================== */
/* 2. SAVE RUBRIC (Create / Update) + VERSIONING
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

  const rowElements = document.querySelectorAll("#rubric-builder-rows > div");
  const rows = [];

  rowElements.forEach((el) => {
    const label = el.querySelector(".row-title")?.value.trim();
    if (!label) return;

    const { allowedScores, maxPoints } = normalizeAllowedScores(el);

    // Preserve existing row id if present; otherwise generate a new stable id
    const stableId = el.dataset.rowId ? el.dataset.rowId : makeStableRowId();

    rows.push({
      id: stableId,
      label,
      maxPoints,
      allowedScores
    });
  });

  if (rows.length === 0) {
    UI.toast("Add at least one scoring row.", "error");
    return;
  }

  const saveBtn = UI.$("#save-new-rubric-btn");
  const originalBtnText = saveBtn?.textContent || "Save Rubric";
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
  }

  try {
    const colRef = rubricsCollectionRef();

    // Versioning:
    // - New rubric: version=1
    // - Update rubric: version increments by 1
    let nextVersion = 1;
    let existingMeta = null;

    if (editingRubricId) {
      const snap = await getDoc(doc(colRef, editingRubricId));
      if (snap.exists()) {
        existingMeta = snap.data();
        nextVersion = Number(existingMeta.version || 1) + 1;

        // Optional safety: if locked, prevent structural changes (row ids or allowedScores values list)
        if (isRubricLocked(existingMeta)) {
          // Compare structure: set of row ids and each row's allowed score VALUES
          const oldRows = Array.isArray(existingMeta.rows) ? existingMeta.rows : [];

          const oldById = new Map(oldRows.map((r) => [r.id, r]));
          const newById = new Map(rows.map((r) => [r.id, r]));

          // Must have identical row IDs
          if (oldById.size !== newById.size) {
            UI.toast("Locked rubric: you can’t add/remove rows. Duplicate it instead.", "error");
            return;
          }
          for (const [rid, oldRow] of oldById.entries()) {
            const newRow = newById.get(rid);
            if (!newRow) {
              UI.toast("Locked rubric: row changes are not allowed. Duplicate it instead.", "error");
              return;
            }

            const oldVals = (oldRow.allowedScores || []).map(s => s.value).sort((a,b)=>a-b);
            const newVals = (newRow.allowedScores || []).map(s => s.value).sort((a,b)=>a-b);

            if (oldVals.length !== newVals.length || oldVals.some((v,i)=>v!==newVals[i])) {
              UI.toast("Locked rubric: score options cannot be changed. Duplicate it instead.", "error");
              return;
            }
          }
        }
      }
    }

    const payload = {
      title,
      rows,
      rowCount: rows.length,
      version: nextVersion,
      updatedAt: serverTimestamp(),

      // keep these if they already exist
      locked: existingMeta?.locked || false,
      usedCount: existingMeta?.usedCount || 0,
      parentRubricId: existingMeta?.parentRubricId || null
    };

    if (editingRubricId) {
      await setDoc(doc(colRef, editingRubricId), payload, { merge: true });
      UI.toast(`Rubric updated (v${nextVersion}).`, "success");
    } else {
      payload.createdAt = serverTimestamp();
      payload.usedCount = 0;
      payload.locked = false;
      payload.parentRubricId = null;
      await addDoc(colRef, payload);
      UI.toast("Rubric created (v1).", "success");
    }

    resetBuilder();
    await loadSavedRubrics();
  } catch (err) {
    console.error("Error saving rubric:", err);
    UI.toast("Failed to save rubric.", "error");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalBtnText;
    }
  }
}

function resetBuilder() {
  const titleEl = UI.$("#rubric-builder-title");
  const rowsEl = UI.$("#rubric-builder-rows");
  if (titleEl) titleEl.value = "";
  if (rowsEl) rowsEl.innerHTML = "";

  editingRubricId = null;
  editingRubricLocked = false;
  currentRowCount = 0;

  const saveBtn = UI.$("#save-new-rubric-btn");
  if (saveBtn) saveBtn.textContent = "Save Rubric";

  // Start with one empty row
  addBuilderRow();
  setBuilderLockUI(false);
}

/* ========================================================================== */
/* 3. LOAD & SELECT RUBRICS (Select / Edit / Duplicate / Delete)
/* ========================================================================== */

export async function loadSavedRubrics() {
  if (!UI.db || !UI.currentUser) return;

  const list = UI.$("#saved-rubrics-list");
  if (!list) return;

  list.innerHTML = '<p class="text-sm text-gray-500 italic text-center py-4">Loading…</p>';

  try {
    const colRef = rubricsCollectionRef();
    const q = query(colRef, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      list.innerHTML = '<p class="text-sm text-gray-500 italic text-center py-4">No rubrics yet.</p>';
      return;
    }

    list.innerHTML = "";

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const isActive = activeRubric?.id === docSnap.id;
      const isEditing = editingRubricId === docSnap.id;

      const locked = isRubricLocked(data);
      const version = Number(data.version || 1);

      const el = document.createElement("div");
      el.className =
        `p-3 rounded-xl border mb-2 transition-all
         ${isActive
           ? "bg-primary-900/20 border-primary-500/50"
           : isEditing
             ? "bg-amber-900/20 border-amber-500/50"
             : "bg-white/5 border-white/10 hover:bg-white/10"}`;

      const lockBadge = locked
        ? `<span class="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-300">LOCKED</span>`
        : ``;

      const verBadge = `<span class="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-300">v${version}</span>`;

      el.innerHTML = `
        <div class="flex justify-between items-center mb-2">
          <div class="font-semibold text-white truncate max-w-[170px]" title="${escapeHtml(data.title || "Untitled")}">
            ${escapeHtml(data.title || "Untitled")}
            ${verBadge}
            ${lockBadge}
          </div>
          <span class="text-xs text-gray-400">${data.rowCount || (data.rows?.length || 0)} rows</span>
        </div>

        <div class="grid grid-cols-4 gap-1">
          <button class="select-rubric-btn py-1.5 text-xs rounded-lg transition-colors
            ${isActive ? "bg-green-600 text-white cursor-default" : "bg-primary-600 hover:bg-primary-500 text-white"}">
            ${isActive ? "Active" : "Select"}
          </button>

          <button class="edit-rubric-btn py-1.5 text-xs rounded-lg bg-white/10 hover:bg-white/20 text-gray-200 transition-colors">
            Edit
          </button>

          <button class="dup-rubric-btn py-1.5 text-xs rounded-lg bg-purple-600/30 hover:bg-purple-600/40 text-purple-100 transition-colors" title="Create a copy you can safely change">
            Duplicate
          </button>

          <button class="delete-rubric-btn py-1.5 text-xs rounded-lg bg-white/5 text-gray-400 hover:text-red-300 hover:bg-red-900/20 transition-colors">
            Delete
          </button>
        </div>
      `;

      // Select
      el.querySelector(".select-rubric-btn").onclick = () => {
        if (!isActive) {
          setActiveRubric(docSnap.id, data);
          loadSavedRubrics();
        }
      };

      // Edit
      el.querySelector(".edit-rubric-btn").onclick = () => {
        loadRubricIntoBuilder(docSnap.id, data);
        loadSavedRubrics();
      };

      // Duplicate
      el.querySelector(".dup-rubric-btn").onclick = async () => {
        await duplicateRubric(docSnap.id, data);
      };

      // Delete
      el.querySelector(".delete-rubric-btn").onclick = async () => {
        const ok = await UI.showConfirm(
          "Delete this rubric? Existing scores on videos will remain, but this rubric definition will be removed.",
          "Delete Rubric?",
          "Delete"
        );
        if (!ok) return;

        await deleteDoc(doc(colRef, docSnap.id));

        // If deleting active or editing rubric, reset state
        if (activeRubric?.id === docSnap.id) activeRubric = null;
        if (editingRubricId === docSnap.id) resetBuilder();

        UI.toast("Rubric deleted.", "success");
        await loadSavedRubrics();
      };

      list.appendChild(el);
    });
  } catch (err) {
    console.error("Error loading rubrics:", err);
    list.innerHTML = '<p class="text-sm text-red-400 text-center py-4">Failed to load rubrics.</p>';
  }
}

function loadRubricIntoBuilder(id, data) {
  editingRubricId = id;

  const locked = isRubricLocked(data);
  editingRubricLocked = locked;

  // Title
  UI.$("#rubric-builder-title").value = data.title || "";

  // Clear rows
  const container = UI.$("#rubric-builder-rows");
  container.innerHTML = "";
  currentRowCount = 0;

  // Rebuild rows (preserving IDs)
  if (Array.isArray(data.rows)) {
    data.rows.forEach((rowData) => addBuilderRow(rowData));
  } else {
    addBuilderRow();
  }

  // Button text
  const saveBtn = UI.$("#save-new-rubric-btn");
  if (saveBtn) saveBtn.textContent = "Update Rubric";

  // Enforce lock UI after rows exist
  setBuilderLockUI(locked);

  if (locked) {
    UI.toast("Rubric is locked (used). Text edits only. Duplicate to change structure.", "info");
  } else {
    UI.toast(`Editing "${data.title || "Untitled"}"`, "info");
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function duplicateRubric(sourceId, sourceData) {
  if (!UI.db || !UI.currentUser) return;

  const ok = await UI.showConfirm(
    "Duplicate this rubric? The copy starts at v1 and can be safely changed without affecting existing scored videos.",
    "Duplicate Rubric?",
    "Duplicate"
  );
  if (!ok) return;

  try {
    const colRef = rubricsCollectionRef();

    // Copy rows BUT generate NEW ROW IDS so analytics stay clean between variants
    const sourceRows = Array.isArray(sourceData.rows) ? sourceData.rows : [];
    const newRows = sourceRows.map((r) => ({
      id: makeStableRowId(),
      label: r.label || "",
      maxPoints: r.maxPoints || 0,
      allowedScores: Array.isArray(r.allowedScores) ? r.allowedScores.map(s => ({ value: s.value, label: s.label || "" })) : []
    }));

    const baseTitle = sourceData.title || "Untitled";
    const newTitle = `${baseTitle} (Copy)`;

    await addDoc(colRef, {
      title: newTitle,
      rows: newRows,
      rowCount: newRows.length,
      version: 1,
      parentRubricId: sourceId,
      locked: false,
      usedCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    UI.toast("Rubric duplicated (new copy v1).", "success");
    await loadSavedRubrics();
  } catch (e) {
    console.error("Duplicate rubric failed:", e);
    UI.toast("Failed to duplicate rubric.", "error");
  }
}

/* ========================================================================== */
/* 4. ACTIVE RUBRIC ACCESS (USED BY RECORDING + LIBRARY)
/* ========================================================================== */

export function setActiveRubric(id, data) {
  activeRubric = { id, ...data };

  UI.toast(`Active: ${data.title || "Untitled"}${data.version ? ` (v${data.version})` : ""}`, "success");

  document
    .querySelectorAll(".active-rubric-name-display")
    .forEach((el) => (el.textContent = data.title || "Untitled"));
}

export function getActiveRubric() {
  return activeRubric;
}

/* ========================================================================== */
/* SMALL UTILS
/* ========================================================================== */

// Prevent HTML injection in template literals (titles/tooltips)
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
