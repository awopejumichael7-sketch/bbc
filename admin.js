/* ==========================================================================
   ADMIN.JS — Administrator Dashboard
   ========================================================================== */
import { guardRoute, logout } from "./auth.js";
import {
  app, auth, db, storage, COL,
  collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp,
  ref, uploadBytesResumable, getDownloadURL,
  generateId, generatePasscode, logActivity
} from "./firebase-config.js";
import { DEFAULT_COURSES, seedCourses } from "./courses-data.js";
import { toast, initTheme, toggleTheme, registerServiceWorker } from "./app-shell.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth as getAuthSecondary, createUserWithEmailAndPassword, signOut as signOutSecondary } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

initTheme();
registerServiceWorker();
const main = document.getElementById("main-content");
let user;

document.getElementById("theme-btn").onclick = toggleTheme;
document.getElementById("logout-btn").onclick = logout;

guardRoute("admin").then(async (u) => {
  user = u;
  await seedCourses(db, collection, doc, setDoc, getDocs, COL);
  bindSidebar();
  renderOverview();
});

function bindSidebar() {
  document.querySelectorAll(".sidebar a").forEach(a => {
    a.addEventListener("click", () => {
      document.querySelectorAll(".sidebar a").forEach(x => x.classList.remove("active"));
      a.classList.add("active");
      const view = a.dataset.view;
      ({
        overview: renderOverview, teachers: renderTeachers, students: renderStudents,
        courses: renderCourses, content: renderContent, exams: renderExams,
        announcements: renderAnnouncements, feedback: renderFeedback,
        reports: renderReports, logs: renderLogs
      })[view]();
    });
  });
}

/* ---------- A secondary Firebase app so creating Teacher/Student accounts
   doesn't log the Admin out of their own session ---------- */
function secondaryAuth() {
  const existing = getApps().find(a => a.name === "secondary");
  const secApp = existing || initializeApp(app.options, "secondary");
  return getAuthSecondary(secApp);
}

/* ============================== OVERVIEW ============================== */
async function renderOverview() {
  main.innerHTML = `<div class="skeleton" style="height:220px;"></div>`;
  const [teachers, students, courses, attendance, feedback] = await Promise.all(
    [COL.teachers, COL.students, COL.courses, COL.attendance, COL.feedback].map(c => getDocs(collection(db, c)))
  );
  main.innerHTML = `
    <h2>Welcome back, Administrator</h2>
    <p style="color:var(--muted);margin-bottom:20px;">Here's what's happening across the college today.</p>
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${teachers.size}</div><div class="label"><i class="fa-solid fa-chalkboard-user"></i> Teachers</div></div>
      <div class="stat-card"><div class="num">${students.size}</div><div class="label"><i class="fa-solid fa-user-graduate"></i> Students</div></div>
      <div class="stat-card"><div class="num">${courses.size}</div><div class="label"><i class="fa-solid fa-book-bible"></i> Courses</div></div>
      <div class="stat-card"><div class="num">${attendance.size}</div><div class="label"><i class="fa-solid fa-clipboard-check"></i> Attendance Records</div></div>
      <div class="stat-card"><div class="num">${feedback.size}</div><div class="label"><i class="fa-solid fa-comments"></i> Feedback Entries</div></div>
    </div>
    <div class="glass-card">
      <h4>Quick Actions</h4>
      <button class="btn-navy" id="qa-teacher"><i class="fa-solid fa-plus"></i> New Teacher</button>
      <button class="btn-navy" id="qa-student"><i class="fa-solid fa-plus"></i> New Student</button>
      <button class="btn-gold" id="qa-announce"><i class="fa-solid fa-bullhorn"></i> New Announcement</button>
    </div>`;
  document.getElementById("qa-teacher").onclick = () => document.querySelector('[data-view="teachers"]').click();
  document.getElementById("qa-student").onclick = () => document.querySelector('[data-view="students"]').click();
  document.getElementById("qa-announce").onclick = () => document.querySelector('[data-view="announcements"]').click();
}

