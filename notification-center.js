/* ==========================================================================
   NOTIFICATION-CENTER.JS — real-time, in-app notification bell.
   --------------------------------------------------------------------------
   Deliberately NOT background push notifications (the kind that arrive when
   the browser/app is closed) — those require a server-side component
   (Firebase Cloud Functions) which needs the paid Blaze billing plan, the
   same requirement that blocked Firebase Storage earlier in this project.
   This instead uses Firestore's free real-time listeners: while a dashboard
   tab is open, the bell updates instantly with no polling, no server, and
   no cost. Closed-tab/background push would need a paid backend — see
   README.md for that tradeoff if it's ever wanted later.

   Injected purely via JS (querySelector + insertAdjacentHTML) — no existing
   HTML file is modified to add this.
   ========================================================================== */

export function initNotificationBell(storageKey) {
  const spacer = document.querySelector(".brand-bar .spacer");
  if (!spacer) return null; // page doesn't have the expected brand bar — fail safe, do nothing

  spacer.insertAdjacentHTML("afterend", `
    <div style="position:relative;">
      <button class="icon-btn" id="notif-bell-btn" title="Notifications">
        <i class="fa-solid fa-bell"></i>
        <span id="notif-badge" style="display:none;position:absolute;top:-2px;right:-2px;background:var(--danger);color:#fff;border-radius:999px;font-size:.65rem;padding:1px 5px;font-weight:700;"></span>
      </button>
      <div id="notif-dropdown" style="display:none;position:absolute;top:46px;right:0;width:320px;max-height:400px;overflow-y:auto;background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.2);z-index:80;">
        <div style="padding:12px 16px;border-bottom:1px solid #eef1f7;font-weight:700;color:var(--navy);">Notifications</div>
        <div id="notif-list" style="padding:8px;"></div>
      </div>
    </div>`);

  const bellBtn = document.getElementById("notif-bell-btn");
  const dropdown = document.getElementById("notif-dropdown");
  const badge = document.getElementById("notif-badge");
  const listEl = document.getElementById("notif-list");

  let currentItems = [];

  function lastSeenTime() {
    return Number(localStorage.getItem(storageKey) || 0);
  }
  function markSeenNow() {
    localStorage.setItem(storageKey, String(Date.now()));
    badge.style.display = "none";
  }

  bellBtn.onclick = (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display === "block";
    dropdown.style.display = isOpen ? "none" : "block";
    if (!isOpen) markSeenNow();
  };
  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && e.target !== bellBtn) dropdown.style.display = "none";
  });

  function render() {
    const seen = lastSeenTime();
    const unreadCount = currentItems.filter(i => i.timestamp > seen).length;
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
      badge.style.display = "block";
    } else {
      badge.style.display = "none";
    }

    if (!currentItems.length) {
      listEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--muted);font-size:.85rem;">
          <i class="fa-solid fa-inbox" style="font-size:1.3rem;display:block;margin-bottom:6px;opacity:.5;"></i>Nothing yet.
        </div>`;
      return;
    }
    listEl.innerHTML = currentItems.slice(0, 20).map(i => `
      <div style="padding:10px 8px;border-bottom:1px solid #f2f4f8;font-size:.85rem;">
        <div style="display:flex;gap:8px;align-items:flex-start;">
          <i class="fa-solid fa-${i.icon || "circle-info"}" style="color:var(--gold);margin-top:2px;"></i>
          <div>
            <div>${i.text}</div>
            <div style="color:var(--muted);font-size:.72rem;margin-top:2px;">${timeAgo(i.timestamp)}</div>
          </div>
        </div>
      </div>`).join("");
  }

  function timeAgo(ts) {
    const diffMin = Math.round((Date.now() - ts) / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.round(diffHr / 24)}d ago`;
  }

  return {
    /** Replace the full notification feed (already merged/sorted newest-first by the caller). */
    setItems(items) { currentItems = items; render(); }
  };
}
