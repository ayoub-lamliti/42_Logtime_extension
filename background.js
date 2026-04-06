"use strict";
(() => {
  // src/config.ts
  var PROXY_BASE_URL = "https://42-logtime.vercel.app";
  var EXTENSION_SECRET = "s4t2ud-8e9a15c990f6c3b82baf6b5a596906c5331bed3c1868353031d89fd3e3610863b6d959806365d190a4dcb2740dccef0582";
  var CLIENT_ID = "u-s4t2ud-8e9a15c990f6c3b82baf6b5a596906c5331bed3c1868353031d89fd3e3610863";
  var OAUTH_SCOPE = "public";
  var ALARM_NAME = "logtime-check";
  var ALARM_PERIOD_MINUTES = 15;
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
    return new Promise(
      (resolve, reject) => chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      })
    );
  }
  function remove(keys) {
    return new Promise(
      (resolve, reject) => chrome.storage.local.remove(keys, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      })
    );
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
  async function setStoredTokens(tokens) {
    await set({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at
    });
  }
  async function getStartDay() {
    const r = await get(["start_day"]);
    return typeof r.start_day === "number" ? r.start_day : 1;
  }
  async function getStoredUserId() {
    const r = await get(["user_id"]);
    return typeof r.user_id === "number" ? r.user_id : null;
  }
  async function setStoredUserId(id) {
    await set({ user_id: id });
  }
  async function setStoredHours(hours) {
    await set({ logged_hours: hours });
  }
  async function getNotifiedMilestones() {
    const r = await get(["notified_milestones"]);
    const raw = r.notified_milestones;
    if (Array.isArray(raw)) {
      return new Set(raw);
    }
    return /* @__PURE__ */ new Set();
  }
  async function addNotifiedMilestone(milestone) {
    const current = await getNotifiedMilestones();
    current.add(milestone);
    await set({ notified_milestones: [...current] });
  }
  async function clearNotifiedMilestones() {
    await remove(["notified_milestones"]);
  }
  async function getLastNotifiedWeekMs() {
    const r = await get(["last_notified_week_ms"]);
    return typeof r.last_notified_week_ms === "number" ? r.last_notified_week_ms : null;
  }
  async function setLastNotifiedWeekMs(ms) {
    await set({ last_notified_week_ms: ms });
  }
  async function clearAll() {
    return new Promise(
      (resolve, reject) => chrome.storage.local.clear(() => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      })
    );
  }

  // src/auth.ts
  function getRedirectUri() {
    return `https://${chrome.runtime.id}.chromiumapp.org/`;
  }
  async function proxyPost(path, body) {
    const response = await fetch(`${PROXY_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-extension-auth": EXTENSION_SECRET
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(
        `Proxy ${path} failed [${response.status}]: ${JSON.stringify(data)}`
      );
    }
    return data;
  }
  async function persistTokenResponse(raw) {
    const tokens = {
      access_token: raw.access_token,
      refresh_token: raw.refresh_token,
      expires_at: Date.now() + raw.expires_in * 1e3
    };
    await setStoredTokens(tokens);
    return tokens;
  }
  async function startAuthFlow() {
    const redirectUri = getRedirectUri();
    const authUrl = new URL("https://api.intra.42.fr/oauth/authorize");
    authUrl.searchParams.set("client_id", CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", OAUTH_SCOPE);
    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true
    });
    if (!responseUrl) {
      throw new Error("Auth flow completed with no response URL");
    }
    const url = new URL(responseUrl);
    const code = url.searchParams.get("code");
    const errorParam = url.searchParams.get("error");
    if (errorParam) {
      throw new Error(`OAuth error: ${errorParam}`);
    }
    if (!code) {
      throw new Error("No authorization code returned by 42");
    }
    const raw = await proxyPost("/api/token", {
      code,
      redirect_uri: redirectUri
    });
    await persistTokenResponse(raw);
  }
  async function refreshAccessToken(refreshToken) {
    try {
      const raw = await proxyPost("/api/refresh", {
        refresh_token: refreshToken
      });
      const tokens = await persistTokenResponse(raw);
      return tokens.access_token;
    } catch (err) {
      console.error("[auth] Token refresh failed, forcing re-login:", err);
      await clearAll();
      return null;
    }
  }
  async function getValidAccessToken() {
    const tokens = await getStoredTokens();
    if (!tokens) return null;
    if (Date.now() < tokens.expires_at - TOKEN_REFRESH_BUFFER_MS) {
      return tokens.access_token;
    }
    return refreshAccessToken(tokens.refresh_token);
  }
  async function signOut() {
    await clearAll();
  }

  // src/logtime.ts
  async function apiFetch(path, accessToken) {
    const response = await fetch(`https://api.intra.42.fr${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (response.status === 401) {
      throw new Error("UNAUTHORIZED");
    }
    if (!response.ok) {
      throw new Error(
        `42 API error on ${path}: HTTP ${response.status}`
      );
    }
    return response.json();
  }
  async function fetchCurrentUser(accessToken) {
    return apiFetch("/v2/me", accessToken);
  }
  async function fetchWeekLocations(accessToken, userId, targetDay) {
    const weekStart = getWeekStartMidnight(targetDay);
    const fetchFrom = new Date(
      weekStart.getTime() - 24 * 60 * 60 * 1e3
    ).toISOString();
    const path = `/v2/users/${userId}/locations?range[begin_at]=${fetchFrom},3000-01-01T00:00:00.000Z&page[size]=100&sort=-begin_at`;
    return apiFetch(path, accessToken);
  }
  function getWeekStartMidnight(targetDay) {
    const now = new Date();
    const dayOfWeek = now.getDay();
    let diff = dayOfWeek - targetDay;
    if (diff < 0) {
      diff += 7;
    }
    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() - diff);
    targetDate.setHours(0, 0, 0, 0);
    return targetDate;
  }
  function calculateWeeklyHours(locations, targetDay) {
    const weekStartMs = getWeekStartMidnight(targetDay).getTime();
    const nowMs = Date.now();
    let totalMs = 0;
    for (const loc of locations) {
      const beginMs = new Date(loc.begin_at).getTime();
      const endMs = loc.end_at ? new Date(loc.end_at).getTime() : nowMs;
      if (endMs <= weekStartMs) continue;
      if (beginMs >= nowMs) continue;
      const effectiveStart = Math.max(beginMs, weekStartMs);
      const effectiveEnd = Math.min(endMs, nowMs);
      if (effectiveEnd > effectiveStart) {
        totalMs += effectiveEnd - effectiveStart;
      }
    }
    return totalMs / (1e3 * 60 * 60);
  }

  // src/background.ts
  async function resetNotificationsIfNewWeek(targetDay) {
    const currentWeekMs = getWeekStartMidnight(targetDay).getTime();
    const lastWeekMs = await getLastNotifiedWeekMs();
    if (lastWeekMs !== currentWeekMs) {
      await clearNotifiedMilestones();
      await setLastNotifiedWeekMs(currentWeekMs);
      console.log("[bg] New week detected \u2013 notification flags reset.");
    }
  }
  function fireNotification(milestone, actualHours) {
    const remaining = Math.max(0, WEEKLY_QUOTA_HOURS - actualHours).toFixed(1);
    
    const message = milestone >= WEEKLY_QUOTA_HOURS 
      ? "🏆 Weekly quota complete! Great work this week." 
      : `${remaining}h remaining to hit the ${WEEKLY_QUOTA_HOURS}h weekly quota.`;
      
    chrome.notifications.create(`logtime-milestone-${milestone}h`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `🎯 ${milestone}h logged this week!`,
      message,
      priority: 2
    });
  }
  async function checkMilestones(hours, targetDay) {
    await resetNotificationsIfNewWeek(targetDay);
    const notified = await getNotifiedMilestones();
    for (const milestone of MILESTONES) {
      if (hours >= milestone && !notified.has(milestone)) {
        fireNotification(milestone);
        await addNotifiedMilestone(milestone);
        console.log(`[bg] Notified for ${milestone}h milestone.`);
      }
    }
  }
  async function runLogTimeCheck() {
    console.log("[bg] Running logtime check\u2026");
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      console.log("[bg] No valid token \u2013 waiting for user to authenticate.");
      return;
    }
    let userId = await getStoredUserId();
    if (!userId) {
      const user = await fetchCurrentUser(accessToken);
      userId = user.id;
      await setStoredUserId(userId);
      console.log(`[bg] Fetched and cached user ID: ${userId}`);
    }
    const targetDay = await getStartDay();
    const locations = await fetchWeekLocations(accessToken, userId, targetDay);
    const hours = calculateWeeklyHours(locations, targetDay);
    await setStoredHours(hours);
    console.log(`[bg] Weekly hours: ${hours.toFixed(2)}h`);
    await checkMilestones(hours, targetDay);
  }
  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 0,
      // Fire immediately on install/update.
      periodInMinutes: ALARM_PERIOD_MINUTES
    });
    console.log(
      `[bg] Alarm "${ALARM_NAME}" set every ${ALARM_PERIOD_MINUTES} min.`
    );
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      runLogTimeCheck().catch(
        (err) => console.error("[bg] Logtime check error:", err)
      );
    }
  });
  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (message.type === "START_AUTH") {
        startAuthFlow().then(() => runLogTimeCheck()).then(() => sendResponse({ success: true })).catch(
          (err) => sendResponse({ success: false, error: err.message })
        );
        return true;
      }
      if (message.type === "LOGOUT") {
        signOut().then(() => sendResponse({ success: true })).catch(
          (err) => sendResponse({ success: false, error: err.message })
        );
        return true;
      }
      if (message.type === "FORCE_CHECK") {
        runLogTimeCheck().then(() => sendResponse({ success: true })).catch(
          (err) => sendResponse({ success: false, error: err.message })
        );
        return true;
      }
      if (message.type === "GET_AUTH_STATUS") {
        getStoredTokens().then((tokens) => sendResponse({ authenticated: tokens !== null })).catch(() => sendResponse({ authenticated: false }));
        return true;
      }
      return false;
    }
  );
})();
