"use strict";
(() => {
  // src/config.ts
  var WEEKLY_QUOTA_HOURS = 30;
  var MILESTONES = [20, 25, 30];
  var TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1e3;

  // src/storage.ts
  function get(keys) {
    return new Promise(
      (resolve, reject) => chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      })
    );
  }
  function set(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
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

  // src/popup.ts
  var viewUnauthenticated = document.getElementById(
    "view-unauthenticated"
  );
  var viewAuthenticated = document.getElementById(
    "view-authenticated"
  );
  var viewLoading = document.getElementById("view-loading");
  var viewError = document.getElementById("view-error");
  var btnConnect = document.getElementById("btn-connect");
  var btnLogout = document.getElementById("btn-logout");
  var btnRefresh = document.getElementById("btn-refresh");
  var btnRetry = document.getElementById("btn-retry");
  var elHours = document.getElementById("hours-value");
  var elProgressFill = document.getElementById(
    "progress-fill"
  );
  var elStatusText = document.getElementById("status-text");
  var elErrorMsg = document.getElementById("error-msg");
  var startDaySelect = document.getElementById("start-day-select");
  function showView(view) {
    viewLoading.hidden = view !== "loading";
    viewUnauthenticated.hidden = view !== "unauthenticated";
    viewAuthenticated.hidden = view !== "authenticated";
    viewError.hidden = view !== "error";
  }
  function getRemainingTime() {
    const selectVal = parseInt(document.getElementById("start-day-select").value, 10);
    const targetDay = isNaN(selectVal) ? 1 : selectVal;

    const now = new Date();
    const dayOfWeek = now.getDay();
    let diff = dayOfWeek - targetDay;
    if (diff < 0) {
      diff += 7;
    }
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - diff);
    weekStart.setHours(0, 0, 0, 0);

    const deadline = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const remainingMs = deadline.getTime() - now.getTime();
    const days = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    return { days, hours };
  }
  function showError(message) {
    elErrorMsg.textContent = message;
    showView("error");
  }
  function renderProgress(hours) {
    const capped = Math.min(hours, WEEKLY_QUOTA_HOURS);
    const pct = capped / WEEKLY_QUOTA_HOURS * 100;
    elHours.textContent = hours.toFixed(1);
    elProgressFill.style.width = `${pct}%`;
    if (pct < 50) {
      elProgressFill.style.backgroundColor = "var(--color-danger)";
    } else if (pct < 83) {
      elProgressFill.style.backgroundColor = "var(--color-warning)";
    } else {
      elProgressFill.style.backgroundColor = "var(--color-success)";
    }
    const remaining = Math.max(0, WEEKLY_QUOTA_HOURS - hours);
    const timeLeftText = document.getElementById("time-left-text");

    if (hours >= WEEKLY_QUOTA_HOURS) {
      elStatusText.textContent = "✅ Weekly quota complete!";
      if (timeLeftText) timeLeftText.textContent = "🎉 Done!";
    } else {
      const nextMilestone = MILESTONES.find((m) => hours < m) ?? WEEKLY_QUOTA_HOURS;
      const toNext = (nextMilestone - hours).toFixed(1);

      const timeLeft = getRemainingTime();
      if (timeLeftText) {
        timeLeftText.textContent = `${timeLeft.days}d ${timeLeft.hours}h`;
      }

      elStatusText.textContent = `${remaining.toFixed(1)}h to quota · ${toNext}h to ${nextMilestone}h`;
    }
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
  async function init() {
    showView("loading");
    const tokens = await getStoredTokens();
    if (!tokens) {
      showView("unauthenticated");
      return;
    }

    const savedDay = await getStartDay();
    document.getElementById("start-day-select").value = savedDay.toString();

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
    showView("authenticated");
  }
  btnConnect.addEventListener("click", async () => {
    btnConnect.disabled = true;
    btnConnect.textContent = "Connecting\u2026";
    showView("loading");
    const response = await sendMessage({ type: "START_AUTH" }).catch(
      (err) => ({ success: false, error: err.message })
    );
    if (!response.success) {
      btnConnect.disabled = false;
      btnConnect.textContent = "Connect with 42";
      showError(
        `Authentication failed: ${response.error}`
      );
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
    btnRefresh.textContent = "Refreshing\u2026";
    await sendMessage({ type: "FORCE_CHECK" }).catch(() => null);
    const hours = await getStoredHours();
    if (hours !== null) renderProgress(hours);
    btnRefresh.disabled = false;
    btnRefresh.textContent = "Refresh";
  });
  btnRetry.addEventListener("click", () => {
    init().catch((err) => showError(err.message));
  });
  startDaySelect.addEventListener("change", async (e) => {
    const newDay = parseInt(e.target.value, 10);
    await setStartDay(newDay);

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