/* ---------- Persistent credentials modal (doesn't auto-dismiss like a toast) ---------- */
function showCredentialsModal(role, name, id, passcode) {
  const old = document.getElementById("creds-modal-backdrop");
  if (old) old.remove();
  const backdrop = document.createElement("div");
  backdrop.id = "creds-modal-backdrop";
  backdrop.style.cssText = "position:fixed;inset:0;background:rgba(11,37,69,.75);z-index:900;display:flex;align-items:center;justify-content:center;padding:20px;";
  backdrop.innerHTML = `
    <div class="glass-card" style="max-width:440px;width:100%;background:#fff;">
      <h4><i class="fa-solid fa-circle-check" style="color:var(--success);"></i> ${role} Created</h4>
      <p style="color:var(--muted);">Save or share these login details with <strong>${name}</strong> now — this passcode cannot be shown again after you close this box.</p>
      <div class="form-field"><label>Login ID</label><input readonly value="${id}" id="cred-id"></div>
      <div class="form-field"><label>Passcode</label><input readonly value="${passcode}" id="cred-pass"></div>
      <button class="btn-gold" id="cred-copy"><i class="fa-solid fa-copy"></i> Copy Both</button>
      <button class="btn-outline" id="cred-close">I've Saved This — Close</button>
    </div>`;
  document.body.appendChild(backdrop);
  document.getElementById("cred-copy").onclick = async () => {
    await navigator.clipboard.writeText(`Login ID: ${id}\nPasscode: ${passcode}`);
    toast("Copied to clipboard", "success");
  };
  document.getElementById("cred-close").onclick = () => backdrop.remove();
}

/* ---------- Reset Login: issues a brand-new ID + passcode (see chat explanation
   for why an in-place password change isn't possible on the free client-only
   Firebase plan) ---------- */
async function resetCredentials(role, oldDocId, refreshFn) {
  const col = role === "teacher" ? COL.teachers : COL.students;
  const idField = role === "teacher" ? "teacherId" : "studentId";
  const prefix = role === "teacher" ? "TCH" : "STU";

  if (!confirm(`Reset this ${role}'s login? They will receive a brand-new ID and passcode — their old ID will stop working. Their name, email, course, and history stay linked to their profile.`)) return;

  const oldSnap = await getDoc(doc(db, col, oldDocId));
  if (!oldSnap.exists()) { toast("Record not found.", "error"); return; }
  const oldData = oldSnap.data();

  const newId = generateId(prefix);
  const newPasscode = generatePasscode();

  try {
    const sAuth = secondaryAuth();
    const cred = await createUserWithEmailAndPassword(sAuth, `${newId.toLowerCase()}@cacgw.app`, newPasscode);
    await setDoc(doc(db, col, cred.user.uid), {
      ...oldData,
      [idField]: newId,
      createdAt: oldData.createdAt || serverTimestamp()
    });
    if (role === "teacher" && oldData.courseId) {
      await updateDoc(doc(db, COL.courses, oldData.courseId), { teacherId: cred.user.uid });
    }
    await deleteDoc(doc(db, col, oldDocId)); // old login profile removed so old ID/passcode can no longer sign in
    await signOutSecondary(sAuth);
    await logActivity(user.uid, "admin", "reset_" + role, `${oldData[idField]} -> ${newId}`);
    showCredentialsModal(role === "teacher" ? "Teacher" : "Student", oldData.fullName, newId, newPasscode);
    if (refreshFn) refreshFn();
  } catch (err) {
    console.error(err);
    toast(err.message, "error");
  }
}


