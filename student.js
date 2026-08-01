/* ==========================================================================
   STUDENT.JS — Student Dashboard (supports multiple enrolled courses)
   ========================================================================== */
import { guardRoute, logout } from "./auth.js";
import {
  db, COL, ICE_CONFIG, collection, doc, setDoc, getDoc, getDocs, addDoc, deleteDoc, query, where,
  onSnapshot, orderBy, limit, serverTimestamp, increment, logActivity
} from "./firebase-config.js";
import { toast, initTheme, toggleTheme, registerServiceWorker, protectElement, queueOfflineAction, initOfflineWatcher, initSessionTimeout, emptyStateHTML, errorStateHTML, loadingStateHTML } from "./app-shell.js";
import { fetchPublicDriveFile } from "./drive-config.js";
import { initNotificationBell } from "./notification-center.js";
import { initOnboardingTour } from "./onboarding-tour.js";

initTheme();
registerServiceWorker();
const main = document.getElementById("main-content");
document.getElementById("theme-btn").onclick = toggleTheme;
document.getElementById("logout-btn").onclick = logout;

let user, profile, myCourses = [], course, currentView = "overview";

guardRoute("student").then(async (u) => {
  user = u;
  const snap = await getDoc(doc(db, COL.students, u.uid));
  profile = snap.data();

  const courseIds = profile.courseIds || (profile.courseId ? [profile.courseId] : []); // backward-compatible
  myCourses = [];
  for (const id of courseIds) {
    const cSnap = await getDoc(doc(db, COL.courses, id));
    if (cSnap.exists()) myCourses.push({ id, ...cSnap.data() });
  }
  const savedId = localStorage.getItem("cacgw_selected_course");
  course = myCourses.find(c => c.id === savedId) || myCourses[0] || null;

  bindSidebar();
  renderOverview();
  markAttendance();
  initOfflineWatcher({
    attendance: async (payload) => { await addDoc(collection(db, COL.attendance), payload); }
  });
  initSessionTimeout(logout, 25, 5, () => !!studentPc);
  setupStudentNotifications(u.uid);
  initOnboardingTour("student", u.uid);
});

/* ---------- Real-time notification bell: announcements, answered questions,
   and graded exam results ---------- */
function setupStudentNotifications(uid) {
  const bell = initNotificationBell(`cacgw_notif_seen_student_${uid}`);
  if (!bell) return;

  const feed = { announcements: [], questions: [], results: [] };
  function render() {
    const merged = [...feed.announcements, ...feed.questions, ...feed.results];
    merged.sort((a, b) => b.timestamp - a.timestamp);
    bell.setItems(merged);
  }

  onSnapshot(query(collection(db, COL.notifications), orderBy("createdAt", "desc"), limit(10)), (snap) => {
    const items = [];
    snap.forEach((d) => {
      const a = d.data();
      const ts = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
      items.push({ icon: "bullhorn", text: `Announcement: ${a.title}`, timestamp: ts });
    });
    feed.announcements = items;
    render();
  });

  onSnapshot(query(collection(db, COL.questions), where("studentUid", "==", uid)), (snap) => {
    const items = [];
    snap.forEach((d) => {
      const q = d.data();
      if (!q.answer) return; // only notify once a teacher has actually answered
      const ts = q.answeredAt?.toMillis ? q.answeredAt.toMillis() : Date.now();
      items.push({ icon: "comments", text: `Your question was answered: "${(q.question || "").slice(0, 50)}"`, timestamp: ts });
    });
    feed.questions = items;
    render();
  });

  onSnapshot(query(collection(db, COL.results), where("studentUid", "==", uid), where("needsManualGrading", "==", false)), (snap) => {
    const items = [];
    snap.forEach((d) => {
      const r = d.data();
      const ts = r.gradedAt?.toMillis ? r.gradedAt.toMillis() : (r.createdAt?.toMillis ? r.createdAt.toMillis() : Date.now());
      items.push({ icon: "file-pen", text: `Result ready for ${r.courseTitle || r.courseId}: ${r.percent}% (${r.grade})`, timestamp: ts });
    });
    feed.results = items;
    render();
  });
}

function bindSidebar() {
  document.querySelectorAll(".sidebar a").forEach(a => {
    a.addEventListener("click", () => {
      document.querySelectorAll(".sidebar a").forEach(x => x.classList.remove("active"));
      a.classList.add("active");
      if (currentView === "live" && a.dataset.view !== "live") leaveLive();
      currentView = a.dataset.view;
      views()[currentView]();
    });
  });
}
function views() {
  return {
    overview: renderOverview, library: renderLibrary, media: renderMedia, live: renderLive,
    exams: renderExams, certificates: renderCertificates, idcard: renderIdCard, transcript: renderTranscript,
    questions: renderQuestions, feedback: renderFeedback
  };
}

