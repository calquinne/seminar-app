/* ========================================================================== */
/* MODULE: analytics.js (Production Ready)
/* ========================================================================== */

import * as UI from "./ui.js";
import { collection, getDocs, query, orderBy, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Global cache for the current session
let CACHED_VIDEOS = [];
let CACHED_RUBRICS = {};

// Temporary storage for the "Who Got This?" modal
// Key format: "rowId-scoreValue" -> Value: ["Student Name", "Student Name"]
let BREAKDOWN_DATA = {}; 

export async function loadAnalytics() {
    const container = document.getElementById("analytics-dashboard");
    const loading = document.getElementById("analytics-loading");
    
    if (!UI.currentUser) return;

    if (loading) loading.classList.remove("hidden");
    if (container) container.classList.add("hidden");

    try {
        // 1. Fetch ALL videos
        const ref = collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`);
        const q = query(ref, orderBy("recordedAt", "desc"));
        const snapshot = await getDocs(q);

        CACHED_VIDEOS = [];
        const classNames = new Set();
        const rubricIds = new Set();

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.hasScore && data.totalScore !== undefined) {
                // ✅ REFINEMENT 2: Normalize Score Source
                // Ensure we have a valid map of row scores, regardless of data age
                data.safeScores = data.finalScores || data.scores || {};
                
                CACHED_VIDEOS.push({ id: doc.id, ...data });
                
                if (data.classEventTitle) classNames.add(data.classEventTitle);
                if (data.rubricId) rubricIds.add(data.rubricId);
            }
        });

        // 2. Fetch Rubric Definitions
        await loadRubricDefinitions(Array.from(rubricIds));

        // 3. Compute & Render General Stats
        const stats = computeStats(CACHED_VIDEOS);
        renderHeadlines(stats);
        renderClassTable(stats.classBreakdown);
        renderRecentList(CACHED_VIDEOS.slice(0, 5));

        // 4. Setup Analysis Filters
        populateFilters(Array.from(classNames), Array.from(rubricIds));
        
        // 5. Setup Listeners (Event Delegation)
        setupAnalysisListeners();

        // 6. Run Initial Analysis
        updateRubricAnalysis();

        if (loading) loading.classList.add("hidden");
        if (container) container.classList.remove("hidden");

    } catch (err) {
        console.error("Analytics load failed:", err);
        UI.toast("Failed to load analytics.", "error");
        if (loading) loading.classList.add("hidden");
    }
}

async function loadRubricDefinitions(ids) {
    CACHED_RUBRICS = {};
    const promises = ids.map(async (id) => {
        try {
            const snap = await getDoc(doc(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/rubrics`, id));
            if (snap.exists()) {
                CACHED_RUBRICS[id] = snap.data();
            }
        } catch (e) {
            console.warn(`Could not load rubric ${id}`, e);
        }
    });
    await Promise.all(promises);
}

function populateFilters(classes, rubricIds) {
    const classSelect = document.getElementById("analytics-class-filter");
    const rubricSelect = document.getElementById("analytics-rubric-select");
    
    // Clear old listeners if any by cloning (simple reset)
    // We attach onchange below
    
    classSelect.innerHTML = '<option value="all">All Classes</option>';
    classes.sort().forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        classSelect.appendChild(opt);
    });

    rubricSelect.innerHTML = "";
    rubricIds.forEach(id => {
        const r = CACHED_RUBRICS[id];
        if (r) {
            const opt = document.createElement("option");
            opt.value = id;
            opt.textContent = r.title;
            rubricSelect.appendChild(opt);
        }
    });

    if (rubricIds.length > 0) rubricSelect.value = rubricIds[0];
}

// ✅ REFINEMENT 1: Event Delegation Setup
function setupAnalysisListeners() {
    // Dropdowns
    const rSelect = document.getElementById("analytics-rubric-select");
    const cSelect = document.getElementById("analytics-class-filter");
    
    rSelect.onchange = () => updateRubricAnalysis();
    cSelect.onchange = () => updateRubricAnalysis();

    // Container Delegation (Clicking a score box)
    const container = document.getElementById("rubric-analysis-container");
    
    // Remove old listener to prevent duplicates (using a property flag)
    if (!container._hasListener) {
        container.addEventListener("click", (e) => {
            const btn = e.target.closest(".breakdown-btn");
            if (!btn) return;
            
            // Read data from attributes
            const label = btn.dataset.label;
            const score = btn.dataset.score;
            const key = btn.dataset.key;
            
            // Retrieve complex list from memory
            const students = BREAKDOWN_DATA[key] || [];
            
            showScoreBreakdown(label, score, students);
        });
        container._hasListener = true;
    }
}