async function renderTeachers() {
  main.innerHTML = `<div class="skeleton" style="height:220px;"></div>`;
  const coursesSnap = await getDocs(collection(db, COL.courses));
  const courseOptions = coursesSnap.docs.map(d => `<option value="${d.id}">${d.data().code} — ${d.data().title}</option>`).join("");

  main.innerHTML = `
    <h2><i class="fa-solid fa-chalkboard-user"></i> Teachers</h2>
    <div class="glass-card" style="margin-bottom:20px;">
      <h4>Create New Teacher</h4>
      <form id="teacher-form" class="row g-2">
        <div class="col-md-4 form-field"><label>Full Name</label><input required id="t-name" type="text"></div>
        <div class="col-md-4 form-field"><label>Email (for notifications)</label><input required id="t-email" type="email"></div>
        <div class="col-md-4 form-field"><label>Assign Course</label><select id="t-course">${courseOptions}</select></div>
        <div class="col-12"><button class="btn-gold" type="submit"><i class="fa-solid fa-user-plus"></i> Generate ID & Create Teacher</button></div>
      </form>
    </div>
    <div class="glass-card"><div id="teacher-table-wrap">Loading…</div></div>`;

  document.getElementById("teacher-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("t-name").value;
    const email = document.getElementById("t-email").value;
    const courseId = document.getElementById("t-course").value;
    const teacherId = generateId("TCH");
    const passcode = generatePasscode();
    try {
      const sAuth = secondaryAuth();
      const cred = await createUserWithEmailAndPassword(sAuth, `${teacherId.toLowerCase()}@cacgw.app`, passcode);
      await setDoc(doc(db, COL.teachers, cred.user.uid), {
        fullName: name, email, teacherId, courseId, active: true,
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, COL.courses, courseId), { teacherId: cred.user.uid });
      await signOutSecondary(sAuth);
      await logActivity(user.uid, "admin", "create_teacher", teacherId);
      showCredentialsModal("Teacher", name, teacherId, passcode);
      e.target.reset();
      loadTeacherTable();
    } catch (err) { console.error(err); toast(err.message, "error"); }
  });

  loadTeacherTable();
}

async function loadTeacherTable() {
  const wrap = document.getElementById("teacher-table-wrap");
  const snap = await getDocs(collection(db, COL.teachers));
  if (snap.empty) { wrap.innerHTML = "<p>No teachers yet.</p>"; return; }
  let rows = "";
  snap.forEach(d => {
    const t = d.data();
    rows += `<tr>
      <td>${t.teacherId || "—"}</td><td>${t.fullName}</td><td>${t.email || ""}</td>
      <td><span class="badge ${t.active === false ? "inactive" : "active"}">${t.active === false ? "Inactive" : "Active"}</span></td>
      <td>
        <button class="btn-outline" data-act="toggle" data-id="${d.id}" data-state="${t.active}">${t.active === false ? "Activate" : "Deactivate"}</button>
        <button class="btn-navy" data-act="reset" data-id="${d.id}"><i class="fa-solid fa-key"></i> Reset Login</button>
        <button class="btn-danger" data-act="delete" data-id="${d.id}">Delete</button>
      </td></tr>`;
  });
  wrap.innerHTML = `<table class="data-table"><thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`;
  wrap.querySelectorAll("[data-act=toggle]").forEach(b => b.onclick = async () => {
    await updateDoc(doc(db, COL.teachers, b.dataset.id), { active: !(b.dataset.state === "true") });
    toast("Status updated", "success"); loadTeacherTable();
  });
  wrap.querySelectorAll("[data-act=reset]").forEach(b => b.onclick = () => resetCredentials("teacher", b.dataset.id, loadTeacherTable));
  wrap.querySelectorAll("[data-act=delete]").forEach(b => b.onclick = async () => {
    if (!confirm("Delete this teacher record? (Auth account must be removed separately in Firebase console)")) return;
    await deleteDoc(doc(db, COL.teachers, b.dataset.id));
    toast("Teacher deleted", "success"); loadTeacherTable();
  });
}