/* ---------- Course switcher — shown at the top of every course-specific view ---------- */
function courseSwitcherHTML() {
  if (myCourses.length <= 1) return "";
  const opts = myCourses.map(c => `<option value="${c.id}" ${course && c.id === course.id ? "selected" : ""}>${c.code} — ${c.title}</option>`).join("");
  return `<div class="glass-card" style="margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <label style="font-weight:600;color:var(--muted);"><i class="fa-solid fa-graduation-cap"></i> Viewing course:</label>
      <select id="course-switcher" style="padding:8px 12px;border-radius:10px;border:1px solid #d8dde8;">${opts}</select>
    </div>`;
}
function bindCourseSwitcher() {
  const sel = document.getElementById("course-switcher");
  if (!sel) return;
  sel.onchange = async () => {
    if (currentView === "live" && studentPc) await leaveLive();
    course = myCourses.find(c => c.id === sel.value);
    localStorage.setItem("cacgw_selected_course", course.id);
    views()[currentView]();
  };
}

/* ---------- Auto attendance on login (works offline via queue) ---------- */
async function markAttendance() {
  if (!course) return;
  const now = new Date();
  const payload = {
    studentId: profile.studentId, courseId: course.id,
    date: now.toISOString().slice(0, 10), time: now.toLocaleTimeString(),
    device: navigator.userAgent, browser: navigator.userAgentData?.brands?.[0]?.brand || "Browser",
    createdAt: new Date().toISOString()
  };
  if (navigator.onLine) {
    try { await addDoc(collection(db, COL.attendance), payload); } catch (e) { queueOfflineAction({ type: "attendance", payload }); }
  } else {
    queueOfflineAction({ type: "attendance", payload });
  }
}

function renderOverview() {
  currentView = "overview";
  const courseList = myCourses.length
    ? myCourses.map(c => `<span class="badge active" style="margin-right:6px;">${c.code}</span>`).join("")
    : "None yet — contact your Administrator";
  main.innerHTML = `
    <h2>Welcome, ${profile.fullName}</h2>
    <p style="color:var(--muted);">Enrolled in ${myCourses.length} course(s): ${courseList}</p>
    <div class="stat-grid">
      <div class="stat-card"><div class="num"><i class="fa-solid fa-id-card"></i></div><div class="label">${profile.studentId}</div></div>
      <div class="stat-card"><div class="num">${myCourses.length}</div><div class="label">Enrolled Courses</div></div>
      <div class="stat-card"><div class="num">${course ? course.code : "—"}</div><div class="label">Currently Viewing</div></div>
    </div>
    <div class="glass-card">
      <h4>Quick Links</h4>
      <button class="btn-navy" onclick="document.querySelector('[data-view=library]').click()"><i class="fa-solid fa-book-open"></i> Open Library</button>
      <button class="btn-gold" onclick="document.querySelector('[data-view=exams]').click()"><i class="fa-solid fa-file-pen"></i> View Exams</button>
    </div>`;
}