export function updateRubricAnalysis() {
    const rubricId = document.getElementById("analytics-rubric-select").value;
    const classFilter = document.getElementById("analytics-class-filter").value;
    const container = document.getElementById("rubric-analysis-container");

    BREAKDOWN_DATA = {}; // Reset data store

    if (!rubricId || !CACHED_RUBRICS[rubricId]) {
        container.innerHTML = `<div class="text-sm text-gray-500 italic p-4 text-center">No rubric selected or rubric definition missing.</div>`;
        return;
    }

    const rubricDef = CACHED_RUBRICS[rubricId];
    
    // Filter videos
    const relevantVideos = CACHED_VIDEOS.filter(v => {
        const matchRubric = v.rubricId === rubricId;
        const matchClass = classFilter === "all" || v.classEventTitle === classFilter;
        return matchRubric && matchClass;
    });

    if (relevantVideos.length === 0) {
        container.innerHTML = `<div class="text-sm text-gray-500 italic p-4 text-center">No scored videos found for this combination.</div>`;
        return;
    }

    container.innerHTML = ""; // Clear UI

    rubricDef.rows.forEach(row => {
        const scoreCounts = {}; 
        
        relevantVideos.forEach(v => {
            const score = v.safeScores[row.id]; // Uses normalized scores
            if (score !== undefined && score !== null) {
                if (!scoreCounts[score]) scoreCounts[score] = [];
                scoreCounts[score].push(v.participant);
            }
        });

        const rowEl = document.createElement("div");
        rowEl.className = "bg-gray-900 border border-white/10 rounded-xl overflow-hidden";
        
        let html = `
            <div class="p-3 bg-white/5 border-b border-white/5 flex justify-between items-center">
                <span class="font-medium text-sm text-white">${row.label}</span>
                <span class="text-[10px] text-gray-500 uppercase">Max: ${row.maxPoints}</span>
            </div>
            <div class="p-3 flex flex-wrap gap-2">
        `;

        const uniqueScores = Object.keys(scoreCounts).sort((a,b) => b - a);
        
        if (uniqueScores.length === 0) {
            html += `<span class="text-xs text-gray-500 italic">No data recorded.</span>`;
        } else {
            uniqueScores.forEach(score => {
                const students = scoreCounts[score];
                const count = students.length;
                
                // Save list to memory using a unique key
                const dataKey = `${row.id}-${score}`;
                BREAKDOWN_DATA[dataKey] = students;

                // Visual Coloring
                const percentage = (score / row.maxPoints) * 100;
                let bgClass = "bg-red-500/20 text-red-300 border-red-500/30";
                if (percentage >= 80) bgClass = "bg-green-500/20 text-green-300 border-green-500/30";
                else if (percentage >= 50) bgClass = "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";

                // ✅ SAFE BUTTON GENERATION (No inline JS)
                html += `
                <button class="breakdown-btn flex flex-col items-center justify-center w-16 h-14 border rounded-lg transition-transform active:scale-95 ${bgClass}"
                        data-label="${row.label}" 
                        data-score="${score}"
                        data-key="${dataKey}">
                    <span class="text-lg font-bold leading-none">${count}</span>
                    <span class="text-[10px] opacity-80">scored ${score}</span>
                </button>
                `;
            });
        }
        
        html += `</div>`;
        rowEl.innerHTML = html;
        container.appendChild(rowEl);
    });
}

