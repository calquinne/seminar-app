/* ========================================================================== */
/* MODULE: analytics.js (FIXED: Supports 'allowedScores' Data Structure)
/* ========================================================================== */

import * as UI from "./ui.js";
import * as Record from "./record.js";
import { collection, getDocs, query, orderBy, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* -------------------------------------------------------------------------- */
/* STATE
/* -------------------------------------------------------------------------- */

let ALL_VIDEOS = [];
let CACHED_RUBRICS = {};

// TOP SECTION STATE
let TOP_SECTION_CLASS = "all"; 

// GLOBAL DATA CONTRACTS (Single Sources of Truth)
window.CURRENT_LEADERBOARD_DATA = [];
window.CURRENT_PRINT_DATA = []; 
window.CURRENT_ANALYTICS_CLASS_LABEL = "All Classes";

/* -------------------------------------------------------------------------- */
/* LOAD ANALYTICS
/* -------------------------------------------------------------------------- */
export async function loadAnalytics() {
  const container = document.getElementById("analytics-dashboard");
  const loading = document.getElementById("analytics-loading");

  if (!container) return;

  // Dev Mode Check
  if (window.__DEV_ANALYTICS__ || !UI.db) { return; }

  // PROD MODE
  if (!UI.currentUser) return;
  if (loading) loading.classList.remove("hidden");
  container.classList.add("hidden");

  try {
    const ref = collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`);
    const q = query(ref, orderBy("recordedAt", "desc"));
    const snap = await getDocs(q);

    ALL_VIDEOS = [];
    const rubricIds = new Set();
    const seenKeys = new Set(); 

    snap.forEach(d => {
      const data = d.data();
      if (data.hasScore && data.totalScore !== undefined) {
        data.safeScores = data.finalScores || data.scores || {};
        data.recordedAt = data.recordedAt?.toDate?.() ?? new Date(data.recordedAt || Date.now());

        // Dedupe Key includes rubricId to prevent data loss
        const uniqueKey = `${data.participant}|${data.groupName || data.group || ''}|${data.classEventTitle}|${data.rubricId}`;
        
        if (!seenKeys.has(uniqueKey)) {
            seenKeys.add(uniqueKey);
            ALL_VIDEOS.push({ id: d.id, ...data });
            if (data.rubricId) rubricIds.add(data.rubricId);
        }
      }
    });

    await loadRubricDefinitions([...rubricIds]);
    initPage();

    if (loading) loading.classList.add("hidden");
    container.classList.remove("hidden");

  } catch (err) {
    console.error("Analytics load failed", err);
    UI.toast("Failed to load analytics", "error");
    if (loading) loading.classList.add("hidden");
  }
}

/* -------------------------------------------------------------------------- */
/* PAGE INITIALIZATION
/* -------------------------------------------------------------------------- */

function initPage() {
    populateFilterDropdowns(); 
    updateGlobalDashboard("all"); 
    
    // Explicitly run bottom section logic on init to ensure leaderboard renders
    updateRubricSection();
    
    setupTooltips();
    document.body.setAttribute("data-date", new Date().toLocaleDateString() + " " + new Date().toLocaleTimeString());
}

function setupTooltips() {
    // ---------------------------------------------------------
    // 1. HELPER: FANCY DARK TOOLTIPS
    // ---------------------------------------------------------
    // layoutType: 'inline' (buttons) or 'block' (headers)
    const addCustomTooltip = (id, text, direction = "top", layoutType = "inline") => {
        const el = document.getElementById(id);
        if (!el) return;

        // Clean up old attributes
        el.removeAttribute("title");
        if (el.parentElement) el.parentElement.removeAttribute("title");

        // Create Wrapper
        const wrapper = document.createElement("div");

        // 🎨 LAYOUT LOGIC
        if (layoutType === "block") {
            wrapper.className = "group relative block w-full"; 
        } else {
            wrapper.className = "group relative inline-flex items-center justify-center"; 
        }

        // Move element inside wrapper
        el.parentNode.insertBefore(wrapper, el);
        wrapper.appendChild(el);

        // Tooltip Construction
        const tooltip = document.createElement("div");
        let posClass = "";
        let arrowClass = "";

        // 🧭 POSITION LOGIC
        if (direction === "left") {
            // 👈 LEFT MODE
            posClass = "absolute right-full mr-3 top-1/2 -translate-y-1/2 w-48 p-2 bg-gray-900/95 text-white text-[11px] leading-tight rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 text-center backdrop-blur-sm";
            arrowClass = "absolute left-full top-1/2 -translate-y-1/2 border-4 border-transparent border-l-gray-900/95";
        
        } else if (direction === "bottom") {
            // 👇 BOTTOM MODE (New! Fixes the Header issue)
            // Appears BELOW the text, aligned Left
            posClass = "absolute top-full mt-2 left-0 w-48 p-2 bg-gray-900/95 text-white text-[11px] leading-tight rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 text-center backdrop-blur-sm";
            // Arrow points UP
            arrowClass = "absolute bottom-full left-4 border-4 border-transparent border-b-gray-900/95";

        } else if (layoutType === "block") {
            // 📏 HEADER (Top) - Fallback
            posClass = "absolute bottom-full mb-2 left-0 w-48 p-2 bg-gray-900/95 text-white text-[11px] leading-tight rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 text-center backdrop-blur-sm";
            arrowClass = "absolute top-full left-4 border-4 border-transparent border-t-gray-900/95";
        
        } else {
            // 👆 STANDARD (Top Center)
            posClass = "absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 p-2 bg-gray-900/95 text-white text-[11px] leading-tight rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 text-center backdrop-blur-sm";
            arrowClass = "absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900/95";
        }

        tooltip.className = posClass;
        tooltip.innerHTML = `${text}<div class="${arrowClass}"></div>`;

        wrapper.appendChild(tooltip);

        if (el.tagName !== "BUTTON") {
            el.classList.add("cursor-help");
        }
    };

    // ✅ 1. APPLY TO STATS
    addCustomTooltip("stat-total-videos", "Total count of graded recordings matching your current filters.");
    addCustomTooltip("stat-avg-score", "The average student score compared to the average maximum possible score.");
    addCustomTooltip("stat-top-performer", "The student with the single highest score in the current view.");

    // ✅ 2. APPLY TO STANDARD BUTTONS
    addCustomTooltip("analytics-export-btn", "Download current data as .csv");
    addCustomTooltip("analytics-refresh-btn", "Reload data from database");
    addCustomTooltip("rubric-analysis-pdf-btn", "Download PDF Report");

    // ❌ REMOVED "PART 3" (Leaderboard Button) - This fixes the "Double Tooltip" issue!

    // ✅ 4. FIX LIST HEADERS (Now using "bottom" direction to stay visible!)
    const classList = document.getElementById("analytics-class-list");
    if (classList && classList.previousElementSibling) {
        const header = classList.previousElementSibling;
        if (!header.id) header.id = "analytics-class-header"; 
        // 👇 CHANGED TO "bottom"
        addCustomTooltip(header.id, "Compare class average against global average.", "bottom", "block");
    }

    const recentList = document.getElementById("analytics-recent-list");
    if (recentList && recentList.previousElementSibling) {
        const header = recentList.previousElementSibling;
        if (!header.id) header.id = "analytics-recent-header";
        // 👇 CHANGED TO "bottom"
        addCustomTooltip(header.id, "Most recently recorded assessments.", "bottom", "block");
    }
}

/* -------------------------------------------------------------------------- */
/* LOGIC PART 1: TOP SECTION (Controlled by List)
/* -------------------------------------------------------------------------- */

function updateGlobalDashboard(className) {
    TOP_SECTION_CLASS = className;

    const classSelect = document.getElementById("analytics-class-filter");
    if (classSelect) {
        classSelect.value = className;
        populateStudentDropdown(); 
        updateRubricSection();      
    }

    const globalVideos = className === "all" 
        ? ALL_VIDEOS 
        : ALL_VIDEOS.filter(v => v.classEventTitle === className);

    const stats = computeStats(globalVideos);

    renderHeadlines(stats);
    renderClassTable(computeStats(ALL_VIDEOS).classBreakdown); 
    renderRecentList(globalVideos.slice(0, 5));
}

/* -------------------------------------------------------------------------- */
/* LOGIC PART 2: BOTTOM SECTION (Controlled by Filters)
/* -------------------------------------------------------------------------- */

export function updateRubricSection() {
    const classSelect = document.getElementById("analytics-class-filter");
    const studentSelect = document.getElementById("analytics-student-filter");
    const rubricSelect = document.getElementById("analytics-rubric-select");

    const filterClass = classSelect ? classSelect.value : "all";
    const filterStudent = studentSelect ? studentSelect.value : "all";
    const filterRubric = rubricSelect ? rubricSelect.value : "all";
    
    // 1. Filter Data by Class
    let relevantVideos = ALL_VIDEOS;
    if (filterClass !== "all") {
        relevantVideos = relevantVideos.filter(v => v.classEventTitle === filterClass);
    }

    // 2. Determine Context Labels
    let classLabel = "All Classes";
    if (filterClass !== "all") {
        if (classSelect && classSelect.selectedIndex > -1) {
            classLabel = classSelect.options[classSelect.selectedIndex].text;
        } else {
            classLabel = filterClass;
        }
    }
    
    window.CURRENT_ANALYTICS_CLASS_LABEL = classLabel;

    let rubricLabel = "All Rubrics";
    if (filterRubric !== "all" && CACHED_RUBRICS[filterRubric]) {
        rubricLabel = CACHED_RUBRICS[filterRubric].title;
    }
    const contextLabel = `${rubricLabel} • ${classLabel}`;

    // 3. Determine Dataset for Leaderboard & Charts
    let targetVideos = relevantVideos;
    if (filterRubric !== "all") {
        targetVideos = relevantVideos.filter(v => v.rubricId === filterRubric);
    }

    // 4. Render Leaderboard First
    renderLeaderboard(targetVideos, contextLabel);

    // 5. Manage View Mode Visibility
    const isStudentMode = filterStudent !== "all";
    const studentView = document.getElementById("analytics-student-view");
    const rubricContainer = document.getElementById("rubric-analysis-container");
    const leaderboardContainer = document.getElementById("analytics-leaderboard-container") || document.getElementById("analytics-leaderboard"); 

    if (isStudentMode) {
        // Student Mode
        if (studentView) studentView.classList.remove("hidden");
        if (rubricContainer) rubricContainer.classList.add("hidden");
        if (leaderboardContainer) leaderboardContainer.classList.add("hidden"); 
        
        const studentVideos = relevantVideos.filter(v => v.participant === filterStudent);
        renderStudentMatrix(filterStudent, studentVideos, relevantVideos);
    } else {
        // Class/All Mode
        if (studentView) studentView.classList.add("hidden");
        if (rubricContainer) rubricContainer.classList.remove("hidden");
        if (leaderboardContainer) leaderboardContainer.classList.remove("hidden"); 
        
        // Rubric Breakdown Logic
        if (filterRubric === "all") {
            if(rubricContainer) {
                rubricContainer.innerHTML = `<div class="p-8 text-center text-gray-500 italic border border-dashed border-white/10 rounded-xl mb-6">Select a specific rubric above to see detailed skill breakdowns.<br>Viewing overall performance across all rubrics.</div>`;
            }
        } else {
            renderRubricCharts(targetVideos); 
        }
    }
}

/* -------------------------------------------------------------------------- */
/* RENDERERS
/* -------------------------------------------------------------------------- */

function renderHeadlines(stats) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("stat-total-videos", stats.total);
  
  const avgEl = document.getElementById("stat-avg-score");
  if (avgEl) {
      const pct = stats.avgMax > 0 ? Math.round((stats.avg / stats.avgMax) * 100) : 0;
      let colorClass = pct >= 80 ? "text-green-400" : pct >= 60 ? "text-yellow-400" : "text-white";
      avgEl.innerHTML = `<div class="flex items-baseline gap-2"><span class="text-3xl font-bold ${colorClass}">${stats.avg.toFixed(1)}</span><span class="text-sm text-gray-400 font-medium">/ ${stats.avgMax.toFixed(1)}</span></div>`;
  }

  set("stat-top-score", stats.topScore > -1 ? `${stats.topScore} pts` : "-");
  
  const topEl = document.getElementById("stat-top-performer");
  if (topEl) {
    const winners = stats.topStudents || [];
    topEl.className = "text-2xl font-bold text-white truncate cursor-default";
    topEl.onclick = null;
    if (winners.length === 0) topEl.textContent = "-";
    else if (winners.length === 1) topEl.textContent = winners[0];
    else if (winners.length === 2) {
        topEl.classList.remove("truncate"); topEl.classList.add("text-lg", "leading-tight", "whitespace-normal");
        topEl.textContent = `${winners[0]} & ${winners[1]}`;
    } else {
        topEl.innerHTML = `<span class="underline decoration-dotted hover:text-primary-400 cursor-pointer">${winners.length} Participants</span>`;
        topEl.onclick = () => showTopPerformerList(winners, stats.topScore);
    }
  }
}

function renderClassTable(classes) {
  const container = document.getElementById("analytics-class-list");
  if (!container) return;
  container.innerHTML = "";

  const isAll = TOP_SECTION_CLASS === "all";
  const globalStats = computeStats(ALL_VIDEOS); 
  const globalMax = globalStats.avgMax || 50; 
  const globalWidth = Math.min(100, (globalStats.avg / globalMax) * 100);

  const allRow = document.createElement("div");
  allRow.className = `p-3 border-b mb-1 border-white/10 transition-colors cursor-pointer ${isAll ? "bg-white/10 border-primary-500/50" : "border-white/5 hover:bg-white/5"}`;
  allRow.innerHTML = `<div class="flex justify-between items-center mb-1"><span class="text-sm font-bold text-white uppercase tracking-wider">All Classes</span><span class="text-xs text-primary-300 font-mono font-bold">${globalStats.avg.toFixed(1)} avg</span></div><div class="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden"><div class="h-full bg-cyan-400 rounded-full" style="width: ${globalWidth}%"></div></div>`;
  allRow.onclick = () => updateGlobalDashboard("all");
  container.appendChild(allRow);

  Object.keys(classes).sort().forEach(className => {
    const data = classes[className];
    const avg = data.sum / data.count;
    const width = Math.min(100, (avg / globalMax) * 100); 
    const isActive = TOP_SECTION_CLASS === className;
    const activeClass = isActive ? "bg-white/10 border-primary-500/50" : "border-white/5 hover:bg-white/5";

    const div = document.createElement("div");
    div.className = `p-3 border-b last:border-0 transition-colors cursor-pointer ${activeClass}`;
    div.innerHTML = `<div class="flex justify-between items-center mb-1"><span class="text-sm font-medium text-white">${className}</span><span class="text-xs text-primary-300 font-mono font-bold">${avg.toFixed(1)} avg</span></div><div class="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden"><div class="h-full bg-primary-500 rounded-full" style="width: ${width}%"></div></div>`;
    div.onclick = () => updateGlobalDashboard(className);
    container.appendChild(div);
  });
}

function renderRecentList(recentVideos) {
  const container = document.getElementById("analytics-recent-list");
  if (!container) return;
  container.innerHTML = "";
  if (recentVideos.length === 0) { container.innerHTML = `<div class="p-4 text-sm text-gray-500 italic">No recordings found.</div>`; return; }
  
  recentVideos.forEach(v => {
    const date = v.recordedAt.toLocaleDateString();
    const name = getPrimaryName(v);
    const groupName = getGroupContext(v);

    const badgeHtml = groupName 
        ? `<span class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary-500/20 text-primary-300 uppercase tracking-wide">👥 ${groupName}</span>` 
        : "";

    const row = document.createElement("div");
    row.className = "flex items-center justify-between p-3 border-b border-white/5 last:border-0 cursor-pointer hover:bg-white/10 transition-colors group";
    row.innerHTML = `<div><div class="text-sm text-white font-medium group-hover:text-primary-400 transition-colors flex items-center">${name} ${badgeHtml}</div><div class="text-xs text-gray-500">${v.classEventTitle} • ${date}</div></div><div class="text-right"><div class="text-sm font-bold text-primary-400">${v.totalScore} pts</div></div>`;
    row.onclick = () => openScorecard(v.id);
    container.appendChild(row);
  });
}