/* ---------- Library: ebook / handbook / syllabus ---------- */
async function renderLibrary() {
  currentView = "library";
  if (!course) { main.innerHTML = "<p>You are not enrolled in a course yet.</p>"; return; }
  main.innerHTML = `<h2><i class="fa-solid fa-book-open"></i> Library — ${course.title}</h2>
    ${courseSwitcherHTML()}
    <div id="lib-tabs" class="tab-strip">
    <button data-t="ebooks" class="active">Ebooks</button><button data-t="handbooks">Handbook</button><button data-t="syllabus">Syllabus</button>
    <button data-t="materials">Lesson Notes & Assignments</button></div><div id="lib-list">Loading…</div>`;
  bindCourseSwitcher();

  const load = async (type) => {
    const wrap = document.getElementById("lib-list");
    wrap.innerHTML = loadingStateHTML();
    const colName = type === "materials" ? "materials" : type;
    let snap;
    try { snap = await getDocs(query(collection(db, colName), where("courseId", "==", course.id))); }
    catch (e) { wrap.innerHTML = errorStateHTML("Could not load — check your connection.", () => load(type)); return; }
    if (snap.empty) { wrap.innerHTML = emptyStateHTML("book-open", "Nothing uploaded here yet."); return; }
    wrap.innerHTML = "";
    snap.forEach(d => {
      const item = d.data();
      const card = document.createElement("div");
      card.className = "glass-card";
      card.style.marginBottom = "10px";
      const readerParams = item.source === "drive"
        ? `ebook-reader.html?source=drive&fileId=${encodeURIComponent(item.driveFileId)}&title=${encodeURIComponent(item.title)}`
        : `ebook-reader.html?url=${encodeURIComponent(item.url)}&title=${encodeURIComponent(item.title)}`;
      card.innerHTML = `<strong>${item.title}</strong> ${item.source === "drive" ? '<span class="badge active"><i class="fa-brands fa-google-drive"></i> Drive</span>' : ""}
        <div style="margin-top:8px;">
          ${type === "ebooks" || type === "handbooks"
            ? `<button class="btn-gold" onclick="window.open('${readerParams}','_blank')"><i class="fa-solid fa-book"></i> Read</button>`
            : `<a class="btn-outline" href="${item.url}" target="_blank" rel="noopener"><i class="fa-solid fa-eye"></i> View</a>`}
        </div>`;
      wrap.appendChild(card);
    });
  };
  document.querySelectorAll("#lib-tabs button").forEach(b => {
    b.onclick = () => { document.querySelectorAll("#lib-tabs button").forEach(x => x.classList.remove("active")); b.classList.add("active"); load(b.dataset.t); };
  });
  load("ebooks");
}

/* ---------- Media: stream-only audio/video, no download, no right-click ---------- */
async function renderMedia() {
  currentView = "media";
  if (!course) { main.innerHTML = "<p>You are not enrolled in a course yet.</p>"; return; }
  main.innerHTML = `<h2><i class="fa-solid fa-photo-film"></i> Audio & Video — ${course.title}</h2>
    ${courseSwitcherHTML()}
    <div id="media-tabs" class="tab-strip"><button data-t="audio" class="active">Audio Teachings</button><button data-t="videos">Videos</button></div>
    <div id="media-list">Loading…</div>`;
  bindCourseSwitcher();
  const load = async (type) => {
    const wrap = document.getElementById("media-list");
    wrap.innerHTML = "Loading…";
    const snap = await getDocs(query(collection(db, COL[type]), where("courseId", "==", course.id)));
    if (snap.empty) { wrap.innerHTML = emptyStateHTML("photo-film", "Nothing here yet."); return; }
    wrap.innerHTML = "";
    snap.forEach(async (d) => {
      const item = d.data();
      const card = document.createElement("div");
      card.className = "glass-card"; card.style.marginBottom = "12px";
      card.innerHTML = `<strong>${item.title}</strong> ${item.source === "drive" ? '<span class="badge active"><i class="fa-brands fa-google-drive"></i> Drive</span>' : ""}<br>
        <div class="media-slot" style="margin-top:8px;color:var(--muted);">Loading media…</div>`;
      protectElement(card);
      wrap.appendChild(card);
      const slot = card.querySelector(".media-slot");
      try {
        let src = item.url;
        if (item.source === "drive") {
          const blob = await fetchPublicDriveFile(item.driveFileId);
          src = URL.createObjectURL(blob);
        }
        slot.outerHTML = type === "audio"
          ? `<audio controls controlsList="nodownload noplaybackrate" src="${src}" style="width:100%;margin-top:8px;"></audio>`
          : `<video controls controlsList="nodownload noplaybackrate" src="${src}" style="width:100%;margin-top:8px;border-radius:10px;"></video>`;
      } catch (err) {
        slot.textContent = "Could not load this media: " + (err?.message || "unknown error.");
      }
    });
  };
  document.querySelectorAll("#media-tabs button").forEach(b => {
    b.onclick = () => { document.querySelectorAll("#media-tabs button").forEach(x => x.classList.remove("active")); b.classList.add("active"); load(b.dataset.t); };
  });
  load("audio");
}

/* ---------- Live Class: join teacher's real-time broadcast (not recorded).
   Students can also turn on their own camera/mic so the teacher can see/hear
   them — the connection is bidirectional, negotiated as sendrecv from the
   student's side, with tracks attached only once the student opts in. ---------- */
let studentPc = null, teacherCandidatesUnsub = null, answerUnsub = null, sessionUnsub = null;
let studentLocalStream = null, videoTransceiver = null, audioTransceiver = null;