function showScoreBreakdown(rowLabel, score, students) {
    const modal = document.getElementById("score-breakdown-modal");
    const title = document.getElementById("breakdown-modal-title");
    const sub = document.getElementById("breakdown-modal-subtitle");
    const list = document.getElementById("breakdown-student-list");

    title.textContent = rowLabel;
    sub.textContent = `Score: ${score} pts`;
    
    list.innerHTML = "";
    students.forEach(name => {
        const li = document.createElement("li");
        li.className = "p-2 bg-white/5 rounded text-sm text-gray-200 border border-white/5";
        li.textContent = name;
        list.appendChild(li);
    });

    modal.showModal();
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------
function computeStats(videos) {
    if (videos.length === 0) return { total: 0, avg: 0, topScore: 0, topStudent: "N/A", classBreakdown: {} };
    let sum = 0, max = -1, topStudent = "-";
    const classes = {};

    videos.forEach(v => {
        const score = Number(v.totalScore) || 0;
        const className = v.classEventTitle || "Uncategorized";
        sum += score;
        if (score > max) { max = score; topStudent = v.participant || "Unknown"; }
        if (!classes[className]) classes[className] = { sum: 0, count: 0 };
        classes[className].sum += score;
        classes[className].count += 1;
    });

    return {
        total: videos.length,
        avg: (sum / videos.length).toFixed(1),
        topScore: max,
        topStudent: topStudent,
        classBreakdown: classes
    };
}

function renderHeadlines(stats) {
    const safeSet = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    safeSet("stat-total-videos", stats.total);
    safeSet("stat-avg-score", stats.avg);
    safeSet("stat-top-performer", stats.topStudent);
    safeSet("stat-top-score", stats.topScore > -1 ? `${stats.topScore} pts` : "-");
}

function renderClassTable(classes) {
    const container = document.getElementById("analytics-class-list");
    if (!container) return;
    container.innerHTML = "";
    Object.keys(classes).sort().forEach(className => {
        const data = classes[className];
        const avg = (data.sum / data.count).toFixed(1);
        const width = Math.min(100, (avg / 20) * 100); 
        container.insertAdjacentHTML('beforeend', `
            <div class="p-3 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                <div class="flex justify-between items-center mb-1">
                    <span class="text-sm font-medium text-white">${className}</span>
                    <span class="text-xs text-primary-300 font-mono font-bold">${avg} avg</span>
                </div>
                <div class="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div class="h-full bg-primary-500 rounded-full" style="width: ${width}%"></div>
                </div>
            </div>
        `);
    });
}

function renderRecentList(recentVideos) {
    const container = document.getElementById("analytics-recent-list");
    if (!container) return;
    container.innerHTML = "";
    recentVideos.forEach(v => {
        const date = new Date(v.recordedAt).toLocaleDateString();
        container.insertAdjacentHTML('beforeend', `
            <div class="flex items-center justify-between p-3 border-b border-white/5 last:border-0">
                <div>
                    <div class="text-sm text-white font-medium">${v.participant}</div>
                    <div class="text-xs text-gray-500">${v.classEventTitle} • ${date}</div>
                </div>
                <div class="text-right">
                    <div class="text-sm font-bold text-primary-400">${v.totalScore} pts</div>
                </div>
            </div>
        `);
    });
}

// ✅ NEW EXPORT FUNCTION (Standard CSV)
export async function downloadCSV() {
    if (!UI.currentUser) { UI.toast("Please sign in to export data.", "error"); return; }
    UI.toast("Generating CSV...", "info");
    try {
        const ref = collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`);
        const q = query(ref, orderBy("recordedAt", "desc"));
        const snapshot = await getDocs(q);
        if (snapshot.empty) { UI.toast("No data to export.", "info"); return; }
        
        let csv = "Date,Class/Event,Participant,Score,Rubric,Type,Notes\n";
        snapshot.forEach(doc => {
            const v = doc.data();
            if (!v.hasScore) return; 
            const clean = (str) => `"${(str || "").replace(/"/g, '""')}"`;
            const date = new Date(v.recordedAt).toLocaleDateString();
            csv += `${clean(date)},${clean(v.classEventTitle)},${clean(v.participant)},${v.totalScore},${clean(v.rubricTitle)},${v.recordingType},${clean(v.notes)}\n`;
        });
        
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `seminar-export-${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        UI.toast("Export complete!", "success");
    } catch (err) { console.error("Export failed:", err); UI.toast("Failed to export data.", "error"); }
}