// ------------------------------------------------------------------
// DATA NORMALIZATION (Single Source of Truth)
// ------------------------------------------------------------------
function getNormalizedScore(video, row) {
    if (!video || !row) return 0;

    // 1. UI-normalized scores (authoritative)
    if (video.safeScores && row.id && video.safeScores[row.id] !== undefined) {
        const val = Number(video.safeScores[row.id]);
        return Number.isFinite(val) ? val : 0;
    }

    // 2. Raw / legacy scores (fallback)
    if (video.scores && row.id && video.scores[row.id] !== undefined) {
        const raw = video.scores[row.id];
        const val = Number(raw?.score ?? raw);
        return Number.isFinite(val) ? val : 0;
    }

    if (video.scores && row.title && video.scores[row.title] !== undefined) {
        const raw = video.scores[row.title];
        const val = Number(raw?.score ?? raw);
        return Number.isFinite(val) ? val : 0;
    }

    return 0;
}


/* ==========================================================================
   RENDER RUBRIC CHARTS
   ========================================================================== */
function renderRubricCharts(relevantVideos) { 

  const rubricSelect = document.getElementById("analytics-rubric-select");
  const container = document.getElementById("rubric-analysis-container");
  if (!rubricSelect || !container) return;

  const rubricId = rubricSelect.value;
  const rubric = CACHED_RUBRICS[rubricId];

  if (!rubricId || !rubric) {
    container.innerHTML = `
      <div class="p-4 text-gray-500 italic text-center">
        Select a specific rubric above to see detailed skill breakdowns.<br/>
        Viewing overall performance across all rubrics.
      </div>
    `;
    return; 
  }

  container.innerHTML = "";
  const rubricVideos = relevantVideos;
  const rowStats = [];

  const rubricMax = rubric.rows.reduce((sum, r) => sum + (Number(r.maxPoints) || 0), 0);
  const totalSum = rubricVideos.reduce((sum, v) => sum + (Number(v.totalScore) || 0), 0);
  const rubricAvg = rubricVideos.length ? totalSum / rubricVideos.length : 0;

  /* 1. SUMMARY CARD */
  if (rubricVideos.length > 0) {
    const rawPercent = rubricMax > 0 ? (rubricAvg / rubricMax) * 100 : 0;

    const textCol =
      rawPercent >= 80 ? "text-green-400" :
      rawPercent >= 50 ? "text-yellow-400" :
      "text-red-400";

    const maxScore = Math.max(...rubricVideos.map(v => Number(v.totalScore) || 0));
    const winners = [...new Set(
      rubricVideos
        .filter(v => (Number(v.totalScore) || 0) === maxScore)
        .map(v => v.participant || "Unknown")
    )];

    const winnerHtml =
      winners.length === 1
        ? `<div class="text-xl font-bold text-white truncate">${winners[0]}</div>`
        : winners.length === 2
          ? `<div class="text-lg font-bold text-white leading-tight">${winners[0]} & ${winners[1]}</div>`
          : `<div class="text-xl font-bold text-white underline decoration-dotted cursor-pointer hover:text-primary-400" id="rubric-total-tied-link">${winners.length} Participants</div>`;

    const summaryEl = document.createElement("div");
    summaryEl.className = "mb-6 p-6 rounded-xl bg-gray-900 border border-white/10 flex flex-wrap md:flex-nowrap items-center justify-between gap-6";

   summaryEl.innerHTML = `
      <div class="flex items-center gap-4 min-w-[200px]">
        <div class="p-3 bg-white/5 rounded-lg border border-white/10 hidden sm:block"><span class="text-2xl">📊</span></div>
        <div>
          <div class="text-lg font-bold text-white">Rubric Total</div>
          <div class="text-xs text-gray-400 uppercase tracking-wider">Overall Performance</div>
        </div>
      </div>
      <div class="hidden md:block w-px h-12 bg-white/10"></div>
      <div class="flex flex-col min-w-[100px]">
        <div class="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Total Videos</div>
        <div class="text-4xl font-black text-white">${rubricVideos.length}</div>
      </div>
      <div class="hidden md:block w-px h-12 bg-white/10"></div>
      <div class="flex flex-col min-w-[150px]">
        <div class="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">AVG Score</div>
        <div class="flex items-baseline gap-2">
          <span class="text-4xl font-black ${textCol}">${rubricAvg.toFixed(1)}</span>
          <span class="text-lg text-gray-500 font-medium">/ ${rubricMax}</span>
        </div>
      </div>
      <div class="hidden md:block w-px h-12 bg-white/10"></div>
      <div class="flex-1 min-w-[200px] flex items-center justify-between">
        <div>
          <div class="text-xs font-bold text-primary-400 uppercase tracking-widest mb-1">Top Performer</div>
          <div class="flex items-center gap-4">
            ${winnerHtml}
            <div class="text-xl font-mono font-bold text-primary-400 whitespace-nowrap">${maxScore} pts</div>
          </div>
        </div>

        <div class="group relative ml-4">
            <button id="rubric-analysis-pdf-btn" class="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-gray-300 hover:text-white transition-colors border border-white/10">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M12 9.75V1.5m0 0 9 9m-9-9-9 9" />
              </svg>
            </button>
            
            <div class="absolute bottom-full mb-2 right-0 w-32 p-2 bg-gray-900/95 text-white text-[11px] leading-tight rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 text-center backdrop-blur-sm">
                Download PDF Report
                <div class="absolute top-full right-3 border-4 border-transparent border-t-gray-900/95"></div>
            </div>
        </div>

      </div>
    `;

    container.appendChild(summaryEl);

    /* 2. ROW BREAKDOWN */
    rubric.rows.forEach(row => {
      const scores = [];
      const scoreGroups = {}; // { "4": [videoObj, ...] }

      rubricVideos.forEach(v => {
        const val = getNormalizedScore(v, row);
        const safeVal = Number(val);

        if (Number.isFinite(safeVal)) {
          scores.push(safeVal);
          const key = String(safeVal);
          if (!scoreGroups[key]) scoreGroups[key] = [];
          scoreGroups[key].push(v);
        }
      });

      if (!scores.length) return;

      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const rawPercent = (Number(row.maxPoints) || 0) > 0 ? (avg / row.maxPoints) * 100 : 0;
      const visualPercent = Math.max(0, Math.min(100, Math.round(rawPercent)));

      const distBadges = Object.entries(scoreGroups)
        .sort((a, b) => Number(b[0]) - Number(a[0]))
       
        // ✅ FINAL FIXED VERSION (All UP, Left-Aligned First Item)
.map(([score, videos], index) => { 
    const sNum = Number(score);
    const count = videos.length;
    const pct = (Number(row.maxPoints) || 0) > 0 ? sNum / row.maxPoints : 0;

    // 🕵️ DESCRIPTION LOOKUP
    let description = "No description available";
    if (row.scoreDescriptions?.[sNum]) {
        description = row.scoreDescriptions[sNum];
    } else if (Array.isArray(row.allowedScores)) {
        const match = row.allowedScores.find(item => Number(item.value) === sNum);
        if (match && match.label) description = match.label;
    }

    // 🧭 SMART POSITIONING
    // 1. VERTICAL: Always Point UP (bottom-full)
    const verticalPos = "bottom-full mb-2"; 
    const arrowVertical = "top-full border-t-gray-900/95 border-b-transparent";

    // 2. HORIZONTAL: Center usually, but Left-Align the first item
    let horizontalPos = "left-1/2 -translate-x-1/2"; // Default (Center)
    let arrowHorizontal = "left-1/2 -translate-x-1/2";   // Default (Center)

    if (index === 0) {
        horizontalPos = "left-0 translate-x-0";  // Align Left Edge
        arrowHorizontal = "left-4";              // Move Arrow to center of button
    }

    // Color Logic
    let colorClass = "bg-red-500/10 text-red-400 border-red-500/20";
    if (pct >= 0.8) colorClass = "bg-green-500/10 text-green-400 border-green-500/20";
    else if (pct >= 0.5) colorClass = "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";

    return `
      <div class="score-breakdown-trigger group relative px-2 py-1.5 rounded border ${colorClass} flex flex-col items-center justify-center min-w-[45px] cursor-pointer hover:bg-white/5 transition-colors hover:z-50" data-score="${sNum}">
          
          <div class="absolute ${verticalPos} ${horizontalPos} w-64 p-2 bg-gray-900/95 text-white text-[11px] leading-tight rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none text-center backdrop-blur-sm">
              ${description}
              
              <div class="absolute ${arrowVertical} ${arrowHorizontal} border-4 border-transparent"></div>
          </div>

          <div class="text-sm font-bold leading-none pointer-events-none">${count}</div>
          <div class="text-[9px] uppercase opacity-70 leading-none mt-0.5 pointer-events-none">scored ${sNum}</div>
      </div>
    `;
})
        .join("");

      // Data for PDF
      const maxPoints = Number(row.maxPoints) || 0;
      rowStats.push({
        title: row.label || row.title,
        avg,
        max: maxPoints,
        total: scores.length,
        distribution: {
          high: scores.filter(v => maxPoints > 0 && (v / maxPoints) >= 0.8).length,
          mid:  scores.filter(v => maxPoints > 0 && (v / maxPoints) >= 0.5 && (v / maxPoints) < 0.8).length,
          low:  scores.filter(v => maxPoints > 0 && (v / maxPoints) < 0.5).length
        }
      });

      const rowEl = document.createElement("div");
      rowEl.className = "bg-gray-900 border border-white/10 rounded-xl mb-4 overflow-hidden";

      rowEl.innerHTML = `
        <div class="p-5 flex flex-wrap md:flex-nowrap items-center gap-6">
          <div class="w-full md:w-1/3">
            <div class="text-lg font-bold text-white mb-1">${row.label || row.title}</div>
            <div class="text-xs text-gray-400 mb-3">Rubric Category</div>
            <div class="flex flex-wrap gap-2">
              ${distBadges}
            </div>
          </div>
          <div class="flex-1 px-4">
            ${renderSegmentedBar(visualPercent)}
          </div>
          <div class="text-right min-w-[100px]">
            <div class="text-sm font-bold text-gray-300">MAX ${maxPoints}</div>
            <div class="text-3xl font-extrabold text-white">${avg.toFixed(1)}</div>
            <div class="text-[10px] uppercase text-white/70">AVG</div>
          </div>
        </div>
      `;

      // Re-attach click listeners safely
      const triggers = rowEl.querySelectorAll(".score-breakdown-trigger");
      triggers.forEach(trigger => {
        const scoreKey = trigger.dataset.score;
        const videos = scoreGroups[String(scoreKey)] || [];

        trigger.onclick = () => {
          if (window.showScoreBreakdown) {
            const mappedStudents = videos.map(v => ({
              name: v.participant || "Unknown",
              viId: v.id,
              group: v.groupName || v.group || v.classEventTitle || ""
            }));
            window.showScoreBreakdown(row.label || row.title, scoreKey, mappedStudents);
          } else {
            console.error("showScoreBreakdown function missing");
          }
        };
      });

      container.appendChild(rowEl);
    });

    /* 3. WIRE UP THE PDF BUTTON */
    const pdfBtn = container.querySelector("#rubric-analysis-pdf-btn");
    if (pdfBtn) {
      pdfBtn.onclick = () => {
        const liveClassLabel = window.CURRENT_ANALYTICS_CLASS_LABEL || "All Classes";

        if (typeof window.generateRubricAnalysisPDF === "function") {
          window.generateRubricAnalysisPDF(
            rubric.title || "Rubric Analysis",
            rubricVideos.length,
            rubricAvg.toFixed(1),
            rubricMax,
            rowStats,
            liveClassLabel 
          );
        } else {
          console.error("generateRubricAnalysisPDF function missing");
        }
      };
    }

    const tiedLink = summaryEl.querySelector("#rubric-total-tied-link");
    if (tiedLink && window.showTopPerformerList) {
      tiedLink.onclick = () => showTopPerformerList(winners, maxScore);
    }
  }

  if (!rubricVideos.length) {
    container.innerHTML = `<div class="p-4 text-gray-500 italic text-center">No scored data available for this rubric.</div>`;
  }
}