async function renderLive() {
  currentView = "live";
  if (!course) { main.innerHTML = "<p>You are not enrolled in a course yet.</p>"; return; }
  main.innerHTML = `<h2><i class="fa-solid fa-tower-broadcast"></i> Live Class — ${course.title}</h2>
    ${courseSwitcherHTML()}
    <div class="glass-card" id="live-wrap"><p>Checking for a live session…</p></div>`;
  bindCourseSwitcher();

  if (sessionUnsub) { sessionUnsub(); sessionUnsub = null; }
  const sessionRef = doc(db, COL.liveSessions, course.id);
  sessionUnsub = onSnapshot(sessionRef, (snap) => {
    const wrap = document.getElementById("live-wrap");
    if (!wrap) return;
    const isActive = snap.exists() && snap.data().active;
    if (!isActive) {
      if (studentPc) leaveLive();
      wrap.innerHTML = `<p><i class="fa-solid fa-circle-info"></i> No live class is running right now. Check back when your teacher goes live — this page updates automatically.</p>`;
      return;
    }
    if (!studentPc) {
      wrap.innerHTML = `<p><i class="fa-solid fa-circle-check" style="color:var(--success);"></i> Your teacher is live now!</p>
        <button class="btn-gold" id="join-live"><i class="fa-solid fa-video"></i> Join Live Class</button>`;
      document.getElementById("join-live").onclick = () => joinLive();
    }
  });
}

async function joinLive() {
  const wrap = document.getElementById("live-wrap");
  wrap.innerHTML = `
    <div class="studio-preview"><video id="live-video" autoplay playsinline></video></div>
    <p style="color:var(--muted);font-size:.85rem;margin:8px 0;">Teacher's broadcast — this is live and is not being recorded.</p>
    <div class="studio-controls">
      <button class="btn-navy" id="my-cam-toggle"><i class="fa-solid fa-camera"></i> Turn On My Camera</button>
      <button class="btn-navy" id="my-mic-toggle"><i class="fa-solid fa-microphone"></i> Turn On My Mic</button>
      <button class="btn-danger" id="leave-live">Leave Live Class</button>
    </div>
    <div id="my-preview-wrap" style="margin-top:12px;display:none;max-width:220px;">
      <div class="studio-preview"><video id="my-preview" autoplay muted playsinline></video></div>
      <small style="color:var(--muted);">Your camera — visible to your teacher</small>
    </div>`;
  protectElement(wrap);
  document.getElementById("leave-live").onclick = leaveLive;
  document.getElementById("my-cam-toggle").onclick = toggleMyCamera;
  document.getElementById("my-mic-toggle").onclick = toggleMyMic;

  studentPc = new RTCPeerConnection(ICE_CONFIG);
  // sendrecv from the start (with no track yet) so the student can start
  // sending camera/mic later without needing to renegotiate the connection.
  videoTransceiver = studentPc.addTransceiver("video", { direction: "sendrecv" });
  audioTransceiver = studentPc.addTransceiver("audio", { direction: "sendrecv" });

  const remoteStream = new MediaStream();
  studentPc.ontrack = (e) => {
    remoteStream.addTrack(e.track);
    const vid = document.getElementById("live-video");
    if (vid) vid.srcObject = remoteStream;
  };

  const viewerDocRef = doc(db, COL.liveSessions, course.id, "viewers", user.uid);
  studentPc.onicecandidate = (e) => {
    if (e.candidate) addDoc(collection(db, COL.liveSessions, course.id, "viewers", user.uid, "studentCandidates"), e.candidate.toJSON());
  };

  const offer = await studentPc.createOffer();
  await studentPc.setLocalDescription(offer);
  await setDoc(viewerDocRef, {
    offer: { type: offer.type, sdp: offer.sdp },
    studentName: profile.fullName, studentId: profile.studentId,
    joinedAt: serverTimestamp()
  });

  answerUnsub = onSnapshot(viewerDocRef, async (snap) => {
    const data = snap.data();
    if (data?.answer && studentPc && !studentPc.currentRemoteDescription) {
      await studentPc.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
  });
  teacherCandidatesUnsub = onSnapshot(collection(db, COL.liveSessions, course.id, "viewers", user.uid, "teacherCandidates"), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "added" && studentPc) studentPc.addIceCandidate(new RTCIceCandidate(change.doc.data())).catch(() => {});
    });
  });

  await logActivity(user.uid, "student", "join_live", course.id);
}

async function ensureLocalStream() {
  if (!studentLocalStream) {
    studentLocalStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById("my-preview").srcObject = studentLocalStream;
    document.getElementById("my-preview-wrap").style.display = "block";
  }
  return studentLocalStream;
}

