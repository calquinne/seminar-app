/* ========================================================================== */
/* MODULE: analytics.js
/* Aggregates Firestore data and renders the dashboard.
/* ========================================================================== */

import * as UI from "./ui.js";
import { collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export async function loadAnalytics() {
    const container = document.getElementById("analytics-dashboard");
    const loading = document.getElementById("analytics-loading");
    
    if (!UI.currentUser) return;

    // Show loading, hide dashboard
    if (loading) loading.classList.remove("hidden");
    if (container) container.classList.add("hidden");

    try {
        // 1. Fetch ALL videos for the user
        // We fetch all to compute averages. In a massive app, we'd use server-side aggregation,
        // but for a personal PWA, fetching 100-500 items is instant.
        const ref = collection(UI.db, `artifacts/${UI.getAppId()}/users/${UI.currentUser.uid}/videos`);
        const q = query(ref, orderBy("recordedAt", "desc"));
        const snapshot = await getDocs(q);

        const videos = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Only count videos that have actually been scored
            if (data.hasScore && data.totalScore !== undefined) {
                videos.push({ id: doc.id, ...data });
            }
        });

        // 2. Compute Statistics
        const stats = computeStats(videos);

        // 3. Render
        renderHeadlines(stats);
        renderClassTable(stats.classBreakdown);
        renderRecentList(videos.slice(0, 5)); // Top 5 recent

        // Show dashboard
        if (loading) loading.classList.add("hidden");
        if (container) container.classList.remove("hidden");

    } catch (err) {
        console.error("Analytics load failed:", err);
        UI.toast("Failed to load analytics.", "error");
        if (loading) loading.classList.add("hidden");
    }
}

function computeStats(videos) {
    if (videos.length === 0) {
        return { total: 0, avg: 0, topScore: 0, topStudent: "N/A", classBreakdown: {} };
    }

    let sum = 0;
    let max = -1;
    let topStudent = "-";
    const classes = {};

    videos.forEach(v => {
        const score = Number(v.totalScore) || 0;
        const className = v.classEventTitle || "Uncategorized";

        // Global Stats
        sum += score;
        if (score > max) {
            max = score;
            topStudent = v.participant || "Unknown";
        }

        // Class Grouping
        if (!classes[className]) classes[className] = { sum: 0, count: 0, scores: [] };
        classes[className].sum += score;
        classes[className].count += 1;
        classes[className].scores.push(score);
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
    const safeSet = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    safeSet("stat-total-videos", stats.total);
    safeSet("stat-avg-score", stats.avg);
    safeSet("stat-top-performer", stats.topStudent);
    safeSet("stat-top-score", stats.topScore > -1 ? `${stats.topScore} pts` : "-");
}

function renderClassTable(classes) {
    const container = document.getElementById("analytics-class-list");
    if (!container) return;
    container.innerHTML = "";

    const sortedKeys = Object.keys(classes).sort();

    if (sortedKeys.length === 0) {
        container.innerHTML = `<div class="text-sm text-gray-500 italic p-4">No class data available.</div>`;
        return;
    }

    sortedKeys.forEach(className => {
        const data = classes[className];
        const avg = (data.sum / data.count).toFixed(1);
        
        // Simple visual bar for average (assuming max score roughly 100 for scale, or just relative)
        // We'll map 0-20pts scale for visual. Adjust width calculation if your rubrics are larger.
        const width = Math.min(100, (avg / 20) * 100); 

        const html = `
            <div class="p-3 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                <div class="flex justify-between items-center mb-1">
                    <span class="text-sm font-medium text-white">${className}</span>
                    <span class="text-xs text-primary-300 font-mono font-bold">${avg} avg</span>
                </div>
                <div class="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div class="h-full bg-primary-500 rounded-full" style="width: ${width}%"></div>
                </div>
                <div class="text-[10px] text-gray-500 mt-1 text-right">
                    ${data.count} recordings
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', html);
    });
}

function renderRecentList(recentVideos) {
    const container = document.getElementById("analytics-recent-list");
    if (!container) return;
    container.innerHTML = "";

    if (recentVideos.length === 0) {
        container.innerHTML = `<div class="text-sm text-gray-500 italic p-4">No recent activity.</div>`;
        return;
    }

    recentVideos.forEach(v => {
        const date = new Date(v.recordedAt).toLocaleDateString();
        const html = `
            <div class="flex items-center justify-between p-3 border-b border-white/5 last:border-0">
                <div>
                    <div class="text-sm text-white font-medium">${v.participant}</div>
                    <div class="text-xs text-gray-500">${v.classEventTitle} • ${date}</div>
                </div>
                <div class="text-right">
                    <div class="text-sm font-bold text-primary-400">${v.totalScore} pts</div>
                    <div class="text-[10px] text-gray-500 bg-white/10 px-1.5 py-0.5 rounded">${v.recordingType || 'imp'}</div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', html);
    });
}