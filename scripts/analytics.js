/* ========================================================================== */
/* MODULE: analytics.js (Final: Safe Events + Logic Sync + Hardened CSV)
/* ========================================================================== */

import * as UI from "./ui.js";
import * as Record from "./record.js";
import { collection, getDocs, query, orderBy, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* -------------------------------------------------------------------------- */
/* STATE */
/* -------------------------------------------------------------------------- */

let ALL_VIDEOS = [];
let CACHED_RUBRICS = {};

// TOP SECTION STATE (Controlled by Class List)
let TOP_SECTION_CLASS = "all"; 

/* -------------------------------------------------------------------------- */
/* LOAD ANALYTICS */
/* -------------------------------------------------------------------------- */

export async function loadAnalytics() {
  const container = document.getElementById("analytics-dashboard");
  const loading = document.getElementById("analytics-loading");

  if (!container) return;

  // 🚧 DEV MODE INTERCEPTOR
  if (window.__DEV_ANALYTICS__ || !UI.db) {
    if (loading) loading.classList.remove("hidden");
    container.classList.add("hidden");
    await new Promise(r => setTimeout(r, 500));
    generateMockData();
    initPage();
    if (loading) loading.classList.add("hidden");
    container.classList.remove("hidden");
    return;
  }

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

    snap.forEach(d => {
      const data = d.data();
      if (data.hasScore && data.totalScore !== undefined) {
        data.safeScores = data.finalScores || data.scores || {};
        data.recordedAt = (data.recordedAt && typeof data.recordedAt.toDate === 'function')
            ? data.recordedAt.toDate() : new Date(data.recordedAt);
        ALL_VIDEOS.push({ id: d.id, ...data });
        if (data.rubricId) rubricIds.add(data.rubricId);
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

function initPage() {
    populateFilterDropdowns(); 
    // This updates the top section AND triggers the bottom section update automatically
    updateGlobalDashboard("all"); 
}

/* -------------------------------------------------------------------------- */
/* LOGIC PART 1: TOP SECTION (Controlled by List)
/* -------------------------------------------------------------------------- */

function updateGlobalDashboard(className) {
    TOP_SECTION_CLASS = className;

    // SYNC: Update bottom dropdowns to match context
    const classSelect = document.getElementById("analytics-class-filter");
    if (classSelect) {
        classSelect.value = className;
        populateStudentDropdown(); 
        updateRubricSection();     
    }

    // 1. Filter Data (Class Only)
    const globalVideos = className === "all" 
        ? ALL_VIDEOS 
        : ALL_VIDEOS.filter(v => v.classEventTitle === className);

    // 2. Compute Stats
    const stats = computeStats(globalVideos);

    // 3. Render Widgets
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
    
    // 1. Filter Data
    let relevantVideos = ALL_VIDEOS;

    if (filterClass !== "all") {
        relevantVideos = relevantVideos.filter(v => v.classEventTitle === filterClass);
    }
    
    // 2. Handle View Mode
    const isStudentMode = filterStudent !== "all";
    const studentView = document.getElementById("analytics-student-view");
    const rubricContainer = document.getElementById("rubric-analysis-container");

    if (isStudentMode) {
        // Student Matrix Mode
        if (studentView) studentView.classList.remove("hidden");
        if (rubricContainer) rubricContainer.classList.add("hidden");
        
        const studentVideos = relevantVideos.filter(v => v.participant === filterStudent);
        renderStudentMatrix(filterStudent, studentVideos, relevantVideos);
    } else {
        // Rubric Analysis Mode
        if (studentView) studentView.classList.add("hidden");
        if (rubricContainer) rubricContainer.classList.remove("hidden");
        
        renderRubricCharts(relevantVideos);
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
    const row = document.createElement("div");
    row.className = "flex items-center justify-between p-3 border-b border-white/5 last:border-0 cursor-pointer hover:bg-white/10 transition-colors group";
    row.innerHTML = `<div><div class="text-sm text-white font-medium group-hover:text-primary-400 transition-colors">${v.participant}</div><div class="text-xs text-gray-500">${v.classEventTitle} • ${date}</div></div><div class="text-right"><div class="text-sm font-bold text-primary-400">${v.totalScore} pts</div></div>`;
    row.onclick = () => openScorecard(v.id);
    container.appendChild(row);
  });
}

function renderRubricCharts(relevantVideos) {
  const rubricSelect = document.getElementById("analytics-rubric-select");
  const container = document.getElementById("rubric-analysis-container");
  if (!rubricSelect || !container) return;

  const rubricId = rubricSelect.value;
  const rubric = CACHED_RUBRICS[rubricId];

  if (!rubricId || !rubric) {
    container.innerHTML = `<div class="p-4 text-gray-500 italic text-center">Select a rubric above to see the breakdown.</div>`;
    return;
  }

  const rubricVideos = relevantVideos.filter(v => v.rubricId === rubricId);
  
  container.innerHTML = "";
  
  // 1. Summary Card
  if (rubricVideos.length > 0) {
      const rubricMax = rubric.rows.reduce((sum, r) => sum + r.maxPoints, 0);
      const totalSum = rubricVideos.reduce((sum, v) => sum + (Number(v.totalScore) || 0), 0);
      const rubricAvg = totalSum / rubricVideos.length;
      const rawPercent = rubricMax > 0 ? (rubricAvg / rubricMax) * 100 : 0;
      const textCol = rawPercent >= 80 ? "text-green-400" : rawPercent >= 50 ? "text-yellow-400" : "text-red-400";

      let maxScore = -1;
      rubricVideos.forEach(v => { if ((Number(v.totalScore)||0) > maxScore) maxScore = Number(v.totalScore)||0; });
      const winners = [...new Set(rubricVideos.filter(v => (Number(v.totalScore)||0) === maxScore).map(v => v.participant))];
      
      let winnerHtml = winners.length === 1 ? `<div class="text-xl font-bold text-white truncate">${winners[0]}</div>` 
                     : winners.length === 2 ? `<div class="text-lg font-bold text-white leading-tight">${winners[0]} & ${winners[1]}</div>`
                     : `<div class="text-xl font-bold text-white underline decoration-dotted cursor-pointer hover:text-primary-400" id="rubric-total-tied-link">${winners.length} Participants</div>`;

      const summaryEl = document.createElement("div");
      summaryEl.className = `mb-6 p-6 rounded-xl bg-gray-900 border border-white/10 flex flex-wrap md:flex-nowrap items-center justify-between gap-6`;
      summaryEl.innerHTML = `<div class="flex items-center gap-4 min-w-[200px]"><div class="p-3 bg-white/5 rounded-lg border border-white/10 hidden sm:block"><span class="text-2xl">📊</span></div><div><div class="text-lg font-bold text-white">Rubric Total</div><div class="text-xs text-gray-400 uppercase tracking-wider">Overall Performance</div></div></div><div class="hidden md:block w-px h-12 bg-white/10"></div><div class="flex flex-col min-w-[100px]"><div class="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Total Videos</div><div class="text-4xl font-black text-white">${rubricVideos.length}</div></div><div class="hidden md:block w-px h-12 bg-white/10"></div><div class="flex flex-col min-w-[150px]"><div class="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">AVG Score</div><div class="flex items-baseline gap-2"><span class="text-4xl font-black ${textCol}">${rubricAvg.toFixed(1)}</span><span class="text-lg text-gray-500 font-medium">/ ${rubricMax}</span></div></div><div class="hidden md:block w-px h-12 bg-white/10"></div><div class="flex-1 min-w-[200px]"><div class="text-xs font-bold text-primary-400 uppercase tracking-widest mb-1">Top Performer</div><div class="flex items-center justify-between gap-4">${winnerHtml}<div class="text-xl font-mono font-bold text-primary-400 whitespace-nowrap">${maxScore} pts</div></div></div>`;
      
      container.appendChild(summaryEl);
      
      // ✅ FIX: Safe Event Listener (No global overwrite)
      const tiedLink = summaryEl.querySelector("#rubric-total-tied-link");
      if(tiedLink) tiedLink.onclick = () => showTopPerformerList(winners, maxScore);
  }

  // 2. Row Breakdown
  let renderedAny = false;
  rubric.rows.forEach(row => {
    const scores = [];
    const scoreCounts = {};
    rubricVideos.forEach(v => {
      const s = v.safeScores[row.id];
      if (s !== undefined && s !== null) {
          const val = Number(s);
          if (!Number.isFinite(val)) return;
          scores.push(val);
          if (!scoreCounts[val]) scoreCounts[val] = [];
          scoreCounts[val].push({ name: v.participant, vidId: v.id });
      }
    });

    if (!scores.length) return;
    renderedAny = true;

    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const rawPercent = row.maxPoints > 0 ? (avg / row.maxPoints) * 100 : 0;
    const visualPercent = Math.max(0, Math.min(100, Math.round(rawPercent)));
    const barHtml = renderSegmentedBar(visualPercent);
    const uniqueScores = Object.keys(scoreCounts).sort((a,b) => b - a);
    
    let buttonsHtml = `<div class="flex flex-wrap gap-2 mt-2">`;
    uniqueScores.forEach(score => {
        const count = scoreCounts[score].length;
        const sPercent = row.maxPoints > 0 ? (score / row.maxPoints) * 100 : 0;
        let btnClasses = sPercent >= 80 ? "bg-green-500/10 border-green-500/50 text-white" : sPercent >= 50 ? "bg-yellow-500/10 border-yellow-500/50 text-white" : "bg-red-500/10 border-red-500/50 text-white";
        buttonsHtml += `<button class="breakdown-btn flex flex-col items-center justify-center w-16 h-14 border rounded-lg hover:scale-105 transition-transform ${btnClasses}" data-score="${score}" data-row="${row.label}"><span class="text-lg font-bold leading-none shadow-sm">${count}</span><span class="text-[10px] text-gray-300 font-medium">scored ${score}</span></button>`;
    });
    buttonsHtml += `</div>`;

    const rowEl = document.createElement("div");
    rowEl.className = "bg-gray-900 border border-white/10 rounded-xl mb-4 overflow-hidden";
    rowEl.innerHTML = `<div class="p-5 flex flex-wrap md:flex-nowrap items-center gap-6"><div class="w-full md:w-1/3 flex flex-col gap-3"><div><div class="text-lg font-bold text-white">${row.label}</div><div class="text-xs text-gray-400">Rubric Category</div></div>${buttonsHtml}</div><div class="w-full md:flex-1 flex flex-col justify-center px-4"><div class="flex items-center gap-3 mb-1">${barHtml}<span class="text-sm font-bold text-white min-w-[3ch]">${Math.round(rawPercent)}%</span></div></div><div class="w-full md:w-auto text-right flex flex-col items-end gap-1 min-w-[100px]"><div class="text-sm font-bold text-gray-300 leading-none mb-1">MAX ${row.maxPoints}</div><div class="px-4 py-3 rounded-lg border border-white/10 bg-white/5"><div class="text-3xl font-extrabold text-white leading-none">${avg.toFixed(1)}</div><div class="text-[10px] uppercase text-white/70 text-right mt-1">AVG</div></div></div></div>`;
    
    // Attach Listeners
    const btns = rowEl.querySelectorAll(".breakdown-btn");
    btns.forEach(btn => {
        const s = Number(btn.dataset.score);
        const lbl = btn.dataset.row;
        btn.onclick = () => showScoreBreakdown(lbl, s, scoreCounts[s]);
    });

    container.appendChild(rowEl);
  });

  // ✅ FIX: Don't wipe summary card if videos exist but rows don't
  if (!renderedAny && rubricVideos.length === 0) {
      container.innerHTML = `<div class="p-4 text-gray-500 italic text-center">No scored rows available for this rubric.</div>`;
  } else if (!renderedAny) {
      const msg = document.createElement("div");
      msg.className = "p-4 text-gray-500 italic text-center border-t border-white/10 mt-4";
      msg.textContent = "No individual row data available for these videos.";
      container.appendChild(msg);
  }
}

function renderStudentMatrix(studentName, myVideos, classVideos) {
  const container = document.getElementById("analytics-student-view");
  if (!container) return;

  const totalScore = myVideos.reduce((sum, v) => sum + (Number(v.totalScore)||0), 0);
  const myAvg = myVideos.length ? (totalScore / myVideos.length) : 0;
  
  const studentAvgs = {};
  classVideos.forEach(v => {
      const p = v.participant;
      if(!studentAvgs[p]) studentAvgs[p] = { sum: 0, count: 0 };
      studentAvgs[p].sum += (Number(v.totalScore)||0);
      studentAvgs[p].count += 1;
  });
  const sortedRanks = Object.entries(studentAvgs).map(([name, data]) => ({ name, avg: data.sum / data.count })).sort((a, b) => b.avg - a.avg);
  const myRank = sortedRanks.findIndex(s => s.name === studentName) + 1;
  const totalStudents = sortedRanks.length;

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

          html += `<div class="bg-gray-900 border border-white/5 rounded-lg overflow-hidden transition-all hover:border-white/20 shadow-sm"><div class="p-4 flex flex-wrap items-center justify-between gap-4 cursor-pointer" onclick="this.nextElementSibling.classList.toggle('hidden')"><div class="w-full md:w-1/4"><div class="text-lg font-bold text-white truncate">${group.title}</div><div class="text-xs text-gray-400">${group.videos.length} Assessment(s)</div></div><div class="flex-1 min-w-[150px]"><div class="flex justify-between text-xs mb-1"><span class="text-gray-400">Performance</span><span class="font-bold text-white">${Math.round(pct)}%</span></div><div class="h-2 bg-gray-700 rounded-full overflow-hidden relative"><div class="absolute top-0 bottom-0 w-0.5 bg-white/50 z-10" style="left: ${classAvgPct}%" title="Class Avg"></div><div class="h-full ${barColor} relative z-0" style="width: ${pct}%"></div></div></div><div class="w-full md:w-auto flex items-center gap-8 justify-end min-w-[180px]"><div class="text-right"><div class="text-lg font-bold text-white">${studentAvg.toFixed(1)}</div><div class="text-[10px] text-gray-500 uppercase">My Avg</div></div><div class="text-right border-l border-white/10 pl-4"><div class="text-lg font-bold ${comparisonColor} flex items-center justify-end gap-1">${classAvg.toFixed(1)} <span class="text-xs opacity-70">${comparisonArrow}</span></div><div class="text-[10px] text-gray-500 uppercase">Class Avg</div></div><div class="text-gray-500 pl-2">▼</div></div></div><div class="hidden border-t border-white/5 bg-black/20 p-4 space-y-2">${group.videos.map(v => `<div class="flex justify-between items-center p-2 rounded hover:bg-white/5 cursor-pointer" onclick="window.analyticsOpenScorecard('${v.id}')"><div class="text-sm text-gray-300"><span class="text-white font-medium">${v.classEventTitle}</span><span class="mx-2 text-gray-600">•</span>${v.recordedAt.toLocaleDateString()}</div><div class="text-sm font-bold text-white">${v.totalScore} <span class="text-gray-500 font-normal">/ ${max}</span> →</div></div>`).join("")}</div></div>`;
      });
  }
  html += `</div>`;
  container.innerHTML = html;
}

/* -------------------------------------------------------------------------- */
/* UTILS & DATA
/* -------------------------------------------------------------------------- */

function populateFilterDropdowns() {
  const classSelect = document.getElementById("analytics-class-filter");
  const rubricSelect = document.getElementById("analytics-rubric-select");
  const studentSelect = document.getElementById("analytics-student-filter"); 

  if (!classSelect || !rubricSelect) return;

  const classes = [...new Set(ALL_VIDEOS.map(v => v.classEventTitle).filter(Boolean))].sort();
  classSelect.innerHTML = `<option value="all">All Classes</option>`;
  classes.forEach(c => classSelect.innerHTML += `<option>${c}</option>`);

  rubricSelect.innerHTML = Object.entries(CACHED_RUBRICS).map(([id, r]) => `<option value="${id}">${r.title}</option>`).join("");
  if (rubricSelect.options.length > 0) rubricSelect.selectedIndex = 0;

  if (studentSelect) {
      populateStudentDropdown(); // Use helper
  }

  // Listeners
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
  const winners = videos.filter(v => (Number(v.totalScore) || 0) === maxScore).map(v => v.participant);
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

function generateMockData() {
  const mockRubricId = "rubric_dev_1";
  CACHED_RUBRICS[mockRubricId] = { title: "Presentation Skills (Dev)", rows: [ { id: "r1", label: "Clarity", maxPoints: 10 }, { id: "r2", label: "Volume & Pace", maxPoints: 10 }, { id: "r3", label: "Body Language", maxPoints: 10 }, { id: "r4", label: "Content Mastery", maxPoints: 20 } ] };
  ALL_VIDEOS = [];
  const students = ["Alice Dev", "Bob Test", "Charlie Code", "Diana Debug", "Evan Error"];
  const classes = ["Intro to Computer Science", "Public Speaking 101"];
  for (let i = 0; i < 15; i++) {
    const student = students[i % students.length];
    const className = classes[i % classes.length];
    let s1, s2, s3, s4;
    if (i < 4) { s1 = 10; s2 = 10; s3 = 10; s4 = 18; } else { s1 = Math.floor(Math.random() * 4) + 6; s2 = Math.floor(Math.random() * 4) + 6; s3 = Math.floor(Math.random() * 4) + 6; s4 = Math.floor(Math.random() * 8) + 10; }
    const total = s1 + s2 + s3 + s4;
    ALL_VIDEOS.push({ id: `vid_dev_${i}`, participant: student, classEventTitle: className, recordedAt: new Date(Date.now() - (i * 86400000)), totalScore: total, hasScore: true, rubricId: mockRubricId, safeScores: { "r1": s1, "r2": s2, "r3": s3, "r4": s4 }, rowNotes: { "r1": "Great clarity!", "r2": "Speak up a bit more." } });
  }
}

export function openScorecard(videoId) {
  const video = ALL_VIDEOS.find(v => v.id === videoId);
  if (!video) return;
  const modal = document.getElementById("analytics-scorecard-modal");
  const container = document.getElementById("analytics-scorecard-body");
  const rubricDef = CACHED_RUBRICS[video.rubricId];
  if (!rubricDef) { UI.toast("Rubric definition not found.", "error"); return; }
  const elName = document.getElementById("scorecard-student-name");
  const elSub = document.getElementById("scorecard-subtitle");
  const elTotal = document.getElementById("scorecard-total");
  if (elName) elName.textContent = video.participant;
  if (elSub) elSub.textContent = `${video.classEventTitle} • ${video.recordedAt.toLocaleDateString()}`;
  if (elTotal) elTotal.textContent = video.totalScore;
  if (modal && container) {
    if (Record && Record.renderLiveScoringFromRubric) {
        Record.renderLiveScoringFromRubric({ finalScores: video.safeScores, rowNotes: video.rowNotes, rubricSnapshot: rubricDef }, "analytics", { readOnly: true, container: container });
        modal.showModal();
    } else { container.innerHTML = "<p>Scorecard viewer not loaded.</p>"; modal.showModal(); }
  }
}

// Global helpers needed for HTML inline onclick
window.analyticsOpenScorecard = openScorecard;

function showScoreBreakdown(rowLabel, score, students) {
    const modal = document.getElementById("score-breakdown-modal");
    const title = document.getElementById("breakdown-modal-title");
    const sub = document.getElementById("breakdown-modal-subtitle");
    const list = document.getElementById("breakdown-student-list");
    if (!modal || !list) return;
    title.textContent = rowLabel; sub.textContent = `Score: ${score} pts`; list.innerHTML = "";
    students.forEach(s => {
        const li = document.createElement("li");
        li.className = "flex justify-between items-center p-2 bg-white/5 rounded text-sm text-gray-200 border border-white/5 group hover:bg-white/10 transition-colors cursor-pointer";
        li.innerHTML = `<span>${s.name}</span><span class="text-xs text-primary-400 opacity-0 group-hover:opacity-100">View →</span>`;
        li.onclick = () => { modal.close(); openScorecard(s.vidId); };
        list.appendChild(li);
    });
    modal.showModal();
}

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

export async function downloadCSV() {
    let videosToExport = ALL_VIDEOS;
    // Get filter values directly
    const classSelect = document.getElementById("analytics-class-filter");
    const studentSelect = document.getElementById("analytics-student-filter");

    const filterClass = classSelect ? classSelect.value : "all";
    const filterStudent = studentSelect ? studentSelect.value : "all";

    // 1. Filter by Class
    if (filterClass !== "all") {
        videosToExport = videosToExport.filter(v => v.classEventTitle === filterClass);
    }

    // 2. Filter by Student (Drill-down)
    if (filterStudent !== "all") {
        videosToExport = videosToExport.filter(v => v.participant === filterStudent);
    }

    if (!videosToExport.length) { UI.toast("No data to export.", "info"); return; }
    let csvContent = "data:text/csv;charset=utf-8,Participant,Class,Date,Total Score,Rubric Used,Notes\n";
    videosToExport.forEach(v => {
        const date = v.recordedAt ? v.recordedAt.toISOString().split("T")[0] : "";
        const rubricName = CACHED_RUBRICS[v.rubricId] ? CACHED_RUBRICS[v.rubricId].title : "Unknown";
        const safeName = `"${(v.participant || "").replace(/"/g, '""')}"`;
        const safeClass = `"${(v.classEventTitle || "").replace(/"/g, '""')}"`;
        const safeRubric = `"${rubricName.replace(/"/g, '""')}"`;
        csvContent += `${safeName},${safeClass},${date},${v.totalScore},${safeRubric},""\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "seminar_data_export.csv");
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}