async function toggleMyCamera() {
  const btn = document.getElementById("my-cam-toggle");
  try {
    const stream = await ensureLocalStream();
    const track = stream.getVideoTracks()[0];
    if (!videoTransceiver.sender.track) {
      await videoTransceiver.sender.replaceTrack(track);
      btn.innerHTML = `<i class="fa-solid fa-video-slash"></i> Turn Off My Camera`;
      toast("Your camera is now visible to your teacher", "success");
    } else {
      await videoTransceiver.sender.replaceTrack(null);
      btn.innerHTML = `<i class="fa-solid fa-camera"></i> Turn On My Camera`;
      toast("Camera turned off", "success");
    }
  } catch (err) { toast("Could not access your camera.", "error"); }
}

async function toggleMyMic() {
  const btn = document.getElementById("my-mic-toggle");
  try {
    const stream = await ensureLocalStream();
    const track = stream.getAudioTracks()[0];
    if (!audioTransceiver.sender.track) {
      await audioTransceiver.sender.replaceTrack(track);
      btn.innerHTML = `<i class="fa-solid fa-microphone-slash"></i> Turn Off My Mic`;
      toast("Your microphone is now on", "success");
    } else {
      await audioTransceiver.sender.replaceTrack(null);
      btn.innerHTML = `<i class="fa-solid fa-microphone"></i> Turn On My Mic`;
      toast("Microphone turned off", "success");
    }
  } catch (err) { toast("Could not access your microphone.", "error"); }
}

async function leaveLive() {
  if (studentPc) { studentPc.close(); studentPc = null; }
  if (teacherCandidatesUnsub) { teacherCandidatesUnsub(); teacherCandidatesUnsub = null; }
  if (answerUnsub) { answerUnsub(); answerUnsub = null; }
  studentLocalStream?.getTracks().forEach((t) => t.stop());
  studentLocalStream = null; videoTransceiver = null; audioTransceiver = null;
  if (course) {
    try { await deleteDoc(doc(db, COL.liveSessions, course.id, "viewers", user.uid)); } catch (e) { /* already gone */ }
  }
  const wrap = document.getElementById("live-wrap");
  if (wrap) wrap.innerHTML = `<p>You left the live class.</p>`;
}

