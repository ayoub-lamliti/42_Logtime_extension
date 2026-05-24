"use strict";
(() => {
  // ─── CONFIGURATION ──────────────────────────────────────────────────────────
  const WEEKLY_QUOTA_HOURS = 30;
  const MILESTONES = [20, 25, 30];

  // ─── SHARED STATE ───────────────────────────────────────────────────────────
  let currentHours = 0;

  // ─── STORAGE FUNCTIONS ──────────────────────────────────────────────────────
  function get(keys) {
    return new Promise((resolve, reject) => chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    }));
  }

  function set(items) {
    return new Promise((resolve, reject) => chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    }));
  }

  async function getStoredTokens() {
    const r = await get(["access_token", "refresh_token", "expires_at"]);
    if (r.access_token && r.refresh_token && r.expires_at) {
      return { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: r.expires_at };
    }
    return null;
  }

  async function getStoredHours() {
    const r = await get(["logged_hours"]);
    return typeof r.logged_hours === "number" ? r.logged_hours : null;
  }

  async function getStartDay() {
    const r = await get(["start_day"]);
    return typeof r.start_day === "number" ? r.start_day : 1;
  }

  async function setStartDay(day) {
    await set({ start_day: day });
  }

  // ─── DOM ELEMENTS ───────────────────────────────────────────────────────────
  const viewLoading = document.getElementById("view-loading");
  const viewAuth    = document.getElementById("view-auth");
  const viewMain    = document.getElementById("view-main");
  const viewError   = document.getElementById("view-error");

  const btnConnect = document.querySelector(".p-btn-connect");
  const btnLogout  = document.querySelector(".p-btn-logout");
  const btnRefresh = document.querySelector(".p-btn-refresh");
  const btnRetry   = document.querySelector(".p-btn-retry");

  const elHours        = document.getElementById("h-value");
  const elProgressFill = document.getElementById("prog-fill");
  const elStatusText   = document.getElementById("prog-status");
  const elErrorMsg     = document.getElementById("error-msg");
  const startDaySelect = document.getElementById("week-start");
  const dot            = document.getElementById("status-dot");
  const todayCard      = document.getElementById("today-card");

  // ─── UI LOGIC ───────────────────────────────────────────────────────────────
  function showView(view) {
    document.querySelectorAll(".p-view").forEach(v => v.classList.remove("active"));
    const map = {
      loading:         "view-loading",
      unauthenticated: "view-auth",
      authenticated:   "view-main",
      error:           "view-error"
    };
    document.getElementById(map[view]).classList.add("active");
    dot.className = "p-status-dot" + (view === "authenticated" ? "" : view === "error" ? " error" : " offline");
  }

  function showError(message) {
    elErrorMsg.textContent = message;
    showView("error");
  }

  function renderProgress(hours) {
    currentHours = hours;
    const capped = Math.min(hours, WEEKLY_QUOTA_HOURS);
    const pct    = (capped / WEEKLY_QUOTA_HOURS) * 100;

    elHours.textContent = hours.toFixed(1) + "h";

    elProgressFill.className   = "prog-fill";
    elProgressFill.style.width = `${pct}%`;

    if (hours >= WEEKLY_QUOTA_HOURS) {
      elProgressFill.classList.add("danger");
    } else if (hours >= 25) {
      elProgressFill.classList.add("warn");
    }
  }

  function updateLiveTimer() {
    const selectVal = parseInt(startDaySelect.value, 10);
    const targetDay = isNaN(selectVal) ? 1 : selectVal;

    const now       = new Date();
    const dayOfWeek = now.getDay();
    let diff        = dayOfWeek - targetDay;
    if (diff < 0) diff += 7;

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - diff);
    weekStart.setHours(0, 0, 0, 0);

    const deadline    = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const remainingMs = Math.max(0, deadline.getTime() - now.getTime());

    const d = Math.floor(remainingMs / 86400000);
    const h = Math.floor((remainingMs % 86400000) / 3600000);
    const m = Math.floor((remainingMs % 3600000) / 60000);

    // ── Days left ──────────────────────────────────────────────────────────
    // Show remaining full days. If <1 day left, show "< 1"
    const daysLeft = d + (h > 0 || m > 0 ? 1 : 0);
    document.getElementById("t-days").textContent = daysLeft > 0 ? String(daysLeft) : "0";

    // Keep hidden compat hooks
    document.getElementById("t-hours").textContent = String(h).padStart(2, "0");
    document.getElementById("t-mins").textContent  = String(m).padStart(2, "0");

    // ── Daily target ────────────────────────────────────────────────────────
    const hoursLeft   = Math.max(0, WEEKLY_QUOTA_HOURS - currentHours);
    const dailyTarget = daysLeft > 0
      ? (hoursLeft / daysLeft).toFixed(1)
      : "0.0";
    document.getElementById("today-target").textContent = "Target today: " + dailyTarget + "h";

    // ── Pace status ─────────────────────────────────────────────────────────
    // Days elapsed since week start
    const daysElapsed = 7 - daysLeft;
    const weekStatusEl  = document.getElementById("week-status");

    if (currentHours >= WEEKLY_QUOTA_HOURS) {
      // Quota done
      weekStatusEl.textContent = "Done!";
      weekStatusEl.className   = "stat-val green";
      todayCard.className      = "today-card on-track";
    } else if (daysElapsed <= 0) {
      // First moments of week — no data to judge pace
      weekStatusEl.textContent = "--";
      weekStatusEl.className   = "stat-val";
      todayCard.className      = "today-card";
    } else {
      // Expected hours at this point in the week
      const expectedHours = daysElapsed * (WEEKLY_QUOTA_HOURS / 7);
      if (currentHours >= expectedHours) {
        weekStatusEl.textContent = "On track";
        weekStatusEl.className   = "stat-val green";
        todayCard.className      = "today-card on-track";
      } else {
        weekStatusEl.textContent = "Behind";
        weekStatusEl.className   = "stat-val red";
        todayCard.className      = "today-card behind";
      }
    }
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(response);
      });
    });
  }

  // ─── INITIALIZATION ─────────────────────────────────────────────────────────
  async function init() {
    showView("loading");

    const tokens = await getStoredTokens();
    if (!tokens) { showView("unauthenticated"); return; }

    const savedDay = await getStartDay();
    startDaySelect.value = savedDay.toString();

    const hours = await getStoredHours();
    if (hours === null) {
      await sendMessage({ type: "FORCE_CHECK" }).catch(() => null);
      const freshHours = await getStoredHours();
      if (freshHours === null) {
        showError("Could not load logtime data. Try refreshing.");
        return;
      }
      renderProgress(freshHours);
    } else {
      renderProgress(hours);
    }

    updateLiveTimer();
    setInterval(updateLiveTimer, 60000);
    showView("authenticated");
  }

  // ─── EVENT LISTENERS ────────────────────────────────────────────────────────
  btnConnect.addEventListener("click", async () => {
    btnConnect.disabled  = true;
    btnConnect.innerHTML = `<span class="btn-spinner"></span> Connecting...`;
    showView("loading");

    const response = await sendMessage({ type: "START_AUTH" }).catch(
      (err) => ({ success: false, error: err.message })
    );

    if (!response.success) {
      btnConnect.disabled  = false;
      btnConnect.innerHTML = `Connect to 42 Intra`;
      showError(`Authentication failed: ${response.error}`);
      return;
    }
    await init();
  });

  btnLogout.addEventListener("click", async () => {
    await sendMessage({ type: "LOGOUT" }).catch(() => null);
    showView("unauthenticated");
  });

  btnRefresh.addEventListener("click", async () => {
    btnRefresh.disabled  = true;
    btnRefresh.innerHTML = `<span class="btn-spinner"></span> Refreshing...`;

    await sendMessage({ type: "FORCE_CHECK" }).catch(() => null);
    const hours = await getStoredHours();
    if (hours !== null) renderProgress(hours);
    updateLiveTimer();

    btnRefresh.disabled  = false;
    btnRefresh.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Refresh`;
  });

  btnRetry.addEventListener("click", () => {
    init().catch((err) => showError(err.message));
  });

  startDaySelect.addEventListener("change", async (e) => {
    const newDay = parseInt(e.target.value, 10);
    await setStartDay(newDay);
    if (typeof updateLiveTimer === "function") updateLiveTimer();

    btnRefresh.disabled = true;
    showView("loading");
    await sendMessage({ type: "FORCE_CHECK" }).catch(() => null);
    const hours = await getStoredHours();
    if (hours !== null) renderProgress(hours);
    showView("authenticated");
    btnRefresh.disabled = false;
  });

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((err) => showError(err.message));
  });
})();