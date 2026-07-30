/* ==========================================================================
   APP SHELL — shared across every dashboard page
   Toasts, dark/light theme, PWA install button, offline queue (IndexedDB
   via localForage-lite pattern using plain IndexedDB + localStorage fallback)
   ========================================================================== */

/* ---------- Toasts ---------- */
export function toast(msg, type = "info") {
  let box = document.getElementById("toast-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "toast-box";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

/* ---------- Theme ---------- */
export function initTheme() {
  const saved = localStorage.getItem("cacgw_theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);
  document.body.setAttribute("data-theme", saved);
}
export function toggleTheme() {
  const cur = document.body.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.body.setAttribute("data-theme", cur);
  document.documentElement.setAttribute("data-theme", cur);
  localStorage.setItem("cacgw_theme", cur);
}

/* ---------- Service worker + PWA install ---------- */
export function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
    });
  }
}

let deferredPrompt = null;
export function initInstallBanner() {
  const banner = document.getElementById("install-banner");
  if (!banner) return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    banner.style.display = "flex";
  });
  const installBtn = document.getElementById("install-btn");
  const dismissBtn = document.getElementById("install-dismiss");
  if (installBtn) installBtn.onclick = async () => {
    banner.style.display = "none";
    if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
  };
  if (dismissBtn) dismissBtn.onclick = () => banner.style.display = "none";
}

/* ---------- Online/offline sync queue (localStorage-backed, simple & robust) ---------- */
const QUEUE_KEY = "cacgw_sync_queue";

export function queueOfflineAction(action) {
  const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  q.push({ ...action, queuedAt: Date.now() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export async function flushOfflineQueue(handlers) {
  if (!navigator.onLine) return;
  const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  if (!q.length) return;
  const remaining = [];
  for (const item of q) {
    try {
      if (handlers[item.type]) await handlers[item.type](item.payload);
      else remaining.push(item);
    } catch (e) { remaining.push(item); }
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  if (remaining.length < q.length) toast(`Synced ${q.length - remaining.length} offline item(s)`, "success");
}

export function initOfflineWatcher(handlers) {
  window.addEventListener("online", () => flushOfflineQueue(handlers));
  flushOfflineQueue(handlers);
  const dot = document.getElementById("net-status");
  const update = () => { if (dot) dot.title = navigator.onLine ? "Online" : "Offline — changes will sync later"; if (dot) dot.style.background = navigator.onLine ? "#1e8e5a" : "#c0392b"; };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

/* ---------- Guard against right-click / devtools on protected content ---------- */
export function protectElement(el) {
  if (!el) return;
  el.classList.add("protected");
  el.addEventListener("contextmenu", e => e.preventDefault());
  el.addEventListener("copy", e => e.preventDefault());
  el.addEventListener("dragstart", e => e.preventDefault());
}

/* ---------- Small helper: log out redirect ---------- */
export function goTo(path) { window.location.href = path; }

/* ==========================================================================
   SESSION TIMEOUT — logs a user out automatically after prolonged inactivity,
   with a warning first. Used on the Admin/Teacher/Student dashboards only —
   deliberately NOT used during exams, which already have their own
   fullscreen/timer safeguards and shouldn't risk kicking a student out
   mid-answer.
   ========================================================================== */
export function initSessionTimeout(logoutFn, warningMinutes = 25, graceMinutes = 5, isPausedFn = () => false) {
  const warningMs = warningMinutes * 60 * 1000;
  const graceMs = graceMinutes * 60 * 1000;
  let warnTimer, logoutTimer, countdownInterval;

  function clearAll() {
    clearTimeout(warnTimer); clearTimeout(logoutTimer); clearInterval(countdownInterval);
    const overlay = document.getElementById("session-timeout-overlay");
    if (overlay) overlay.remove();
  }

  function showWarning() {
    if (isPausedFn()) { resetTimers(); return; } // e.g. teacher is mid-broadcast — don't interrupt
    if (document.getElementById("session-timeout-overlay")) return;
    let secondsLeft = Math.floor(graceMs / 1000);
    const overlay = document.createElement("div");
    overlay.id = "session-timeout-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(11,37,69,.75);z-index:950;display:flex;align-items:center;justify-content:center;padding:20px;";
    overlay.innerHTML = `
      <div class="glass-card" style="max-width:420px;width:100%;background:#fff;text-align:center;">
        <i class="fa-solid fa-clock" style="font-size:2rem;color:var(--gold);"></i>
        <h4 style="margin-top:10px;">Still there?</h4>
        <p style="color:var(--muted);">You've been inactive for a while. For your security, you'll be signed out in <strong id="session-countdown">${secondsLeft}</strong> seconds.</p>
        <button class="btn-gold" id="session-stay-btn">I'm still here</button>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById("session-stay-btn").onclick = resetTimers;

    countdownInterval = setInterval(() => {
      secondsLeft--;
      const el = document.getElementById("session-countdown");
      if (el) el.textContent = secondsLeft;
      if (secondsLeft <= 0) clearInterval(countdownInterval);
    }, 1000);

    logoutTimer = setTimeout(() => { clearAll(); logoutFn(); }, graceMs);
  }

  function resetTimers() {
    clearAll();
    warnTimer = setTimeout(showWarning, warningMs);
  }

  ["mousemove", "mousedown", "keydown", "touchstart", "scroll"].forEach(evt =>
    document.addEventListener(evt, resetTimers, { passive: true })
  );
  resetTimers();
}

/* ==========================================================================
   EMPTY / LOADING STATE HELPERS — one consistent look across every dashboard
   list, instead of ad-hoc "Loading…" / "Nothing yet." text.
   ========================================================================== */
export function loadingStateHTML(label = "Loading…") {
  return `<div style="text-align:center;padding:24px;color:var(--muted);">
      <i class="fa-solid fa-circle-notch fa-spin" style="font-size:1.4rem;margin-bottom:8px;display:block;"></i>${label}
    </div>`;
}

export function emptyStateHTML(icon, message) {
  return `<div class="empty-state">
      <i class="fa-solid fa-${icon}"></i>
      <p>${message}</p>
    </div>`;
}

export function errorStateHTML(message, retryFn) {
  const id = "err-retry-" + Math.random().toString(36).slice(2, 8);
  setTimeout(() => { const b = document.getElementById(id); if (b && retryFn) b.onclick = retryFn; }, 0);
  return `<div class="empty-state" style="color:var(--danger);">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <p>${message}</p>
      ${retryFn ? `<button class="btn-outline" id="${id}">Retry</button>` : ""}
    </div>`;
}