/* ============================== STUDENTS ============================== */
async function renderStudents() {
  main.innerHTML = `<div class="skeleton" style="height:220px;"></div>`;
  const coursesSnap = await getDocs(collection(db, COL.courses));
  const courseOptions = coursesSnap.docs.map(d => `<option value="${d.id}">${d.data().code} — ${d.data().title}</option>`).join("");

  main.innerHTML = `
    <h2><i class="fa-solid fa-user-graduate"></i> Students</h2>
    <div class="glass-card" style="margin-bottom:20px;">
      <h4>Create New Student</h4>
      <form id="student-form" class="row g-2">
        <div class="col-md-4 form-field"><label>Full Name</label><input required id="s-name" type="text"></div>
        <div class="col-md-4 form-field"><label>Email (for notifications)</label><input required id="s-email" type="email"></div>
        <div class="col-md-4 form-field"><label>Enroll in Course</label><select id="s-course">${courseOptions}</select></div>
        <div class="col-12"><button class="btn-gold" type="submit"><i class="fa-solid fa-user-plus"></i> Generate ID & Create Student</button></div>
      </form>
    </div>
    <div class="glass-card"><div id="student-table-wrap">Loading…</div></div>`;

  document.getElementById("student-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("s-name").value;
    const email = document.getElementById("s-email").value;
    const courseId = document.getElementById("s-course").value;
    const studentId = generateId("STU");
    const passcode = generatePasscode();
    try {
      const sAuth = secondaryAuth();
      const cred = await createUserWithEmailAndPassword(sAuth, `${studentId.toLowerCase()}@cacgw.app`, passcode);
      await setDoc(doc(db, COL.students, cred.user.uid), {
        fullName: name, email, studentId, courseId, active: true,
        createdAt: serverTimestamp(), progress: {}
      });
      await signOutSecondary(sAuth);
      await logActivity(user.uid, "admin", "create_student", studentId);
      showCredentialsModal("Student", name, studentId, passcode);
      e.target.reset();
      loadStudentTable();
    } catch (err) { console.error(err); toast(err.message, "error"); }
  });

  loadStudentTable();
}

async function loadStudentTable() {
  const wrap = document.getElementById("student-table-wrap");
  const snap = await getDocs(collection(db, COL.students));
  if (snap.empty) { wrap.innerHTML = "<p>No students yet.</p>"; return; }
  let rows = "";
  snap.forEach(d => {
    const s = d.data();
    rows += `<tr>
      <td>${s.studentId || "—"}</td><td>${s.fullName}</td><td>${s.email || ""}</td>
      <td><span class="badge ${s.active === false ? "inactive" : "active"}">${s.active === false ? "Inactive" : "Active"}</span></td>
      <td>
        <button class="btn-outline" data-act="toggle" data-id="${d.id}" data-state="${s.active}">${s.active === false ? "Activate" : "Deactivate"}</button>
        <button class="btn-navy" data-act="reset" data-id="${d.id}"><i class="fa-solid fa-key"></i> Reset Login</button>
        <button class="btn-danger" data-act="delete" data-id="${d.id}">Delete</button>
      </td></tr>`;
  });
  wrap.innerHTML = `<table class="data-table"><thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`;
  wrap.querySelectorAll("[data-act=toggle]").forEach(b => b.onclick = async () => {
    await updateDoc(doc(db, COL.students, b.dataset.id), { active: !(b.dataset.state === "true") });
    toast("Status updated", "success"); loadStudentTable();
  });
  wrap.querySelectorAll("[data-act=reset]").forEach(b => b.onclick = () => resetCredentials("student", b.dataset.id, loadStudentTable));
  wrap.querySelectorAll("[data-act=delete]").forEach(b => b.onclick = async () => {
    if (!confirm("Delete this student record?")) return;
    await deleteDoc(doc(db, COL.students, b.dataset.id));
    toast("Student deleted", "success"); loadStudentTable();
  });
}