/* -------------------------------------------------------------------------- */
/* STUDENT MATRIX RENDERER
/* -------------------------------------------------------------------------- */
function renderStudentMatrix(studentName, myVideos, classVideos) {
  const container = document.getElementById("analytics-student-view");
  if (!container) return;

  const totalScore = myVideos.reduce((sum, v) => sum + (Number(v.totalScore)||0), 0);
  const myAvg = myVideos.length ? (totalScore / myVideos.length) : 0;
  
  // 1. Calculate Class Averages
  const studentAvgs = {};
  classVideos.forEach(v => {
      const p = v.participant;
      if(!studentAvgs[p]) studentAvgs[p] = { sum: 0, count: 0 };
      studentAvgs[p].sum += (Number(v.totalScore)||0);
      studentAvgs[p].count += 1;
  });

  const sortedRanks = Object.entries(studentAvgs)
      .map(([name, data]) => ({ name, avg: data.sum / data.count }))
      .sort((a, b) => b.avg - a.avg);
  
  const myStoredAvg = studentAvgs[studentName] ? (studentAvgs[studentName].sum / studentAvgs[studentName].count) : 0;
  const myRank = sortedRanks.filter(s => s.avg > myStoredAvg).length + 1;
  const totalStudents = sortedRanks.length;

  // 2. Build Rubric Groups
  const rubricGroups = {};
  myVideos.forEach(v => {
      if (!rubricGroups[v.rubricId]) rubricGroups[v.rubricId] = { title: CACHED_RUBRICS[v.rubricId] ? CACHED_RUBRICS[v.rubricId].title : "Unknown", videos: [], sum: 0 };
      rubricGroups[v.rubricId].videos.push(v);
      rubricGroups[v.rubricId].sum += (Number(v.totalScore)||0);
  });

  let html = `<div class="relative overflow-hidden rounded-xl border border-primary-500/30 bg-gray-800 p-6 shadow-lg shadow-primary-500/5 animate-slide-up"><div class="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-primary-500/10 blur-xl"></div><div class="relative z-10 flex flex-wrap items-center justify-between gap-6"><div class="flex items-center gap-5"><div class="flex h-16 w-16 items-center justify-center rounded-full bg-primary-500/20 text-2xl font-bold text-primary-400 border border-primary-500/30">${studentName.charAt(0)}</div><div><h2 class="text-3xl font-bold text-white tracking-tight">${studentName}</h2><div class="flex items-center gap-2 text-sm font-medium text-primary-300"><span>Participant Lens</span><span class="h-1 w-1 rounded-full bg-primary-500"></span></div></div></div><div class="flex items-center gap-8 md:gap-12"><div class="text-right"><div class="text-3xl font-bold text-white">${myVideos.length}</div><div class="text-[10px] font-bold uppercase tracking-widest text-gray-400">Assessments</div></div><div class="hidden h-10 w-px bg-white/10 sm:block"></div><div class="text-right"><div class="text-3xl font-bold text-primary-400">${myAvg.toFixed(1)}</div><div class="text-[10px] font-bold uppercase tracking-widest text-gray-400">Participant Avg</div></div><div class="hidden h-10 w-px bg-white/10 sm:block"></div><div class="text-right"><div class="text-3xl font-bold text-yellow-400">#${myRank} <span class="text-lg text-gray-500">/ ${totalStudents}</span></div><div class="text-[10px] font-bold uppercase tracking-widest text-gray-400">Class Rank</div></div></div></div></div><div class="space-y-4"><div class="text-sm font-bold text-gray-500 uppercase tracking-widest mb-2 flex justify-between items-end"><span>Skill Breakdown</span><span class="text-xs normal-case text-gray-600">Click rows for details</span></div>`;

  if (Object.keys(rubricGroups).length === 0) {
      html += `<div class="p-8 text-center text-gray-500 italic border border-dashed border-white/10 rounded-xl">No assessments found.</div>`;
  } else {
      Object.keys(rubricGroups).forEach(rId => {
          const group = rubricGroups[rId];
          const studentAvg = group.sum / group.videos.length;
          const classScores = classVideos.filter(cv => cv.rubricId === rId).map(cv => Number(cv.totalScore)||0);
          const classAvg = classScores.length ? (classScores.reduce((a,b)=>a+b,0) / classScores.length) : 0;
          let max = 0; if (CACHED_RUBRICS[rId]) max = CACHED_RUBRICS[rId].rows.reduce((acc, r) => acc + r.maxPoints, 0);
          
          const pct = max > 0 ? (studentAvg / max) * 100 : 0;
          const classAvgPct = max > 0 ? (classAvg / max) * 100 : 0;
          const isAboveAvg = studentAvg >= classAvg;
          const barColor = pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-yellow-500" : "bg-red-500";
          const comparisonColor = isAboveAvg ? "text-green-400" : "text-red-400";
          const comparisonArrow = isAboveAvg ? "↑" : "↓";

          html += `
          <div class="bg-gray-900 border border-white/5 rounded-lg overflow-hidden transition-all hover:border-white/20 shadow-sm break-inside-avoid">
            
            <div class="p-4 flex flex-wrap items-center justify-between gap-4 cursor-pointer no-print group" 
                 onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('.arrow-icon').classList.toggle('-rotate-180')">
                
                <div class="w-full md:w-1/4">
                    <div class="text-lg font-bold text-white truncate">${group.title}</div>
                    <div class="text-xs text-gray-400">${group.videos.length} Assessment(s)</div>
                </div>
                <div class="flex-1 min-w-[150px]">
                    <div class="flex justify-between text-xs mb-1"><span class="text-gray-400">Performance</span><span class="font-bold text-white">${Math.round(pct)}%</span></div>
                    <div class="h-2 bg-gray-700 rounded-full overflow-hidden relative"><div class="absolute top-0 bottom-0 w-0.5 bg-white/50 z-10" style="left: ${classAvgPct}%" title="Class Avg"></div><div class="h-full ${barColor} relative z-0" style="width: ${pct}%"></div></div>
                </div>
                <div class="w-full md:w-auto flex items-center gap-8 justify-end min-w-[180px]">
                    <div class="text-right"><div class="text-lg font-bold text-white">${studentAvg.toFixed(1)}</div><div class="text-[10px] text-gray-500 uppercase">My Avg</div></div>
                    <div class="text-right border-l border-white/10 pl-4"><div class="text-lg font-bold ${comparisonColor} flex items-center justify-end gap-1">${classAvg.toFixed(1)} <span class="text-xs opacity-70">${comparisonArrow}</span></div><div class="text-[10px] text-gray-500 uppercase">Class Avg</div></div>
                    
                    <div class="text-gray-500 pl-2 transition-transform duration-200 arrow-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                        </svg>
                    </div>
                </div>
            </div>
            
            <div class="hidden border-t border-white/5 bg-black/20 p-4 space-y-2 print:block">
               ${group.videos.map(v => `
                    <div class="flex justify-between items-center p-4 bg-white/5 border border-white/5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer mb-2 group relative break-inside-avoid" 
                         onclick="window.analyticsOpenScorecard('${v.id}')"> 
                         
                        <div class="text-sm text-gray-300">
                            <span class="text-white font-bold text-lg">${v.classEventTitle}</span>
                            <span class="mx-2 text-gray-600">•</span>${v.recordedAt.toLocaleDateString()}
                        </div>

                        <div class="flex items-center gap-4">
                            <div class="text-xl font-bold text-white">
                                ${v.totalScore} <span class="text-sm text-gray-500 font-normal">/ ${max}</span>
                            </div>
                            </div>
                    </div>
                `).join("")}
            </div>
          </div>`;
      });
  }
  html += `</div>`;
  container.innerHTML = html;
}

