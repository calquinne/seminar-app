/* ========================================================================== */
/* MODULE: analytics.js (Deep Insight Version)
/* ========================================================================== */

import * as UI from "./ui.js";
import * as Record from "./record.js"; // Needed for scorecard rendering
import { collection, getDocs, query, orderBy, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let ALL_VIDEOS = [];
let CACHED_RUBRICS = {};
let CURRENT_FILTER_CLASS = "all"; 

export async function loadAnalytics() {
    const container = document.getElementById("analytics-dashboard");
    const loading = document.getElementById("analytics-loading");
    
    if (!UI.currentUser) return;

    if (loading) loading.classList.remove("hidden");
    if (container) container.classList.add("hidden");

    try {
        const ref = collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`);
        const q = query(ref, orderBy("recordedAt", "desc"));
        const snapshot = await getDocs(q);

        ALL_VIDEOS = [];
        const rubricIds = new Set();

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.hasScore && data.totalScore !== undefined) {
                data.safeScores = data.finalScores || data.scores || {};
                ALL_VIDEOS.push({ id: doc.id, ...data });
                if (data.rubricId) rubricIds.add(data.rubricId);
            }
        });

        await loadRubricDefinitions(Array.from(rubricIds));
        
        // Populate Filters UI once
        populateFilterDropdown();

        // Run Logic (Apply default filter 'all')
        applyDashboardFilter("all");

        if (loading) loading.classList.add("hidden");
        if (container) container.classList.remove("hidden");

    } catch (err) {
        console.error("Analytics load failed:", err);
        UI.toast("Failed to load analytics.", "error");
        if (loading) loading.classList.add("hidden");
    }
}

// ✅ CORE LOGIC: Applies Class Filter to ALL Dashboard Sections
export function applyDashboardFilter(className) {
    CURRENT_FILTER_CLASS = className;
    
    // Update Dropdown UI to match
    const dropdown = document.getElementById("analytics-class-filter");
    if(dropdown) dropdown.value = className;

    // Filter Data
    const relevantVideos = className === "all" 
        ? ALL_VIDEOS 
        : ALL_VIDEOS.filter(v => v.classEventTitle === className);

    // Re-Calculate Stats
    const stats = computeStats(relevantVideos);
    
    // Re-Render Everything
    renderHeadlines(stats);
    renderClassTable(computeStats(ALL_VIDEOS).classBreakdown); // Keep full list for navigation
    renderRecentList(relevantVideos.slice(0, 5));
    
    // Update Rubric Analysis (It reads CURRENT_FILTER_CLASS internally)
    updateRubricAnalysis(); 
}

// ✅ NEW: Open Read-Only Scorecard
export function openScorecard(videoId) {
    const video = ALL_VIDEOS.find(v => v.id === videoId);
    if(!video) return;

    const modal = document.getElementById("analytics-scorecard-modal");
    const container = document.getElementById("analytics-scorecard-body");
    const rubricDef = CACHED_RUBRICS[video.rubricId];

    document.getElementById("scorecard-student-name").textContent = video.participant;
    document.getElementById("scorecard-subtitle").textContent = `${video.classEventTitle} • ${new Date(video.recordedAt).toLocaleDateString()}`;
    document.getElementById("scorecard-total").textContent = video.totalScore;

    // Delegate rendering to Record.js (Re-use!)
    Record.renderLiveScoringFromRubric({
        finalScores: video.safeScores,
        rowNotes: video.rowNotes,
        rubricSnapshot: rubricDef
    }, "analytics", { 
        readOnly: true, 
        container: container 
    });

    modal.showModal();
}

/* ========================================================================== */
/* UI RENDERERS
/* ========================================================================== */

function renderClassTable(classes) {
    const container = document.getElementById("analytics-class-list");
    if (!container) return;
    container.innerHTML = "";
    
    Object.keys(classes).sort().forEach(className => {
        const data = classes[className];
        const avg = (data.sum / data.count).toFixed(1);
        const width = Math.min(100, (avg / 20) * 100); 
        
        // Highlight active filter
        const isActive = CURRENT_FILTER_CLASS === className;
        const activeClass = isActive ? "bg-white/10 border-primary-500/50" : "border-white/5 hover:bg-white/5";

        const div = document.createElement("div");
        div.className = `p-3 border-b last:border-0 transition-colors cursor-pointer ${activeClass}`;
        div.innerHTML = `
            <div class="flex justify-between items-center mb-1">
                <span class="text-sm font-medium text-white">${className}</span>
                <span class="text-xs text-primary-300 font-mono font-bold">${avg} avg</span>
            </div>
            <div class="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div class="h-full bg-primary-500 rounded-full" style="width: ${width}%"></div>
            </div>
        `;
        // ✅ CLICK TO FILTER
        div.onclick = () => applyDashboardFilter(isActive ? "all" : className);
        container.appendChild(div);
    });
}

function renderRecentList(recentVideos) {
    const container = document.getElementById("analytics-recent-list");
    if (!container) return;
    container.innerHTML = "";
    
    if (recentVideos.length === 0) {
        container.innerHTML = `<div class="p-4 text-sm text-gray-500 italic">No recordings found.</div>`;
        return;
    }

    recentVideos.forEach(v => {
        const date = new Date(v.recordedAt).toLocaleDateString();
        const row = document.createElement("div");
        row.className = "flex items-center justify-between p-3 border-b border-white/5 last:border-0 cursor-pointer hover:bg-white/10 transition-colors group";
        row.innerHTML = `
            <div>
                <div class="text-sm text-white font-medium group-hover:text-primary-400 transition-colors">${v.participant}</div>
                <div class="text-xs text-gray-500">${v.classEventTitle} • ${date}</div>
            </div>
            <div class="text-right">
                <div class="text-sm font-bold text-primary-400">${v.totalScore} pts</div>
            </div>
        `;
        // ✅ CLICK TO SEE SCORECARD
        row.onclick = () => openScorecard(v.id);
        container.appendChild(row);
    });
}

export function updateRubricAnalysis() {
    const rubricId = document.getElementById("analytics-rubric-select").value;
    const container = document.getElementById("rubric-analysis-container");

    // Filter relevant videos based on CURRENT_FILTER_CLASS + Selected Rubric
    const relevantVideos = ALL_VIDEOS.filter(v => {
        const matchRubric = v.rubricId === rubricId;
        const matchClass = CURRENT_FILTER_CLASS === "all" || v.classEventTitle === CURRENT_FILTER_CLASS;
        return matchRubric && matchClass;
    });

    if (!rubricId || !CACHED_RUBRICS[rubricId]) {
        container.innerHTML = `<div class="text-sm text-gray-500 italic p-4 text-center">No rubric selected.</div>`;
        return;
    }

    if (relevantVideos.length === 0) {
        container.innerHTML = `<div class="text-sm text-gray-500 italic p-4 text-center">No data for this filter.</div>`;
        return;
    }

    const rubricDef = CACHED_RUBRICS[rubricId];
    container.innerHTML = ""; 

    rubricDef.rows.forEach(row => {
        const scoreCounts = {}; 
        relevantVideos.forEach(v => {
            const score = v.safeScores[row.id]; 
            if (score !== undefined && score !== null) {
                if (!scoreCounts[score]) scoreCounts[score] = [];
                scoreCounts[score].push({ name: v.participant, vidId: v.id });
            }
        });

        // 1. Create Row Container
        const rowEl = document.createElement("div");
        rowEl.className = "bg-gray-900 border border-white/10 rounded-xl overflow-hidden";
        
        // 2. Create Header (String is fine here, no interaction)
        rowEl.innerHTML = `
            <div class="p-3 bg-white/5 border-b border-white/5 flex justify-between items-center">
                <span class="font-medium text-sm text-white">${row.label}</span>
                <span class="text-[10px] text-gray-500 uppercase">Max: ${row.maxPoints}</span>
            </div>
        `;

        // 3. Create the Grid for Buttons
        const grid = document.createElement("div");
        grid.className = "p-3 flex flex-wrap gap-2";

        const uniqueScores = Object.keys(scoreCounts).sort((a,b) => b - a);
        
        uniqueScores.forEach(score => {
            const students = scoreCounts[score];
            const count = students.length;
            
            const percentage = (score / row.maxPoints) * 100;
            let bgClass = percentage >= 80 ? "bg-green-500/20 text-green-300 border-green-500/30" 
                        : percentage >= 50 ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
                        : "bg-red-500/20 text-red-300 border-red-500/30";

            // ✅ FIX: Create real element, no ID lookups, no setTimeout
            const btn = document.createElement("button");
            btn.className = `flex flex-col items-center justify-center w-16 h-14 border rounded-lg transition-transform active:scale-95 ${bgClass}`;
            btn.innerHTML = `
                <span class="text-lg font-bold leading-none">${count}</span>
                <span class="text-[10px] opacity-80">scored ${score}</span>
            `;
            
            // Direct Attachment
            btn.onclick = () => showScoreBreakdown(row.label, score, students);
            
            grid.appendChild(btn);
        });
        
        rowEl.appendChild(grid);
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
    
    students.forEach(s => {
        const li = document.createElement("li");
        li.className = "flex justify-between items-center p-2 bg-white/5 rounded text-sm text-gray-200 border border-white/5 group hover:bg-white/10 transition-colors cursor-pointer";
        li.innerHTML = `<span>${s.name}</span><span class="text-xs text-primary-400 opacity-0 group-hover:opacity-100">View →</span>`;
        li.onclick = () => { modal.close(); openScorecard(s.vidId); };
        list.appendChild(li);
    });

    modal.showModal();
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------
async function loadRubricDefinitions(ids) {
    CACHED_RUBRICS = {};
    const promises = ids.map(async (id) => {
        try {
            const snap = await getDoc(doc(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/rubrics`, id));
            if (snap.exists()) CACHED_RUBRICS[id] = snap.data();
        } catch (e) { console.warn(`Could not load rubric ${id}`, e); }
    });
    await Promise.all(promises);
}