/* ---------- Exams & Results ---------- */
async function renderExams() {
  currentView = "exams";
  if (!course) { main.innerHTML = "<p>You are not enrolled in a course yet.</p>"; return; }
  main.innerHTML = `<h2><i class="fa-solid fa-file-pen"></i> Exams — ${course.title}</h2>
    ${courseSwitcherHTML()}
    <div class="glass-card" id="exam-start-card">
      <p>Your exam will open in secure fullscreen mode. Ensure you have a stable connection before starting.</p>
      <button class="btn-gold" id="start-exam"><i class="fa-solid fa-lock"></i> Start Exam</button>
    </div>
    <div class="glass-card" style="margin-top:20px;"><h4>Your Results</h4><div id="results-list">Loading…</div></div>`;
  bindCourseSwitcher();
  document.getElementById("start-exam").onclick = () => {
    window.location.href = `exam.html?course=${course.id}`;
  };
  const snap = await getDocs(query(collection(db, COL.results), where("studentUid", "==", user.uid), where("courseId", "==", course.id)));
  if (!snap.empty) {
    document.getElementById("exam-start-card").innerHTML = `
      <p><i class="fa-solid fa-circle-check" style="color:var(--success);"></i> You've already attempted this exam. Each exam can only be taken once — see your result below.</p>`;
  }
  let rows = "";
  snap.forEach(d => { const r = d.data(); rows += `<tr><td>${r.score}/${r.total}</td><td>${r.percent}%</td><td>${r.grade}</td><td>${r.date || ""}</td></tr>`; });
  document.getElementById("results-list").innerHTML = snap.empty ? emptyStateHTML("file-pen", "No results yet.") : `<table class="data-table"><thead><tr><th>Score</th><th>%</th><th>Grade</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ---------- Certificates (across all enrolled courses, no switcher needed) ---------- */
async function renderCertificates() {
  currentView = "certificates";
  main.innerHTML = `<h2><i class="fa-solid fa-certificate"></i> Certificates</h2><div class="glass-card"><div id="cert-list">Checking eligibility…</div></div>`;
  const snap = await getDocs(query(collection(db, COL.results), where("studentUid", "==", user.uid)));
  const wrap = document.getElementById("cert-list");
  const passed = [];
  snap.forEach(d => { const r = d.data(); if (r.percent >= 50) passed.push(r); });
  if (!passed.length) { wrap.innerHTML = "<p>Complete and pass a course exam (50%+) to unlock your certificate.</p>"; return; }
  wrap.innerHTML = "";
  passed.forEach(r => {
    const btn = document.createElement("button");
    btn.className = "btn-gold"; btn.style.marginRight = "8px"; btn.style.marginBottom = "8px";
    btn.innerHTML = `<i class="fa-solid fa-download"></i> ${r.courseTitle || r.courseId} Certificate`;
    btn.onclick = () => generateCertificate(r);
    wrap.appendChild(btn);
  });
}

async function generateCertificate(result) {
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
  const pdf = new jsPDF({ orientation: "landscape" });
  const verifyCode = `${profile.studentId}-${result.courseId}-${Date.now().toString(36)}`.toUpperCase();

  pdf.setFillColor(11, 37, 69); pdf.rect(0, 0, 297, 210, "F");
  pdf.setDrawColor(212, 175, 55); pdf.setLineWidth(2); pdf.rect(8, 8, 281, 194);
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("times", "bold"); pdf.setFontSize(22);
  pdf.text("CAC Good Works Assembly Believers Bible College", 148, 40, { align: "center" });
  pdf.setFontSize(16); pdf.text("Certificate of Completion", 148, 55, { align: "center" });
  pdf.setFontSize(13); pdf.text("This certifies that", 148, 80, { align: "center" });
  pdf.setFont("times", "bolditalic"); pdf.setFontSize(26); pdf.setTextColor(212, 175, 55);
  pdf.text(profile.fullName, 148, 100, { align: "center" });
  pdf.setFont("times", "normal"); pdf.setFontSize(13); pdf.setTextColor(255, 255, 255);
  pdf.text(`has successfully completed the course`, 148, 115, { align: "center" });
  pdf.setFont("times", "bold"); pdf.text(`${result.courseTitle || result.courseId}`, 148, 125, { align: "center" });
  pdf.setFont("times", "normal");
  pdf.text(`with a grade of ${result.grade} (${result.percent}%)`, 148, 135, { align: "center" });
  pdf.text(`Date: ${new Date().toLocaleDateString()}`, 40, 175);
  pdf.text(`Verification Code: ${verifyCode}`, 148, 190, { align: "center" });
  pdf.text("Registrar", 250, 175);
  pdf.save(`Certificate-${profile.studentId}.pdf`);
  await logActivity(user.uid, "student", "download_certificate", verifyCode);
  toast("Certificate downloaded", "success");
}

/* ---------- Digital Student ID Card ---------- */
let qrLoadPromise = null;
function loadQRCodeLib() {
  if (window.QRCode) return Promise.resolve(window.QRCode);
  if (qrLoadPromise) return qrLoadPromise;
  qrLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "./qrcode.min.js";
    script.onload = () => window.QRCode ? resolve(window.QRCode) : reject(new Error("QR code library did not initialize."));
    script.onerror = () => reject(new Error("Could not load the QR code library."));
    document.head.appendChild(script);
  });
  return qrLoadPromise;
}

async function renderIdCard() {
  currentView = "idcard";
  main.innerHTML = `
    <h2><i class="fa-solid fa-id-card"></i> Digital ID Card</h2>
    <div class="glass-card" style="max-width:460px;">
      <p style="color:var(--muted);">Your student ID card, generated on demand — always up to date with your current enrollment.</p>
      <button class="btn-gold" id="download-id-btn"><i class="fa-solid fa-download"></i> Download My ID Card</button>
      <p id="id-card-status" style="margin-top:10px;color:var(--muted);"></p>
      <p style="color:var(--muted);font-size:.8rem;margin-top:10px;">
        <i class="fa-solid fa-circle-info"></i> The QR code on your card holds your name, ID, and course details for quick reference when scanned — it isn't a live online lookup, since that would need a server component this free build doesn't use.
      </p>
    </div>`;
  document.getElementById("download-id-btn").onclick = generateIdCard;
}

async function generateIdCard() {
  const statusEl = document.getElementById("id-card-status");
  statusEl.textContent = "Generating…";
  try {
    const [{ jsPDF }, QRCode] = await Promise.all([
      import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm"),
      loadQRCodeLib()
    ]);

    const courseLabel = myCourses.length
      ? (myCourses.length === 1 ? myCourses[0].code : `${myCourses.length} courses enrolled`)
      : "Not currently enrolled";
    const qrPayload = `CAC Good Works Assembly Believers Bible College\nName: ${profile.fullName}\nStudent ID: ${profile.studentId}\nCourses: ${myCourses.map(c => c.code).join(", ") || "None"}`;
    const qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 200, color: { dark: "#0b2545", light: "#ffffff" } });

    // CR80 standard ID card size: 85.6mm x 54mm
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [85.6, 54] });
    pdf.setFillColor(11, 37, 69); pdf.rect(0, 0, 85.6, 54, "F");
    pdf.setDrawColor(212, 175, 55); pdf.setLineWidth(0.6); pdf.rect(1.5, 1.5, 82.6, 51, "S");

    pdf.setTextColor(212, 175, 55);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(6.5);
    pdf.text("CAC GOOD WORKS ASSEMBLY", 4, 6);
    pdf.text("BELIEVERS BIBLE COLLEGE", 4, 9.5);

    // Initials avatar circle (no photo upload system exists, so a clean initials badge stands in)
    const initials = (profile.fullName || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
    pdf.setFillColor(212, 175, 55);
    pdf.circle(13, 24, 8, "F");
    pdf.setTextColor(11, 37, 69);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(12);
    pdf.text(initials, 13, 26.5, { align: "center" });

    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(9);
    pdf.text(profile.fullName || "", 26, 20);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7);
    pdf.text(`ID: ${profile.studentId}`, 26, 25);
    pdf.text(`Course: ${courseLabel}`, 26, 29.5, { maxWidth: 34 });
    pdf.setFontSize(6); pdf.setTextColor(212, 175, 55);
    pdf.text(`Issued: ${new Date().toLocaleDateString()}`, 26, 48);

    pdf.addImage(qrDataUrl, "PNG", 65, 30, 18, 18);

    pdf.save(`ID-Card-${profile.studentId}.pdf`);
    await logActivity(user.uid, "student", "download_id_card", profile.studentId);
    statusEl.textContent = "Downloaded!";
    toast("ID card downloaded", "success");
  } catch (err) {
    statusEl.textContent = "Could not generate ID card.";
    toast(err.message, "error");
  }
}

/* ---------- Academic Transcript (all courses, not just one) ---------- */
async function renderTranscript() {
  currentView = "transcript";
  main.innerHTML = `
    <h2><i class="fa-solid fa-scroll"></i> Academic Transcript</h2>
    <div class="glass-card">
      <p style="color:var(--muted);">A single document listing every course you've taken, your grades, and your overall average.</p>
      <button class="btn-gold" id="download-transcript-btn"><i class="fa-solid fa-download"></i> Download Transcript (PDF)</button>
      <p id="transcript-status" style="margin-top:10px;color:var(--muted);"></p>
    </div>`;
  document.getElementById("download-transcript-btn").onclick = generateTranscript;
}

async function generateTranscript() {
  const statusEl = document.getElementById("transcript-status");
  statusEl.textContent = "Gathering your records…";
  try {
    const snap = await getDocs(query(collection(db, COL.results), where("studentUid", "==", user.uid)));
    const rows = []; snap.forEach(d => rows.push(d.data()));
    if (!rows.length) { statusEl.textContent = "No exam records yet — nothing to include in a transcript."; return; }

    const completed = rows.filter(r => !r.needsManualGrading);
    const pending = rows.filter(r => r.needsManualGrading);
    const average = completed.length ? Math.round(completed.reduce((sum, r) => sum + r.percent, 0) / completed.length) : 0;

    const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
    const pdf = new jsPDF({ orientation: "portrait" });

    pdf.setFillColor(11, 37, 69); pdf.rect(0, 0, 210, 32, "F");
    pdf.setTextColor(255, 255, 255); pdf.setFont("times", "bold"); pdf.setFontSize(16);
    pdf.text("CAC Good Works Assembly Believers Bible College", 105, 14, { align: "center" });
    pdf.setFontSize(12); pdf.setFont("times", "normal");
    pdf.text("Official Academic Transcript", 105, 23, { align: "center" });

    pdf.setTextColor(20, 20, 20); pdf.setFontSize(11);
    pdf.text(`Name: ${profile.fullName}`, 14, 42);
    pdf.text(`Student ID: ${profile.studentId}`, 14, 49);
    pdf.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 56);

    let y = 70;
    pdf.setFont("times", "bold"); pdf.setFontSize(10);
    pdf.text("Course", 14, y); pdf.text("Score", 110, y); pdf.text("Grade", 140, y); pdf.text("Status", 165, y);
    pdf.setDrawColor(212, 175, 55); pdf.line(14, y + 2, 196, y + 2);
    pdf.setFont("times", "normal");
    y += 9;

    rows.forEach(r => {
      if (y > 270) { pdf.addPage(); y = 20; }
      const title = (r.courseTitle || r.courseId || "").slice(0, 42);
      pdf.text(title, 14, y);
      pdf.text(r.needsManualGrading ? "—" : `${r.score}/${r.total} (${r.percent}%)`, 110, y);
      pdf.text(r.needsManualGrading ? "—" : r.grade, 140, y);
      pdf.text(r.needsManualGrading ? "In Progress" : "Complete", 165, y);
      y += 8;
    });

    y += 6;
    pdf.setDrawColor(11, 37, 69); pdf.line(14, y, 196, y);
    y += 10;
    pdf.setFont("times", "bold"); pdf.setFontSize(12);
    pdf.text(`Overall Average (completed courses): ${average}%`, 14, y);
    if (pending.length) {
      y += 8; pdf.setFont("times", "italic"); pdf.setFontSize(9); pdf.setTextColor(100, 100, 100);
      pdf.text(`${pending.length} course(s) awaiting final grading are not included in this average.`, 14, y);
    }

    pdf.save(`Transcript-${profile.studentId}.pdf`);
    await logActivity(user.uid, "student", "download_transcript", profile.studentId);
    statusEl.textContent = "Downloaded!";
    toast("Transcript downloaded", "success");
  } catch (err) {
    statusEl.textContent = "Could not generate transcript.";
    toast(err.message, "error");
  }
}

/* ---------- Ask a Question ---------- */
async function renderQuestions() {
  currentView = "questions";
  if (!course) { main.innerHTML = "<p>You are not enrolled in a course yet.</p>"; return; }
  main.innerHTML = `<h2><i class="fa-solid fa-comments"></i> Ask a Question — ${course.title}</h2>
    ${courseSwitcherHTML()}
    <div class="glass-card">
      <form id="q-form"><div class="form-field"><label>Your question</label><textarea id="q-text" rows="3" required></textarea></div>
      <button class="btn-gold" type="submit"><i class="fa-solid fa-paper-plane"></i> Submit</button></form>
    </div>
    <div class="glass-card" style="margin-top:20px;"><h4>Your Questions (this course)</h4><div id="my-q">Loading…</div></div>`;
  bindCourseSwitcher();
  document.getElementById("q-form").onsubmit = async (e) => {
    e.preventDefault();
    await addDoc(collection(db, COL.questions), {
      courseId: course.id, studentUid: user.uid, studentName: profile.fullName,
      question: document.getElementById("q-text").value, createdAt: serverTimestamp()
    });
    toast("Question submitted", "success"); e.target.reset(); loadMyQuestions();
  };
  loadMyQuestions();
}
async function loadMyQuestions() {
  const snap = await getDocs(query(collection(db, COL.questions), where("studentUid", "==", user.uid), where("courseId", "==", course.id)));
  let rows = "";
  snap.forEach(d => { const q = d.data(); rows += `<tr><td>${q.question}</td><td>${q.answer || "Awaiting answer"}</td></tr>`; });
  document.getElementById("my-q").innerHTML = snap.empty ? emptyStateHTML("comments", "No questions yet.") : `<table class="data-table"><thead><tr><th>Question</th><th>Answer</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ---------- Feedback ---------- */
function renderFeedback() {
  currentView = "feedback";
  if (!course) { main.innerHTML = "<p>You are not enrolled in a course yet.</p>"; return; }
  main.innerHTML = `<h2><i class="fa-solid fa-star"></i> Feedback — ${course.title}</h2>
    ${courseSwitcherHTML()}
    <div class="glass-card">
      <form id="fb-form">
        <div class="form-field"><label>Rating (1-5)</label><input type="number" min="1" max="5" id="fb-rating" required></div>
        <div class="form-field"><label>Comments / Suggestions</label><textarea id="fb-comment" rows="3"></textarea></div>
        <button class="btn-gold" type="submit"><i class="fa-solid fa-paper-plane"></i> Submit Feedback</button>
      </form>
    </div>`;
  bindCourseSwitcher();
  document.getElementById("fb-form").onsubmit = async (e) => {
    e.preventDefault();
    await addDoc(collection(db, COL.feedback), {
      courseId: course.id, studentUid: user.uid,
      rating: Number(document.getElementById("fb-rating").value),
      comment: document.getElementById("fb-comment").value,
      createdAt: serverTimestamp()
    });
    toast("Thank you for your feedback!", "success"); e.target.reset();
  };
}