/* -------------------------------------------------------------------------- */
/* UTILS & DATA
/* -------------------------------------------------------------------------- */

function getPrimaryName(v) {
    return v.participant || "Unknown";
}

function getGroupContext(v) {
    const gName = v.groupName || v.group;
    if ((v.isGroup || v.recordingType === 'group') && gName) {
        return gName;
    }
    return null;
}

function populateFilterDropdowns() {
  const classSelect = document.getElementById("analytics-class-filter");
  const rubricSelect = document.getElementById("analytics-rubric-select");
  const studentSelect = document.getElementById("analytics-student-filter"); 

  if (!classSelect || !rubricSelect) return;

  const classes = [...new Set(ALL_VIDEOS.map(v => v.classEventTitle).filter(Boolean))].sort();
  classSelect.innerHTML = `<option value="all">All Classes</option>`;
  classes.forEach(c => classSelect.innerHTML += `<option>${c}</option>`);

  rubricSelect.innerHTML = `<option value="all">All Rubrics</option>`;
  rubricSelect.innerHTML += Object.entries(CACHED_RUBRICS).map(([id, r]) => `<option value="${id}">${r.title}</option>`).join("");
  
  if (rubricSelect.options.length > 0) rubricSelect.selectedIndex = 0;

  if (studentSelect) {
      populateStudentDropdown(); 
  }

  classSelect.onchange = () => { populateStudentDropdown(); updateRubricSection(); };
  rubricSelect.onchange = () => updateRubricSection();
  if (studentSelect) studentSelect.onchange = () => updateRubricSection();
}