/* ============================== COURSES ============================== */
async function renderCourses() {
  main.innerHTML = `<div class="skeleton" style="height:220px;"></div>`;
  const [coursesSnap, teachersSnap] = await Promise.all([getDocs(collection(db, COL.courses)), getDocs(collection(db, COL.teachers))]);
  const teacherMap = {}; teachersSnap.forEach(d => teacherMap[d.id] = d.data().fullName);
  let tiles = "";
  coursesSnap.forEach(d => {
    const c = d.data();
    tiles += `<div class="course-tile" style="background:${c.color};position:relative;" data-id="${d.id}">
      <button class="btn-danger" data-del="${d.id}" title="Delete course"
        style="position:absolute;top:8px;right:8px;padding:2px 9px;font-size:.8rem;">
        <i class="fa-solid fa-trash"></i>
      </button>
      <div data-edit="${d.id}" style="cursor:pointer;">
        <h5>${c.code}</h5><div>${c.title}</div>
        <small>${c.teacherId ? "Teacher: " + (teacherMap[c.teacherId] || "Assigned") : "No teacher assigned"}</small>
        <small style="opacity:.75;margin-top:6px;display:block;"><i class="fa-solid fa-pen"></i> Click to edit</small>
      </div>
    </div>`;
  });
  main.innerHTML = `<h2><i class="fa-solid fa-book-bible"></i> Course Catalog</h2>
    <p style="color:var(--muted);">Click a course tile to rename it. Assign teachers from the Teachers tab. Upload materials from Content Uploads.</p>
    <div class="glass-card" style="margin-bottom:20px;">
      <h4>Add New Course</h4>
      <form id="add-course-form" class="row g-2">
        <div class="col-md-4 form-field"><label>Course Code</label><input required id="new-code" type="text" placeholder="e.g. BIB111"></div>
        <div class="col-md-5 form-field"><label>Course Title</label><input required id="new-title" type="text" placeholder="e.g. Prophetic Ministry"></div>
        <div class="col-md-2 form-field"><label>Color</label><input id="new-color" type="color" value="#0b2545" style="width:100%;height:44px;"></div>
        <div class="col-md-1 form-field" style="align-self:end;"><button class="btn-gold w-100" type="submit"><i class="fa-solid fa-plus"></i></button></div>
      </form>
    </div>
    <div class="course-grid">${tiles}</div>
    <div id="course-edit-modal"></div>`;

  document.getElementById("add-course-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = document.getElementById("new-code").value.trim();
    const title = document.getElementById("new-title").value.trim();
    const color = document.getElementById("new-color").value;
    if (!code || !title) return;
    const newDoc = await addDoc(collection(db, COL.courses), {
      code, title, color, teacherId: "", studentCount: 0, createdAt: new Date().toISOString()
    });
    await logActivity(user.uid, "admin", "add_course", `${newDoc.id}: ${code} — ${title}`);
    toast("Course added!", "success");
    renderCourses();
  });

  document.querySelectorAll('[data-edit]').forEach(tile => {
    tile.onclick = () => openCourseEditor(tile.dataset.edit);
  });
  document.querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      if (!confirm("Delete this course? This does NOT delete its uploaded ebooks/videos/exam questions in Storage — remove those separately if needed.")) return;
      await deleteDoc(doc(db, COL.courses, id));
      await logActivity(user.uid, "admin", "delete_course", id);
      toast("Course deleted", "success");
      renderCourses();
    };
  });
}

async function openCourseEditor(courseId) {
  const cSnap = await getDoc(doc(db, COL.courses, courseId));
  const c = cSnap.data();
  const modalWrap = document.getElementById("course-edit-modal");
  modalWrap.innerHTML = `
    <div class="glass-card" style="margin-top:20px;max-width:480px;">
      <h4><i class="fa-solid fa-pen"></i> Edit Course</h4>
      <div class="form-field"><label>Course Code</label><input id="edit-code" type="text" value="${c.code}"></div>
      <div class="form-field"><label>Course Title</label><input id="edit-title" type="text" value="${c.title}"></div>
      <div class="form-field"><label>Tile Color</label><input id="edit-color" type="color" value="${c.color || "#0b2545"}"></div>
      <button class="btn-gold" id="edit-save">Save Changes</button>
      <button class="btn-outline" id="edit-cancel">Cancel</button>
    </div>`;
  modalWrap.scrollIntoView({ behavior: "smooth" });
  document.getElementById("edit-cancel").onclick = () => modalWrap.innerHTML = "";
  document.getElementById("edit-save").onclick = async () => {
    const code = document.getElementById("edit-code").value.trim();
    const title = document.getElementById("edit-title").value.trim();
    const color = document.getElementById("edit-color").value;
    if (!code || !title) { toast("Course code and title cannot be empty.", "error"); return; }
    await updateDoc(doc(db, COL.courses, courseId), { code, title, color });
    await logActivity(user.uid, "admin", "edit_course", `${courseId}: ${code} — ${title}`);
    toast("Course updated!", "success");
    renderCourses();
  };
}

