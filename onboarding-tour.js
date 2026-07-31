/* ==========================================================================
   ONBOARDING-TOUR.JS — first-login guided tour, self-hosted driver.js
   (free, MIT licensed, no CDN dependency — driver.js / driver.css live in
   this same folder). Shown automatically once per person per browser, with
   a "Take a tour" button always available afterward to replay it.

   Purely additive: targets existing sidebar links via their `data-view`
   attributes (already present in admin.html / teacher.html / student.html)
   and inserts its own trigger button via JS — no existing HTML is edited.
   ========================================================================== */

let driverLoadPromise = null;
function loadDriverAssets() {
  if (window.driver?.js?.driver) return Promise.resolve(window.driver.js.driver);
  if (driverLoadPromise) return driverLoadPromise;
  driverLoadPromise = new Promise((resolve, reject) => {
    if (!document.getElementById("driver-css-link")) {
      const link = document.createElement("link");
      link.id = "driver-css-link";
      link.rel = "stylesheet";
      link.href = "./driver.css";
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "./driver.js";
    script.onload = () => (window.driver?.js?.driver ? resolve(window.driver.js.driver) : reject(new Error("Tour library did not initialize.")));
    script.onerror = () => reject(new Error("Could not load the tour library."));
    document.head.appendChild(script);
  });
  return driverLoadPromise;
}

const TOUR_STEPS = {
  admin: [
    { element: '.sidebar a[data-view="overview"]', popover: { title: "Welcome, Administrator!", description: "This is your Overview — a quick snapshot of the whole college.", side: "right" } },
    { element: '.sidebar a[data-view="teachers"]', popover: { title: "Teachers", description: "Create teacher accounts here and assign them one or more courses.", side: "right" } },
    { element: '.sidebar a[data-view="students"]', popover: { title: "Students", description: "Create student accounts, manage their courses, and check each one's progress.", side: "right" } },
    { element: '.sidebar a[data-view="content"]', popover: { title: "Content Uploads", description: "Upload ebooks, handbooks, syllabus, audio, and video — to Firebase Storage or Google Drive, your choice.", side: "right" } },
    { element: '.sidebar a[data-view="reports"]', popover: { title: "Reports & Analytics", description: "Charts and exportable reports live here.", side: "right" } },
    { element: "#notif-bell-btn", popover: { title: "Notifications", description: "Real-time updates appear here while you're signed in.", side: "bottom" } },
    { element: "#global-search-input", popover: { title: "Global Search", description: "Search students, teachers, courses, and content from anywhere in the dashboard.", side: "bottom" } }
  ],
  teacher: [
    { element: '.sidebar a[data-view="overview"]', popover: { title: "Welcome!", description: "This is your Overview — your assigned courses at a glance.", side: "right" } },
    { element: '.sidebar a[data-view="materials"]', popover: { title: "Upload Materials", description: "Add ebooks, handbooks, syllabus, notes, and assignments for your course.", side: "right" } },
    { element: '.sidebar a[data-view="live"]', popover: { title: "Live Class", description: "Go live with real-time video/audio, and optionally record the session for students to watch again later.", side: "right" } },
    { element: '.sidebar a[data-view="examQuestions"]', popover: { title: "Exam Questions", description: "Create and manage objective and theory questions for your course's exam.", side: "right" } },
    { element: '.sidebar a[data-view="grading"]', popover: { title: "Grade Theory Answers", description: "Review submitted theory answers here, with built-in translation to help with grading.", side: "right" } },
    { element: '.sidebar a[data-view="progress"]', popover: { title: "Student Progress", description: "See attendance, results, and certificate status for every student in your course.", side: "right" } }
  ],
  student: [
    { element: '.sidebar a[data-view="overview"]', popover: { title: "Welcome!", description: "This is your Overview — your enrolled courses at a glance.", side: "right" } },
    { element: '.sidebar a[data-view="library"]', popover: { title: "Library", description: "Read your ebooks, handbook, and syllabus here — with translation, highlights, and read-aloud.", side: "right" } },
    { element: '.sidebar a[data-view="media"]', popover: { title: "Audio & Video", description: "Stream your teacher's audio and video lessons.", side: "right" } },
    { element: '.sidebar a[data-view="live"]', popover: { title: "Live Class", description: "Join your teacher's live class the moment they go live.", side: "right" } },
    { element: '.sidebar a[data-view="exams"]', popover: { title: "Exams", description: "Take your course exam here — remember, you only get one attempt, so make it count.", side: "right" } },
    { element: '.sidebar a[data-view="certificates"]', popover: { title: "Certificates", description: "Download your certificate here once you pass a course.", side: "right" } }
  ]
};

export function initOnboardingTour(role, uid) {
  const steps = TOUR_STEPS[role];
  if (!steps) return;
  const storageKey = `cacgw_tour_seen_${role}_${uid}`;

  async function runTour() {
    try {
      const driver = await loadDriverAssets();
      const availableSteps = steps.filter(s => document.querySelector(s.element));
      if (!availableSteps.length) return;
      const tourInstance = driver({
        showProgress: true,
        allowClose: true,
        steps: availableSteps,
        onDestroyed: () => localStorage.setItem(storageKey, "1")
      });
      tourInstance.drive();
    } catch (e) { /* the tour is a nice-to-have; never block the dashboard if it fails to load */ }
  }

  // Auto-run once on first login, after the page has settled
  if (!localStorage.getItem(storageKey)) setTimeout(runTour, 900);

  // Always leave a manual "Take a tour" trigger available to replay it later
  const spacer = document.querySelector(".brand-bar .spacer");
  if (spacer) {
    spacer.insertAdjacentHTML("afterend", `<button class="icon-btn" id="tour-replay-btn" title="Take a tour"><i class="fa-solid fa-circle-question"></i></button>`);
    document.getElementById("tour-replay-btn").onclick = runTour;
  }
}