function populateStudentDropdown() {
    const classSelect = document.getElementById("analytics-class-filter");
    const studentSelect = document.getElementById("analytics-student-filter");
    if (!studentSelect || !classSelect) return;

    const className = classSelect.value;
    let relevant = ALL_VIDEOS;
    if (className !== "all") relevant = ALL_VIDEOS.filter(v => v.classEventTitle === className);
    
    const students = [...new Set(relevant.map(v => v.participant).filter(Boolean))].sort();
    if (students.length === 0) {
         studentSelect.innerHTML = `<option value="all">No Participants</option>`;
    } else {
         studentSelect.innerHTML = `<option value="all">All Participants</option>`;
         students.forEach(s => studentSelect.innerHTML += `<option value="${s}">${s}</option>`);
    }
}

function computeStats(videos) {
  if (!videos.length) return { total: 0, avg: 0, avgMax: 0, topScore: 0, topStudents: [], classBreakdown: {} };
  let sum = 0, sumMax = 0, maxScore = -1;
  const classes = {};
  videos.forEach(v => {
    const score = Number(v.totalScore) || 0;
    sum += score;
    let currentMax = 0;
    if (v.rubricId && CACHED_RUBRICS[v.rubricId]) {
         currentMax = CACHED_RUBRICS[v.rubricId].rows.reduce((acc, r) => acc + r.maxPoints, 0);
    } else {
         currentMax = score || 1; // Fallback
    }
    sumMax += currentMax;
    if (score > maxScore) maxScore = score;
    const className = v.classEventTitle || "Uncategorized";
    if (!classes[className]) classes[className] = { sum: 0, count: 0 };
    classes[className].sum += score; classes[className].count += 1;
  });
  
  const winners = videos.filter(v => (Number(v.totalScore) || 0) === maxScore).map(v => getPrimaryName(v));
  
  return { total: videos.length, avg: sum / videos.length, avgMax: sumMax / videos.length, topScore: maxScore, topStudents: [...new Set(winners)], classBreakdown: classes };
}

function renderSegmentedBar(percent) {
  const total = 100;
  const filled = Math.round(percent); 
  let html = `<div class="flex items-end gap-px h-14 flex-1 w-full overflow-visible">`;
  for (let i = 1; i <= total; i++) {
    let color = "bg-white/5"; 
    if (i <= filled) color = i <= 33 ? "bg-red-500" : i <= 66 ? "bg-yellow-400" : "bg-green-500";
    const progress = i / total;
    const height = 5 + (progress * 145);
    html += `<div class="flex-1 rounded-[1px] ${color} transition-all" style="height:${height}%"></div>`;
  }
  html += `</div>`;
  return html;
}