/* ============================== CONTENT UPLOADS ============================== */
async function renderContent() {
  main.innerHTML = `<div class="skeleton" style="height:220px;"></div>`;
  const coursesSnap = await getDocs(collection(db, COL.courses));
  const courseOptions = coursesSnap.docs.map(d => `<option value="${d.id}">${d.data().code} — ${d.data().title}</option>`).join("");
  main.innerHTML = `
    <h2><i class="fa-solid fa-cloud-arrow-up"></i> Content Uploads</h2>
    <div class="glass-card">
      <form id="upload-form" class="row g-2">
        <div class="col-md-4 form-field"><label>Course</label><select id="u-course">${courseOptions}</select></div>
        <div class="col-md-4 form-field"><label>Content Type</label>
          <select id="u-type">
            <option value="ebooks">Ebook</option>
            <option value="handbooks">Handbook</option>
            <option value="syllabus">Syllabus</option>
            <option value="audio">Audio Teaching</option>
            <option value="videos">Video</option>
          </select>
        </div>
        <div class="col-md-4 form-field"><label>Title</label><input required id="u-title" type="text"></div>
        <div class="col-md-8 form-field"><label>File</label><input required id="u-file" type="file"></div>
        <div class="col-md-4 form-field" style="align-self:end;"><button class="btn-gold w-100" type="submit"><i class="fa-solid fa-upload"></i> Upload</button></div>
      </form>
      <div id="upload-progress" style="margin-top:10px;"></div>
    </div>
    <div class="glass-card" style="margin-top:20px;"><div id="content-list">Select a course above and upload to see items here.</div></div>`;

  document.getElementById("upload-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const courseId = document.getElementById("u-course").value;
    const type = document.getElementById("u-type").value;
    const title = document.getElementById("u-title").value;
    const file = document.getElementById("u-file").files[0];
    if (!file) return;
    const path = `${type}/${courseId}/${Date.now()}_${file.name}`;
    const sref = ref(storage, path);
    const task = uploadBytesResumable(sref, file);
    const prog = document.getElementById("upload-progress");
    task.on("state_changed", (snap) => {
      const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
      prog.innerHTML = `<div class="skeleton" style="height:10px;width:${pct}%;"></div><small>${pct}%</small>`;
    }, (err) => toast(err.message, "error"), async () => {
      const url = await getDownloadURL(sref);
      await addDoc(collection(db, COL[type]), { courseId, title, url, path, uploadedAt: serverTimestamp(), uploadedBy: "admin" });
      await logActivity(user.uid, "admin", "upload_" + type, title);
      toast("Uploaded successfully", "success");
      prog.innerHTML = "";
      e.target.reset();
    });
  });
}

