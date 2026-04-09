"use strict";
(() => {
  // ─── CONFIGURATION ──────────────────────────────────────────────────────────
  const WEEKLY_QUOTA_HOURS = 30;
  const MILESTONES = [20, 25, 30];

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
      return {
        access_token: r.access_token,
        refresh_token: r.refresh_token,
        expires_at: r.expires_at
      };
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
  const viewAuth = document.getElementById("view-auth");
  const viewMain = document.getElementById("view-main");
  const viewError = document.getElementById("view-error");

  const btnConnect = document.querySelector(".p-btn-connect");
  const btnLogout = document.querySelector(".p-btn-logout");
  const btnRefresh = document.querySelector(".p-btn-refresh");
  const btnRetry = document.querySelector(".p-btn-retry");

  const elHours = document.getElementById("h-value");
  const elProgressFill = document.getElementById("prog-fill");
  const elStatusText = document.getElementById("prog-status");
  const elErrorMsg = document.getElementById("error-msg");
  const startDaySelect = document.getElementById("week-start");
  const dot = document.getElementById('status-dot');

  // ─── UI LOGIC ───────────────────────────────────────────────────────────────
  function showView(view) {
    document.querySelectorAll('.p-view').forEach(v => v.classList.remove('active'));

    const map = {
      loading: 'view-loading',
      unauthenticated: 'view-auth',
      authenticated: 'view-main',
      error: 'view-error'
    };

    document.getElementById(map[view]).classList.add('active');
    dot.className = 'p-status-dot' + (view === 'authenticated' ? '' : view === 'error' ? ' error' : ' offline');
  }

  function showError(message) {
    elErrorMsg.textContent = message;
    showView("error");
  }

  function renderProgress(hours) {
    const capped = Math.min(hours, WEEKLY_QUOTA_HOURS);
    const pct = (capped / WEEKLY_QUOTA_HOURS) * 100;

    elHours.textContent = hours.toFixed(1);

    elProgressFill.className = 'prog-fill';
    elProgressFill.style.width = `${pct}%`;

    if (hours >= WEEKLY_QUOTA_HOURS) {
      elProgressFill.classList.add('danger');
      elStatusText.innerHTML = 'Quota reached. <span class="highlight">Good job.</span>';
    } else if (hours >= 25) {
      elProgressFill.classList.add('warn');
      elStatusText.innerHTML = `<span class="highlight warn">${(WEEKLY_QUOTA_HOURS - hours).toFixed(1)}h</span> to reach quota`;
    } else {
      elStatusText.innerHTML = `<span class="highlight">${(WEEKLY_QUOTA_HOURS - hours).toFixed(1)}h</span> remaining to quota`;
    }
  }

  function updateLiveTimer() {
    const selectVal = parseInt(startDaySelect.value, 10);
    const targetDay = isNaN(selectVal) ? 1 : selectVal;

    const now = new Date();
    const dayOfWeek = now.getDay();
    let diff = dayOfWeek - targetDay;
    if (diff < 0) diff += 7;

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - diff);
    weekStart.setHours(0, 0, 0, 0);

    const deadline = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const remainingMs = Math.max(0, deadline.getTime() - now.getTime());

    const d = Math.floor(remainingMs / 86400000);
    const h = Math.floor((remainingMs % 86400000) / 3600000);
    const m = Math.floor((remainingMs % 3600000) / 60000);

    document.getElementById('t-days').textContent = String(d).padStart(2, '0');
    document.getElementById('t-hours').textContent = String(h).padStart(2, '0');
    document.getElementById('t-mins').textContent = String(m).padStart(2, '0');

    document.getElementById('t-days').className = 'timer-val' + (d <= 1 ? ' warn' : ' accent');
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }

  // ─── INITIALIZATION ─────────────────────────────────────────────────────────
  async function init() {
    showView("loading");

    const tokens = await getStoredTokens();
    if (!tokens) {
      showView("unauthenticated");
      return;
    }

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
    btnConnect.disabled = true;
    btnConnect.innerHTML = `<div class="p-spinner" style="width:12px;height:12px;border-width:1px;border-top-color:#fff;"></div> Connecting...`;
    showView("loading");

    const response = await sendMessage({ type: "START_AUTH" }).catch(
      (err) => ({ success: false, error: err.message })
    );

    if (!response.success) {
      btnConnect.disabled = false;
      btnConnect.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1L9.5 5H13l-3 2.5 1.5 4L7 9l-4.5 2.5L4 7.5 1 5h3.5L7 1z" fill="#00d97e" opacity=".8"/></svg>Connect with 42`;
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
    btnRefresh.disabled = true;
    btnRefresh.innerHTML = `<div class="p-spinner" style="width:12px;height:12px;border-width:1px;border-top-color:#fff;"></div>`;

    await sendMessage({ type: "FORCE_CHECK" }).catch(() => null);
    const hours = await getStoredHours();

    if (hours !== null) renderProgress(hours);
    updateLiveTimer();

    btnRefresh.disabled = false;
    btnRefresh.innerHTML = `<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M9.5 2A5 5 0 1 0 10 5.5"/><path d="M10 1v2.5H7.5"/></svg>Refresh`;
  });

  btnRetry.addEventListener("click", () => {
    init().catch((err) => showError(err.message));
  });

  startDaySelect.addEventListener("change", async (e) => {
    const newDay = parseInt(e.target.value, 10);
    await setStartDay(newDay);

    if (typeof updateLiveTimer === "function") {
      updateLiveTimer();
    }

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