function loadRubricDefinitions(ids) {
  CACHED_RUBRICS = {};
  const promises = ids.map(async (id) => {
    try {
      const snap = await getDoc(doc(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/rubrics`, id));
      if (snap.exists()) CACHED_RUBRICS[id] = snap.data();
    } catch (e) { console.warn(`Could not load rubric ${id}`, e); }
  });
  return Promise.all(promises);
}

export function openScorecard(videoId) {
   // Link download button
   const btn = document.getElementById("scorecard-pdf-btn");
   if(btn) btn.onclick = () => window.generateScorecardPDF(videoId); 

  const video = ALL_VIDEOS.find(v => v.id === videoId);
  if (!video) return;
  const modal = document.getElementById("analytics-scorecard-modal");
  const container = document.getElementById("analytics-scorecard-body");
  const rubricDef = CACHED_RUBRICS[video.rubricId];
  if (!rubricDef) { UI.toast("Rubric definition not found.", "error"); return; }
  
  const elName = document.getElementById("scorecard-student-name");
  const elSub = document.getElementById("scorecard-subtitle");
  const elTotal = document.getElementById("scorecard-total");
  
  // Header
  if (elName) elName.textContent = getPrimaryName(video);
  
  if (elSub) {
      elSub.innerHTML = ""; // Clear existing
      let subText = `${video.classEventTitle} • ${video.recordedAt.toLocaleDateString()}`;
      const groupName = getGroupContext(video);
      if (groupName) subText += ` • 👥 ${groupName}`; 
      
      const span = document.createElement("span");
      span.textContent = subText;
      elSub.appendChild(span);

      if (rubricDef && rubricDef.title) {
          const div = document.createElement("div");
          div.className = "mt-1 text-sm font-medium opacity-80";
          div.textContent = rubricDef.title; // Safe text injection
          elSub.appendChild(div);
      }
  }
  
  // Calculate & Display Max Score
  if (elTotal) {
      let max = 0;
      if (rubricDef && rubricDef.rows) {
          max = rubricDef.rows.reduce((a, r) => a + r.maxPoints, 0);
      }
      elTotal.innerHTML = `${video.totalScore} <span class="text-lg text-gray-500 font-normal">/ ${max}</span>`;
  }
  
  if (modal && container) {
    if (Record && Record.renderLiveScoringFromRubric) {
        container.innerHTML = "";

        if (video.notes) {
            const notesDiv = document.createElement("div");
            notesDiv.className = "mb-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm text-yellow-100 italic";
            notesDiv.innerHTML = `<strong class="not-italic text-yellow-500 block mb-1 text-xs uppercase tracking-wide">General Notes:</strong> ${String(video.notes).replace(/</g, "&lt;")}`; 
            container.appendChild(notesDiv);
        }

        const rowsDiv = document.createElement("div");
        rowsDiv.id = "analytics-scoring-rows"; 
        container.appendChild(rowsDiv);

        Record.renderLiveScoringFromRubric(
            { finalScores: video.safeScores, rowNotes: video.rowNotes, rubricSnapshot: rubricDef }, 
            "analytics", 
            { readOnly: true, container: rowsDiv }
        );
        
        modal.showModal(); 
    }
  }
} 

// Explicit Global Assignment
window.openScorecard = openScorecard;
window.analyticsOpenScorecard = openScorecard;

window.showScoreBreakdown = function(rowLabel, score, students) {
    const modal = document.getElementById("score-breakdown-modal");
    const title = document.getElementById("breakdown-modal-title");
    const sub = document.getElementById("breakdown-modal-subtitle");
    const list = document.getElementById("breakdown-student-list");
    if (!modal || !list) return;
    
    if (title) title.textContent = rowLabel;
    if (sub) sub.textContent = `Score: ${score} pts`;
    
    list.innerHTML = "";
    students.forEach(s => {
        const li = document.createElement("li");
        li.className = "flex justify-between items-center p-2 bg-white/5 rounded text-sm text-gray-200 border border-white/5 group hover:bg-white/10 transition-colors cursor-pointer";
        
        const badge = s.group ? `<span class="ml-2 text-xs text-primary-400 font-normal">👥 ${s.group}</span>` : "";
        
        li.innerHTML = `
          <span class="flex items-center">
            ${s.name} ${badge}
          </span>
          <span class="text-xs text-primary-400 opacity-0 group-hover:opacity-100">View →</span>
        `;
        li.onclick = () => { modal.close(); openScorecard(s.viId); };
        list.appendChild(li);
    });
    modal.showModal();
};

function showTopPerformerList(winners, score) {
    const modal = document.getElementById("score-breakdown-modal");
    const title = document.getElementById("breakdown-modal-title");
    const sub = document.getElementById("breakdown-modal-subtitle");
    const list = document.getElementById("breakdown-student-list");
    if (!modal || !list) return;
    title.textContent = "Top Performers"; sub.textContent = `Tied with High Score: ${score} pts`; list.innerHTML = "";
    winners.forEach(name => {
        const li = document.createElement("li");
        li.className = "p-3 bg-white/5 rounded border border-white/10 text-white mb-2 flex items-center gap-2";
        li.innerHTML = `<span class="text-yellow-400">🏆</span> <span class="font-medium">${name}</span>`;
        list.appendChild(li);
    });
    modal.showModal();
}

/* -------------------------------------------------------------------------- */
/* EXPORT
/* -------------------------------------------------------------------------- */
export async function downloadCSV() {
    let videosToExport = ALL_VIDEOS;
    
    const classSelect = document.getElementById("analytics-class-filter");
    const studentSelect = document.getElementById("analytics-student-filter");
    const rubricSelect = document.getElementById("analytics-rubric-select");

    const filterClass = classSelect ? classSelect.value : "all";
    const filterStudent = studentSelect ? studentSelect.value : "all";
    const filterRubric = rubricSelect ? rubricSelect.value : "all";

    if (filterClass !== "all") {
        videosToExport = videosToExport.filter(v => v.classEventTitle === filterClass);
    }
    if (filterStudent !== "all") {
        videosToExport = videosToExport.filter(v => v.participant === filterStudent);
    }
    if (filterRubric !== "all") {
        videosToExport = videosToExport.filter(v => v.rubricId === filterRubric);
    }

    if (!videosToExport.length) { UI.toast("No data to export.", "info"); return; }
    
    let csvContent = "data:text/csv;charset=utf-8,Participant,Group Name,Is Group,Class,Date,Total Score,Rubric Used,All Group Members,Notes\n";
    
    videosToExport.forEach(v => {
        const date = v.recordedAt ? v.recordedAt.toISOString().split("T")[0] : "";
        const rubricName = CACHED_RUBRICS[v.rubricId] ? CACHED_RUBRICS[v.rubricId].title : "Unknown";
        
        const safeName = `"${(v.participant || "").replace(/"/g, '""')}"`;
        const safeClass = `"${(v.classEventTitle || "").replace(/"/g, '""')}"`;
        const safeRubric = `"${rubricName.replace(/"/g, '""')}"`;
        const safeNotes = `"${String(v.notes || "").replace(/"/g, '""')}"`; 
        
        // Match UI Logic for Group Name
        const groupNameVal = (v.groupName || v.group || "");
        const isGroup = (v.isGroup || v.recordingType === 'group') && !!groupNameVal;
        
        const safeGroupName = isGroup ? `"${groupNameVal.replace(/"/g, '""')}"` : "";
        const groupFlag = isGroup ? "TRUE" : "FALSE";
        
        let members = "";
        if (isGroup && v.allParticipants && Array.isArray(v.allParticipants)) {
            members = `"${v.allParticipants.join('; ').replace(/"/g, '""')}"`;
        }

        csvContent += `${safeName},${safeGroupName},${groupFlag},${safeClass},${date},${v.totalScore},${safeRubric},${members},${safeNotes}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `seminar_export_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

/* ==========================================================================
   RENDER LEADERBOARD
   ========================================================================== */
function renderLeaderboard(videos, contextLabel = "") {
    // ✅ CRITICAL: Save the currently filtered videos so the PDF generator knows what to print
    window.CURRENT_PRINT_DATA = videos;

    const container = document.getElementById("analytics-leaderboard-container") || document.getElementById("analytics-leaderboard");
    if (!container) {
        // Fallback: try to insert it if it doesn't exist
        const summary = document.getElementById("rubric-analysis-container");
        if (summary) {
            const div = document.createElement("div");
            div.id = "analytics-leaderboard-container";
            div.className = "mb-8 animate-slide-up";
            summary.parentNode.insertBefore(div, summary.nextSibling);
            return renderLeaderboard(videos, contextLabel);
        } else return;
    }

    // 1. Process Data
    const studentStats = {};
    videos.forEach(v => {
        const p = v.participant;
        if (!p) return; 
        
        if (!studentStats[p]) studentStats[p] = { 
            name: p, group: v.groupName || null, 
            className: v.classEventTitle || "Unknown", 
            totalPct: 0, totalScore: 0, totalMax: 0, count: 0, vidId: v.id 
        };

        let max = 0;
        if (v.rubricId && CACHED_RUBRICS[v.rubricId]) {
            max = CACHED_RUBRICS[v.rubricId].rows.reduce((a, r) => a + r.maxPoints, 0);
        }
        const score = Number(v.totalScore) || 0;
        const pct = max > 0 ? (score / max) * 100 : 0;
        
        studentStats[p].totalPct += pct;
        studentStats[p].totalScore += score;
        studentStats[p].totalMax += max;
        studentStats[p].count++;
    });

    const leaderboard = Object.values(studentStats)
        .map(s => ({ 
            ...s, avgPct: s.totalPct / s.count,
            avgScore: s.totalScore / s.count,
            avgMax: s.totalMax / s.count
        })).sort((a, b) => b.avgPct - a.avgPct);

    if (leaderboard.length === 0) { container.innerHTML = ""; return; }

    // 2. Render Table 
    let html = `
        <div class="bg-gray-900 border border-white/10 rounded-xl overflow-hidden shadow-lg mt-6">
            <div class="px-6 py-4 border-b border-white/10 bg-white/5 flex justify-between items-center">
                <h3 class="text-white font-bold uppercase tracking-wider text-sm flex items-center gap-2">
                    🏆 Leaderboard
                    ${contextLabel ? `<span class="px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-300 text-[10px] border border-primary-500/30">${contextLabel}</span>` : ""}
                </h3>
                
                <div class="group relative inline-block">
                    <button onclick="window.generateDashboardPDF('${contextLabel}')" class="p-1.5 bg-white/10 hover:bg-white/20 rounded text-gray-300 hover:text-white transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M12 9.75V1.5m0 0 9 9m-9-9-9 9" />
                        </svg>
                    </button>

                    <div class="absolute right-full mr-3 top-1/2 -translate-y-1/2 w-32 p-2 bg-gray-900/95 text-white text-[11px] leading-tight rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 text-center backdrop-blur-sm">
                        Download PDF Report
                        <div class="absolute left-full top-1/2 -translate-y-1/2 border-4 border-transparent border-l-gray-900/95"></div>
                    </div>
                </div>
            </div>
            <div class="max-h-[350px] overflow-y-auto">
                <table class="w-full text-left border-collapse">
                    <thead class="bg-gray-800 text-xs text-gray-400 uppercase sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th class="p-4 font-medium w-16 text-center">Rank</th>
                            <th class="p-4 font-medium">Participant</th>
                            <th class="p-4 font-medium">Class</th>
                            <th class="p-4 font-medium text-right">Count</th>
                            <th class="p-4 font-medium text-right">Avg Pts</th>
                            <th class="p-4 font-medium text-right">Avg %</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-white/5">`;

    let currentRank = 0, lastAvg = -1;
    leaderboard.forEach((s, index) => {
        if (s.avgPct !== lastAvg) { currentRank = index + 1; lastAvg = s.avgPct; }
        let rankDisplay = `<span class="font-mono text-gray-500 font-bold">#${currentRank}</span>`;
        if (currentRank === 1) rankDisplay = "🥇"; if (currentRank === 2) rankDisplay = "🥈"; if (currentRank === 3) rankDisplay = "🥉";
        const badge = s.group ? `<span class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary-500/20 text-primary-300 uppercase">👥 ${s.group}</span>` : "";

        html += `
            <tr class="hover:bg-white/5 transition-colors cursor-pointer group" onclick="window.generateScorecardPDF('${s.vidId}')">
                <td class="p-4 text-center text-lg">${rankDisplay}</td>
                <td class="p-4"><div class="font-bold text-white group-hover:text-primary-400 transition-colors">${s.name} ${badge}</div></td>
                <td class="p-4 text-sm text-gray-400">${s.className}</td>
                <td class="p-4 text-right text-sm text-gray-400">${s.count}</td>
                <td class="p-4 text-right font-mono text-sm text-gray-300"><span class="font-bold text-white">${Math.round(s.avgScore)}</span> <span class="opacity-50">/ ${Math.round(s.avgMax)}</span></td>
                <td class="p-4 text-right font-mono font-bold text-primary-400">${s.avgPct.toFixed(1)}%</td>
            </tr>`;
    });
    html += `</tbody></table></div></div>`;
    container.innerHTML = html;
}

/* ==========================================================================
   PROFESSIONAL PDF GENERATION
   ========================================================================== */

// 1. Generate Dashboard PDF (Leaderboard)
window.generateDashboardPDF = function(contextLabel = "Dashboard Report") {
    // SECURITY CHECK: Ensure we have data
    // If the user filtered the list, use that. Otherwise use everything.
    const videos = window.CURRENT_PRINT_DATA && window.CURRENT_PRINT_DATA.length > 0 
        ? window.CURRENT_PRINT_DATA 
        : ALL_VIDEOS; 

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const dateStr = new Date().toLocaleString();

    // -- HEADER --
    doc.setFontSize(18);
    doc.text("Seminar Cloud - Dashboard Report", 14, 20);
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated: ${dateStr}`, 14, 28);
    doc.text(`Filter Scope: ${contextLabel}`, 14, 33);

    // -- DATA PREPARATION --
    const studentStats = {};
    videos.forEach(v => {
        const p = v.participant || "Unknown";
        if (!studentStats[p]) {
            studentStats[p] = { name: p, class: v.classEventTitle || "-", score: 0, max: 0, count: 0 };
        }
        
        let max = 0;
        if (v.rubricId && CACHED_RUBRICS[v.rubricId]) {
            max = CACHED_RUBRICS[v.rubricId].rows.reduce((a, r) => a + r.maxPoints, 0);
        }
        
        studentStats[p].score += (Number(v.totalScore) || 0);
        studentStats[p].max += max;
        studentStats[p].count++;
    });

    // Calculate Averages
    const rows = Object.values(studentStats).map(s => {
        const avgScore = (s.score / s.count).toFixed(1);
        const avgMax = (s.max / s.count).toFixed(0);
        const rawPct = s.max > 0 ? (s.score / s.max) * 100 : 0;
        
        return [
            0,                        // Rank placeholder
            s.name,                   // Participant
            s.class,                  // Class
            s.count,                  // Count
            `${avgScore} / ${avgMax}`, // Score
            rawPct.toFixed(1) + "%",  // Display %
            rawPct                    // Hidden raw % for sorting
        ];
    });

    // Sort High to Low
    rows.sort((a, b) => b[6] - a[6]);

    // ✅ CORRECT RANKING LOGIC (Handles Ties)
    let currentRank = 0;
    let lastPct = null;
    rows.forEach((row, index) => {
        const pct = row[6]; // Raw percentage
        if (pct !== lastPct) {
            currentRank = index + 1;
        }
        row[0] = currentRank; // Assign Rank
        lastPct = pct;
        row.pop(); // Remove the raw number helper before printing
    });

    // -- TABLE GENERATION --
    doc.autoTable({
        startY: 40,
        head: [['Rank', 'Participant', 'Class', 'Count', 'Avg Score', 'Avg %']],
        body: rows,
        theme: 'striped',
        headStyles: { fillColor: [41, 128, 185] }, 
        styles: { fontSize: 10, cellPadding: 3 },
        columnStyles: {
            0: { halign: 'center', cellWidth: 15 },
            3: { halign: 'center' },
            4: { halign: 'right' },
            5: { halign: 'right', fontStyle: 'bold' }
        }
    });

    // -- FOOTER --
    const pageCount = doc.internal.getNumberOfPages();
    for(let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`Page ${i} of ${pageCount}`, 196, 285, { align: 'right' });
    }

    doc.save(`seminar-dashboard-${Date.now()}.pdf`);
};

// 1. Generate Rubric Analysis PDF 
window.generateRubricAnalysisPDF = function(rubricTitle, totalVideos, avgScore, maxScore, rowStats, classLabel = "All Classes") {
    if (!window.jspdf || !window.jspdf.jsPDF) { alert("PDF Library not loaded."); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const dateStr = new Date().toLocaleString();

    doc.setFontSize(18);
    doc.text("Rubric Analysis Report", 14, 20);
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated: ${dateStr}`, 14, 28);
    doc.text(`Rubric: ${rubricTitle}`, 14, 33);
    
    // Pass class label for PDF Header
    doc.text(`Class: ${classLabel}`, 14, 38);

    doc.setLineWidth(0.5); doc.setDrawColor(200);
    doc.line(14, 43, 196, 43); // Shifted down

    doc.setFillColor(245, 247, 250);
    doc.roundedRect(14, 50, 182, 30, 3, 3, 'F'); // Shifted down
    
    doc.setFontSize(12); doc.setTextColor(0); doc.setFont(undefined, 'bold');
    doc.text("Total Assessments", 20, 60);
    doc.text("Average Score", 100, 60);

    doc.setFontSize(22);
    doc.text(String(totalVideos), 20, 73);
    doc.text(`${avgScore} / ${maxScore}`, 100, 73);

    const tableBody = rowStats.map(stat => {
        const percent = stat.max > 0
            ? (stat.avg / stat.max) * 100
            : 0;

        return [
            stat.title,
            { content: "", percent },   
            `${stat.avg.toFixed(1)} / ${stat.max}`
        ];
    });

    doc.autoTable({
        startY: 90, // Shifted down
        head: [['Skill / Criterion', 'Performance Distribution (Green/Yellow/Red)', 'Avg Score']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [52, 73, 94] },
        columnStyles: {
            0: { cellWidth: 70, fontStyle: 'bold' },
            1: { cellWidth: 80 },
            2: { cellWidth: 30, halign: 'center', fontStyle: 'bold' }
        },
        didDrawCell: function (data) {
            if (data.column.index !== 1 || data.cell.section !== 'body') return;

            const cell = data.cell;
            const scoreCell = data.row.cells[2];
            if (!scoreCell || !scoreCell.raw) return;

            const parts = String(scoreCell.raw).split(" / ");
            const score = parseFloat(parts[0]);
            const max   = parseFloat(parts[1]);
            if (!max || isNaN(score)) return;

            const pct = Math.max(0, Math.min(1, score / max));

            const paddingX  = 6;
            const barHeight = 6;            
            const radius    = barHeight / 2;

            const barWidth   = cell.width - paddingX * 2;
            const filledW    = barWidth * pct;

            const x = cell.x + paddingX;
            const y = cell.y + (cell.height / 2) - (barHeight / 2);

            doc.setFillColor(230, 230, 230);
            doc.roundedRect(x, y, barWidth, barHeight, radius, radius, 'F');

            if (pct >= 0.8) {
                doc.setFillColor(34, 197, 94);      
            } else if (pct >= 0.6) {
                doc.setFillColor(250, 204, 21);     
            } else {
                doc.setFillColor(239, 68, 68);      
            }

            if (filledW > 0) {
                doc.roundedRect(x, y, filledW, barHeight, radius, radius, 'F');
            }
        },
    });

    doc.save(`Rubric_Analysis_${Date.now()}.pdf`);
};

// 2. Generate Individual Scorecard PDF 
window.generateScorecardPDF = async function(videoId) {
    if (!window.jspdf || !window.jspdf.jsPDF) { alert("PDF Library not loaded."); return; }

    const video = ALL_VIDEOS.find(v => v.id === videoId);
    if (!video) return alert("Error: Video data not found.");
    
    let rubric = null;
    if (video.rubricId) {
        if (CACHED_RUBRICS[video.rubricId]) {
            rubric = CACHED_RUBRICS[video.rubricId];
        } else if (typeof getRubricById === 'function') {
            rubric = await getRubricById(video.rubricId);
        }
    }
    if (!rubric) return alert("Error: Rubric data missing.");

    // Remove Debug Log in production
    // console.log("DEBUG RUBRIC DATA:", JSON.stringify(rubric, null, 2)); 

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(18); doc.text("Student Assessment Scorecard", 14, 20);
    doc.setLineWidth(0.5); doc.line(14, 25, 196, 25); 

    doc.setFontSize(11); doc.setTextColor(0);
    
    doc.setFont(undefined, 'bold'); doc.text("Participant:", 14, 35);
    doc.setFont(undefined, 'normal'); doc.text(video.participant || "Unknown", 45, 35);
    
    doc.setFont(undefined, 'bold'); doc.text("Class:", 14, 42);
    doc.setFont(undefined, 'normal'); doc.text(video.classEventTitle || "N/A", 45, 42);

    doc.setFont(undefined, 'bold'); doc.text("Rubric:", 14, 49);
    doc.setFont(undefined, 'normal'); doc.text(rubric.title || "Untitled Rubric", 45, 49);

    doc.setFont(undefined, 'bold'); doc.text("Date:", 140, 35);
    doc.setFont(undefined, 'normal'); doc.text(new Date(video.recordedAt).toLocaleDateString(), 155, 35);

    const maxScore = rubric.rows.reduce((acc, r) => acc + r.maxPoints, 0);
    const pct = ((video.totalScore / maxScore) * 100).toFixed(1);
    
    doc.setFont(undefined, 'bold'); doc.text("Score:", 140, 42);
    doc.setFont(undefined, 'normal'); doc.text(`${video.totalScore} / ${maxScore} (${pct}%)`, 155, 42);

    const tableBody = rubric.rows.map(row => {
        const scoreVal = getNormalizedScore(video, row);
        
        const rawPct = row.maxPoints > 0 ? (scoreVal / row.maxPoints) : 0;
        const rowPct = Math.max(0, Math.min(1, rawPct));

        // ✅ FIX: Dual-Check for Description Data 
        // 1. Try 'scoreDescriptions' (Map)
        // 2. Try 'allowedScores' (Array of Objects)
        
        let descText = "—";
        const key = String(Math.round(scoreVal)); 
        
        if (row.scoreDescriptions && row.scoreDescriptions[key]) {
            descText = row.scoreDescriptions[key];
        } else if (row.allowedScores && Array.isArray(row.allowedScores)) {
             // Find matching value in array (handle string/number loose match)
             const match = row.allowedScores.find(s => s.value == key);
             if (match && match.label) {
                 descText = match.label;
             }
        } else if (row.description || row.desc) {
            descText = row.description || row.desc;
        }

        // Fallback
        if (descText === "—") {
             descText = `Score: ${scoreVal} / ${row.maxPoints}`;
        }

        return [
            row.label || row.title || "Criterion",
            descText,
            { content: "", rowPct: rowPct },
            `${scoreVal} / ${row.maxPoints}`
        ];
    });

    doc.autoTable({
        startY: 58, 
        head: [['Criterion', 'Description', 'Performance', 'Score']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [44, 62, 80] },
        columnStyles: {
            0: { cellWidth: 45, fontStyle: 'bold' },
            1: { cellWidth: 'auto' }, 
            2: { cellWidth: 35 },     
            3: { cellWidth: 20, halign: 'center', fontStyle: 'bold' }
        },
        didDrawCell: function(data) {
            if (data.column.index === 2 && data.cell.section === 'body') {
                const cell = data.cell;
                const rowPct = data.row.raw[2].rowPct || 0;

                let color = [239, 68, 68]; 
                if (rowPct >= 0.8) color = [34, 197, 94]; 
                else if (rowPct >= 0.6) color = [250, 204, 21]; 

                const paddingX = 3;
                const barHeight = 6; 
                const barWidth = cell.width - (paddingX * 2);
                const filledWidth = barWidth * rowPct;
                const x = cell.x + paddingX;
                const y = cell.y + (cell.height / 2) - (barHeight / 2);

                doc.setFillColor(235, 235, 235);
                doc.roundedRect(x, y, barWidth, barHeight, 1, 1, 'F');

                if (filledWidth > 0) {
                    doc.setFillColor(...color);
                    doc.roundedRect(x, y, filledWidth, barHeight, 1, 1, 'F');
                }
            }
        }
    });

    if (video.comments) {
        const finalY = doc.lastAutoTable.finalY + 10;
        doc.setFontSize(12); doc.setFont(undefined, 'bold');
        doc.text("Feedback:", 14, finalY);
        doc.setFontSize(10); doc.setFont(undefined, 'normal');
        doc.text(doc.splitTextToSize(video.comments, 180), 14, finalY + 7);
    }

    const safeName = (video.participant || "Student").replace(/[^a-z0-9]/gi, '_');
    doc.save(`${safeName}_Scorecard.pdf`);
};