function populateFilterDropdown() {
    const classSelect = document.getElementById("analytics-class-filter");
    const rubricSelect = document.getElementById("analytics-rubric-select");
    
    // Classes are derived from ALL_VIDEOS
    const classNames = new Set(ALL_VIDEOS.map(v => v.classEventTitle).filter(Boolean));
    
    classSelect.innerHTML = '<option value="all">All Classes</option>';
    Array.from(classNames).sort().forEach(c => {
        const opt = document.createElement("option");
        opt.value = c; opt.textContent = c; classSelect.appendChild(opt);
    });
    
    // Listeners
    classSelect.onchange = (e) => applyDashboardFilter(e.target.value);
    rubricSelect.onchange = () => updateRubricAnalysis();

    // Populate Rubrics Dropdown
    rubricSelect.innerHTML = "";
    Object.keys(CACHED_RUBRICS).forEach(id => {
        const r = CACHED_RUBRICS[id];
        const opt = document.createElement("option");
        opt.value = id; opt.textContent = r.title; rubricSelect.appendChild(opt);
    });
    if(rubricSelect.options.length > 0) rubricSelect.selectedIndex = 0;
}

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
    
    // Note: Top Performer is now just text, or you can link it to the top video if desired.
    // For now, simpler is better.
}

// Export function remains unchanged...
export async function downloadCSV() { /* ... existing export code ... */ }