/* ============================== EXAM QUESTIONS ============================== */
async function renderExams() {
  main.innerHTML = `<div class="skeleton" style="height:220px;"></div>`;
  const coursesSnap = await getDocs(collection(db, COL.courses));
  const courseOptions = coursesSnap.docs.map(d => `<option value="${d.id}">${d.data().code} — ${d.data().title}</option>`).join("");
  main.innerHTML = `
    <h2><i class="fa-solid fa-file-pen"></i> Exam Questions</h2>
    <div class="glass-card">
      <form id="exam-form">
        <div class="row g-2">
          <div class="col-md-4 form-field"><label>Course</label><select id="e-course">${courseOptions}</select></div>
          <div class="col-md-4 form-field"><label>Question Type</label>
            <select id="e-type"><option value="objective">Objective</option><option value="theory">Theory</option></select></div>
          <div class="col-md-4 form-field"><label>Language</label>
            <select id="e-lang"><option value="english">English</option><option value="yoruba">Yoruba</option></select></div>
        </div>
        <div class="form-field"><label>Question</label><textarea id="e-question" required rows="2"></textarea></div>
        <div class="row g-2" id="options-wrap">
          <div class="col-md-3 form-field"><label>Option A</label><input id="e-a" type="text"></div>
          <div class="col-md-3 form-field"><label>Option B</label><input id="e-b" type="text"></div>
          <div class="col-md-3 form-field"><label>Option C</label><input id="e-c" type="text"></div>
          <div class="col-md-3 form-field"><label>Option D</label><input id="e-d" type="text"></div>
        </div>
        <div class="form-field"><label>Correct Answer (A/B/C/D, ignored for theory)</label><input id="e-correct" type="text" maxlength="1"></div>
        <button class="btn-gold" type="submit"><i class="fa-solid fa-plus"></i> Add Question</button>
      </form>
    </div>
    <div class="glass-card" style="margin-top:20px;"><div id="exam-list">Loading…</div></div>`;

  document.getElementById("exam-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = {
      courseId: document.getElementById("e-course").value,
      type: document.getElementById("e-type").value,
      language: document.getElementById("e-lang").value,
      question: document.getElementById("e-question").value,
      options: {
        A: document.getElementById("e-a").value, B: document.getElementById("e-b").value,
        C: document.getElementById("e-c").value, D: document.getElementById("e-d").value
      },
      correct: document.getElementById("e-correct").value.toUpperCase(),
      createdAt: serverTimestamp()
    };
    await addDoc(collection(db, COL.examQuestions), q);
    toast("Question added", "success");
    e.target.reset();
    loadExamList();
  });
  loadExamList();
}
async function loadExamList() {
  const wrap = document.getElementById("exam-list");
  const snap = await getDocs(collection(db, COL.examQuestions));
  if (snap.empty) { wrap.innerHTML = "<p>No exam questions yet.</p>"; return; }
  let rows = "";
  snap.forEach(d => {
    const q = d.data();
    rows += `<tr><td>${q.question}</td><td>${q.type}</td><td>${q.language}</td><td>${q.correct || "—"}</td>
      <td><button class="btn-danger" data-id="${d.id}">Delete</button></td></tr>`;
  });
  wrap.innerHTML = `<table class="data-table"><thead><tr><th>Question</th><th>Type</th><th>Lang</th><th>Answer</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  wrap.querySelectorAll("button[data-id]").forEach(b => b.onclick = async () => {
    await deleteDoc(doc(db, COL.examQuestions, b.dataset.id)); loadExamList();
  });
}

/* ============================== ANNOUNCEMENTS ============================== */
async function renderAnnouncements() {
  main.innerHTML = `
    <h2><i class="fa-solid fa-bullhorn"></i> Announcements</h2>
    <div class="glass-card">
      <form id="ann-form">
        <div class="form-field"><label>Title</label><input required id="a-title" type="text"></div>
        <div class="form-field"><label>Message</label><textarea required id="a-message" rows="3"></textarea></div>
        <button class="btn-gold" type="submit"><i class="fa-solid fa-paper-plane"></i> Publish to Everyone</button>
      </form>
    </div>
    <div class="glass-card" style="margin-top:20px;"><div id="ann-list">Loading…</div></div>`;
  document.getElementById("ann-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await addDoc(collection(db, COL.notifications), {
      title: document.getElementById("a-title").value,
      body: document.getElementById("a-message").value,
      audience: "all", createdAt: serverTimestamp()
    });
    toast("Announcement published", "success");
    e.target.reset();
    loadAnnouncements();
  });
  loadAnnouncements();
}
async function loadAnnouncements() {
  const wrap = document.getElementById("ann-list");
  const snap = await getDocs(query(collection(db, COL.notifications), orderBy("createdAt", "desc")));
  let rows = "";
  snap.forEach(d => { const a = d.data(); rows += `<tr><td>${a.title}</td><td>${a.body}</td></tr>`; });
  wrap.innerHTML = snap.empty ? "<p>No announcements yet.</p>" : `<table class="data-table"><thead><tr><th>Title</th><th>Message</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ============================== FEEDBACK ============================== */
async function renderFeedback() {
  main.innerHTML = `<h2><i class="fa-solid fa-comments"></i> Feedback</h2><div class="glass-card"><div id="fb-list">Loading…</div></div>`;
  const snap = await getDocs(collection(db, COL.feedback));
  let rows = "";
  snap.forEach(d => { const f = d.data(); rows += `<tr><td>${f.courseId || "—"}</td><td>${f.rating || "—"}★</td><td>${f.comment || ""}</td></tr>`; });
  document.getElementById("fb-list").innerHTML = snap.empty ? "<p>No feedback yet.</p>" : `<table class="data-table"><thead><tr><th>Course</th><th>Rating</th><th>Comment</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ============================== REPORTS / EXPORT ============================== */
async function renderReports() {
  main.innerHTML = `
    <h2><i class="fa-solid fa-chart-column"></i> Reports & Analytics</h2>
    <div class="glass-card">
      <p>Export full platform data for offline record keeping.</p>
      <button class="btn-navy" id="exp-csv"><i class="fa-solid fa-file-csv"></i> Export Students (CSV / Excel)</button>
      <button class="btn-gold" id="exp-pdf"><i class="fa-solid fa-file-pdf"></i> Export Summary (PDF)</button>
    </div>`;
  document.getElementById("exp-csv").onclick = exportStudentsCSV;
  document.getElementById("exp-pdf").onclick = exportSummaryPDF;
}
async function exportStudentsCSV() {
  const snap = await getDocs(collection(db, COL.students));
  let csv = "Student ID,Full Name,Email,Course,Status\n";
  snap.forEach(d => { const s = d.data(); csv += `${s.studentId},${s.fullName},${s.email},${s.courseId},${s.active === false ? "Inactive" : "Active"}\n`; });
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "students.csv"; a.click();
  toast("Exported students.csv", "success");
}
async function exportSummaryPDF() {
  const { jsPDF } = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm");
  const [teachers, students, courses] = await Promise.all([getDocs(collection(db, COL.teachers)), getDocs(collection(db, COL.students)), getDocs(collection(db, COL.courses))]);
  const pdf = new jsPDF();
  pdf.setFontSize(16); pdf.text("CAC Good Works Assembly Believers Bible College", 15, 20);
  pdf.setFontSize(11); pdf.text("Platform Summary Report", 15, 28);
  pdf.text(`Teachers: ${teachers.size}`, 15, 42);
  pdf.text(`Students: ${students.size}`, 15, 50);
  pdf.text(`Courses: ${courses.size}`, 15, 58);
  pdf.text(`Generated: ${new Date().toLocaleString()}`, 15, 70);
  pdf.save("college-summary.pdf");
  toast("PDF report downloaded", "success");
}

/* ============================== ACTIVITY LOGS ============================== */
async function renderLogs() {
  main.innerHTML = `<h2><i class="fa-solid fa-clock-rotate-left"></i> Activity Logs</h2><div class="glass-card"><div id="log-list">Loading…</div></div>`;
  const snap = await getDocs(query(collection(db, COL.activityLogs), orderBy("timestamp", "desc")));
  let rows = "";
  let count = 0;
  snap.forEach(d => {
    if (count++ > 100) return;
    const l = d.data();
    rows += `<tr><td>${l.role}</td><td>${l.action}</td><td>${l.details || ""}</td><td>${l.timestamp?.toDate ? l.timestamp.toDate().toLocaleString() : ""}</td></tr>`;
  });
  document.getElementById("log-list").innerHTML = snap.empty ? "<p>No activity yet.</p>" : `<table class="data-table"><thead><tr><th>Role</th><th>Action</th><th>Details</th><th>When</th></tr></thead><tbody>${rows}</tbody></table>`;
}
