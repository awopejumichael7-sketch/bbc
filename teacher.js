/* ==========================================================================
   TEACHER.JS — Teacher Dashboard
   ========================================================================== */
import { guardRoute, logout } from "./auth.js";
import {
  db, storage, COL, ICE_CONFIG, collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, onSnapshot, ref, uploadBytesResumable, getDownloadURL,
  logActivity
} from "./firebase-config.js";
import { toast, initTheme, toggleTheme, registerServiceWorker } from "./app-shell.js";
import { openDrivePicker, makeFilePublic, verifyPublicAccess, driveFileViewUrl, uploadFileToDrive, loadGoogleScripts } from "./drive-config.js";

initTheme();
registerServiceWorker();
const main = document.getElementById("main-content");
document.getElementById("theme-btn").onclick = toggleTheme;
document.getElementById("logout-btn").onclick = logout;

let user, profile, course;

guardRoute("teacher").then(async (u) => {
  user = u;
  const snap = await getDoc(doc(db, COL.teachers, u.uid));
  profile = snap.data();
  if (profile.courseId) {
    const cSnap = await getDoc(doc(db, COL.courses, profile.courseId));
    course = { id: profile.courseId, ...cSnap.data() };
  }
  bindSidebar();
  renderOverview();
});

function bindSidebar() {
  document.querySelectorAll(".sidebar a").forEach(a => {
    a.addEventListener("click", () => {
      document.querySelectorAll(".sidebar a").forEach(x => x.classList.remove("active"));
      a.classList.add("active");
      ({
        overview: renderOverview, materials: renderMaterials, studio: renderStudio,
        live: renderLive, attendance: renderAttendance, questions: renderQuestions, feedback: renderFeedback
      })[a.dataset.view]();
    });
  });
}

function renderOverview() {
  main.innerHTML = `
    <h2>Welcome, ${profile.fullName}</h2>
    <p style="color:var(--muted);">Assigned course: <strong>${course ? course.code + " — " + course.title : "None assigned yet — contact Admin"}</strong></p>
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${course ? course.code : "—"}</div><div class="label">Your Course</div></div>
      <div class="stat-card"><div class="num"><i class="fa-solid fa-id-badge"></i></div><div class="label">${profile.teacherId}</div></div>
    </div>
    <div class="glass-card">
      <h4>Quick Actions</h4>
      <button class="btn-navy" onclick="document.querySelector('[data-view=materials]').click()"><i class="fa-solid fa-cloud-arrow-up"></i> Upload Material</button>
      <button class="btn-gold" onclick="document.querySelector('[data-view=studio]').click()"><i class="fa-solid fa-video"></i> Open Studio</button>
    </div>`;
}

/* ---------- Upload materials (ebook, handbook, syllabus, assignment) ---------- */
function renderMaterials() {
  if (!course) { main.innerHTML = "<p>No course assigned yet.</p>"; return; }
  loadGoogleScripts().catch(() => {}); // warm up Drive sign-in in the background so it's instant when clicked
  main.innerHTML = `
    <h2><i class="fa-solid fa-cloud-arrow-up"></i> Upload Materials — ${course.title}</h2>
    <div class="glass-card">
      <form id="mat-form" class="row g-2">
        <div class="col-md-4 form-field"><label>Type</label>
          <select id="m-type">
            <option value="ebooks">Ebook</option>
            <option value="handbooks">Handbook</option>
            <option value="syllabus">Syllabus</option>
            <option value="notes">Lesson Notes</option>
            <option value="assignments">Assignment</option>
            <option value="audio">Audio Teaching</option>
            <option value="videos">Video</option>
          </select>
        </div>
        <div class="col-md-4 form-field"><label>Title</label><input required id="m-title" type="text"></div>

        <div class="col-12 form-field">
          <label>Save To</label><br>
          <label style="margin-right:16px;"><input type="radio" name="m-dest" value="storage" checked> Firebase Storage (upload from this device)</label>
          <label><input type="radio" name="m-dest" value="drive"> Google Drive (pick an existing file)</label>
        </div>
        <div class="col-md-8 form-field" id="m-storage-field"><label>File</label><input id="m-file" type="file"></div>
        <div class="col-md-8 form-field" id="m-drive-field" style="display:none;">
          <button type="button" class="btn-outline" id="m-drive-pick"><i class="fa-brands fa-google-drive"></i> Choose from Google Drive</button>
          <span id="m-drive-chosen" style="margin-left:10px;color:var(--muted);"></span>
        </div>

        <div class="col-12"><button class="btn-gold" type="submit"><i class="fa-solid fa-upload"></i> Save</button></div>
      </form>
      <div id="m-progress" style="margin-top:10px;"></div>
    </div>
    <div class="glass-card" style="margin-top:20px;">
      <h4>Existing Materials</h4>
      <div class="form-field" style="max-width:280px;"><label>Filter by Type</label>
        <select id="ml-type">
          <option value="ebooks">Ebooks</option>
          <option value="handbooks">Handbooks</option>
          <option value="syllabus">Syllabus</option>
          <option value="notes">Lesson Notes</option>
          <option value="assignments">Assignments</option>
          <option value="audio">Audio Teachings</option>
          <option value="videos">Videos</option>
        </select>
      </div>
      <div id="materials-list">Loading…</div>
    </div>`;

  let pickedDriveFile = null;
  document.querySelectorAll('input[name="m-dest"]').forEach(r => r.onchange = () => {
    const isDrive = document.querySelector('input[name="m-dest"]:checked').value === "drive";
    document.getElementById("m-storage-field").style.display = isDrive ? "none" : "block";
    document.getElementById("m-drive-field").style.display = isDrive ? "block" : "none";
  });
  document.getElementById("m-drive-pick").onclick = async () => {
    try {
      const file = await openDrivePicker();
      if (file) { pickedDriveFile = file; document.getElementById("m-drive-chosen").textContent = `Selected: ${file.name}`; }
    } catch (err) { toast("Could not connect to Google Drive: " + err.message, "error"); }
  };

  document.getElementById("mat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const type = document.getElementById("m-type").value;
    const title = document.getElementById("m-title").value;
    const col = COL[type] || "materials";
    const targetCol = (type === "notes" || type === "assignments") ? "materials" : col;
    const dest = document.querySelector('input[name="m-dest"]:checked').value;
    const prog = document.getElementById("m-progress");

    if (dest === "storage") {
      const file = document.getElementById("m-file").files[0];
      if (!file) { toast("Choose a file first.", "error"); return; }
      const path = `${type}/${course.id}/${Date.now()}_${file.name}`;
      const sref = ref(storage, path);
      const task = uploadBytesResumable(sref, file);
      task.on("state_changed", (s) => {
        const pct = Math.round((s.bytesTransferred / s.totalBytes) * 100);
        prog.innerHTML = `<div class="skeleton" style="height:10px;width:${pct}%;"></div><small>${pct}%</small>`;
      }, (err) => toast(err.message, "error"), async () => {
        const url = await getDownloadURL(sref);
        await addDoc(collection(db, targetCol), {
          courseId: course.id, title, url, type, source: "storage", uploadedBy: user.uid, uploadedAt: serverTimestamp()
        });
        await logActivity(user.uid, "teacher", "upload_" + type, title);
        toast("Uploaded to Firebase Storage", "success");
        prog.innerHTML = ""; e.target.reset(); pickedDriveFile = null;
        document.getElementById("ml-type").value = type;
        loadMaterialsList();
      });
    } else {
      if (!pickedDriveFile) { toast("Choose a file from Google Drive first.", "error"); return; }
      prog.innerHTML = "Step 1 of 3: Making the file link-shareable…";
      try {
        await makeFilePublic(pickedDriveFile.id);
        prog.innerHTML = "Step 2 of 3: Confirming it's publicly reachable…";
        await verifyPublicAccess(pickedDriveFile.id);
        prog.innerHTML = "Step 3 of 3: Saving to the course…";
        await addDoc(collection(db, targetCol), {
          courseId: course.id, title, url: driveFileViewUrl(pickedDriveFile.id), driveFileId: pickedDriveFile.id,
          type, source: "drive", uploadedBy: user.uid, uploadedAt: serverTimestamp()
        });
        await logActivity(user.uid, "teacher", "link_drive_" + type, title);
        toast("Linked from Google Drive", "success");
        prog.innerHTML = ""; e.target.reset(); pickedDriveFile = null;
        document.getElementById("m-drive-chosen").textContent = "";
        document.getElementById("ml-type").value = type;
        loadMaterialsList();
      } catch (err) {
        toast(err.message, "error");
        prog.innerHTML = `<p style="color:var(--danger);border:1px solid var(--danger);border-radius:10px;padding:10px 14px;">
          <i class="fa-solid fa-triangle-exclamation"></i> ${err.message}</p>`;
      }
    }
  });

  document.getElementById("ml-type").onchange = loadMaterialsList;
  document.getElementById("ml-type").value = document.getElementById("m-type").value;
  loadMaterialsList();
}

async function loadMaterialsList() {
  const wrap = document.getElementById("materials-list");
  if (!wrap || !course) return;
  wrap.innerHTML = "Loading…";
  const type = document.getElementById("ml-type").value;
  const isShared = type === "notes" || type === "assignments";
  const targetCol = isShared ? "materials" : (COL[type] || "materials");
  let snap;
  try {
    snap = isShared
      ? await getDocs(query(collection(db, targetCol), where("courseId", "==", course.id), where("type", "==", type)))
      : await getDocs(query(collection(db, targetCol), where("courseId", "==", course.id)));
  } catch (err) {
    wrap.innerHTML = `<p style="color:var(--danger);">Could not load this list: ${err.message}</p>
      <button class="btn-outline" id="ml-retry">Retry</button>`;
    document.getElementById("ml-retry").onclick = loadMaterialsList;
    return;
  }
  if (snap.empty) { wrap.innerHTML = "<p>Nothing uploaded here yet for this type.</p>"; return; }
  let rows = "";
  snap.forEach(d => {
    const item = d.data();
    const badge = item.source === "drive"
      ? '<span class="badge active"><i class="fa-brands fa-google-drive"></i> Drive</span>'
      : '<span class="badge active">Firebase Storage</span>';
    rows += `<tr><td>${item.title}</td><td>${badge}</td>
      <td><a class="btn-outline" href="${item.url}" target="_blank" rel="noopener"><i class="fa-solid fa-eye"></i> Open</a>
      <button class="btn-danger" data-id="${d.id}" data-col="${targetCol}">Delete</button></td></tr>`;
  });
  wrap.innerHTML = `<table class="data-table"><thead><tr><th>Title</th><th>Source</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`;
  wrap.querySelectorAll("button[data-id]").forEach(b => b.onclick = async () => {
    if (!confirm("Delete this item? This removes it from the course — it does not delete the underlying file from Firebase Storage or Google Drive itself.")) return;
    try {
      await deleteDoc(doc(db, b.dataset.col, b.dataset.id));
      await logActivity(user.uid, "teacher", "delete_material", b.dataset.id);
      toast("Deleted", "success");
      loadMaterialsList();
    } catch (err) {
      toast("Could not delete: " + err.message, "error");
    }
  });
}

/* ---------- Recording Studio: audio + video via MediaRecorder ---------- */
let mediaStream, mediaRecorder, chunks = [], recKind = "video";

function renderStudio() {
  if (!course) { main.innerHTML = "<p>No course assigned yet.</p>"; return; }
  loadGoogleScripts().catch(() => {}); // warm up Drive sign-in in the background so it's instant when clicked
  main.innerHTML = `
    <h2><i class="fa-solid fa-video"></i> Recording Studio — ${course.title}</h2>
    <div class="glass-card studio-wrap">
      <div style="flex:1;min-width:280px;">
        <div class="studio-preview"><video id="preview" autoplay muted playsinline></video></div>
        <div class="studio-controls">
          <button class="btn-navy" id="cam-on"><i class="fa-solid fa-camera"></i> Camera On</button>
          <button class="btn-outline" id="cam-off"><i class="fa-solid fa-camera-slash"></i> Camera Off</button>
          <button class="btn-navy" id="mic-on"><i class="fa-solid fa-microphone"></i> Mic On</button>
          <button class="btn-outline" id="mic-off"><i class="fa-solid fa-microphone-slash"></i> Mic Off</button>
        </div>
        <div class="studio-controls">
          <select id="rec-kind" class="form-select" style="width:auto;">
            <option value="video">Record Video Lesson</option>
            <option value="audio">Record Audio Teaching</option>
          </select>
          <select id="rec-dest" class="form-select" style="width:auto;">
            <option value="storage">Save to: Firebase Storage</option>
            <option value="drive">Save to: Google Drive</option>
          </select>
          <button class="btn-gold" id="rec-start"><i class="fa-solid fa-circle"></i> Start Recording</button>
          <button class="btn-outline" id="rec-pause" disabled>Pause</button>
          <button class="btn-outline" id="rec-resume" disabled>Resume</button>
          <button class="btn-danger" id="rec-stop" disabled>Stop & Save</button>
        </div>
        <p id="rec-status" style="margin-top:8px;color:var(--muted);"></p>
      </div>
    </div>
    <p style="color:var(--muted);font-size:.85rem;margin-top:10px;"><i class="fa-solid fa-circle-info"></i>
      Recordings save automatically when you click Stop — to Firebase Storage or your Google Drive, whichever you pick above. Students can only stream — downloading is disabled on their end.</p>`;

  document.getElementById("cam-on").onclick = async () => {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById("preview").srcObject = mediaStream;
  };
  document.getElementById("cam-off").onclick = () => {
    mediaStream?.getVideoTracks().forEach(t => t.stop());
  };
  document.getElementById("mic-on").onclick = async () => {
    if (!mediaStream) mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    else {
      const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
      audio.getAudioTracks().forEach(t => mediaStream.addTrack(t));
    }
    toast("Microphone enabled", "success");
  };
  document.getElementById("mic-off").onclick = () => {
    mediaStream?.getAudioTracks().forEach(t => t.stop());
  };
  document.getElementById("rec-kind").onchange = (e) => recKind = e.target.value;

  document.getElementById("rec-start").onclick = async () => {
    if (!mediaStream) {
      mediaStream = recKind === "audio"
        ? await navigator.mediaDevices.getUserMedia({ audio: true })
        : await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      document.getElementById("preview").srcObject = mediaStream;
    }
    chunks = [];
    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mediaRecorder.onstop = saveRecording;
    mediaRecorder.start();
    document.getElementById("rec-status").innerHTML = `<span class="rec-dot"></span> Recording ${recKind}…`;
    toggleRecBtns(true);
  };
  document.getElementById("rec-pause").onclick = () => { mediaRecorder.pause(); document.getElementById("rec-status").textContent = "Paused"; };
  document.getElementById("rec-resume").onclick = () => { mediaRecorder.resume(); document.getElementById("rec-status").innerHTML = `<span class="rec-dot"></span> Recording…`; };
  document.getElementById("rec-stop").onclick = () => { mediaRecorder.stop(); toggleRecBtns(false); };
}

function toggleRecBtns(recording) {
  document.getElementById("rec-start").disabled = recording;
  document.getElementById("rec-pause").disabled = !recording;
  document.getElementById("rec-resume").disabled = !recording;
  document.getElementById("rec-stop").disabled = !recording;
}

async function saveRecording() {
  const blob = new Blob(chunks, { type: recKind === "audio" ? "audio/webm" : "video/webm" });
  const dest = document.getElementById("rec-dest")?.value || "storage";
  const filename = `${Date.now()}_lesson.webm`;
  const title = `Lesson — ${new Date().toLocaleString()}`;
  const statusEl = document.getElementById("rec-status");

  if (dest === "storage") {
    const path = `${recKind === "audio" ? "audio" : "videos"}/${course.id}/${filename}`;
    const sref = ref(storage, path);
    statusEl.textContent = "Uploading to Firebase Storage…";
    const task = uploadBytesResumable(sref, blob);
    task.on("state_changed", (s) => {
      const pct = Math.round((s.bytesTransferred / s.totalBytes) * 100);
      statusEl.textContent = `Uploading ${pct}%…`;
    }, (err) => toast(err.message, "error"), async () => {
      const url = await getDownloadURL(sref);
      await addDoc(collection(db, recKind === "audio" ? COL.audio : COL.videos), {
        courseId: course.id, title, url, source: "storage", uploadedBy: user.uid, uploadedAt: serverTimestamp(), streamOnly: true
      });
      await logActivity(user.uid, "teacher", "record_" + recKind, course.id);
      statusEl.textContent = "Saved and available to students!";
      toast("Recording saved to Firebase Storage", "success");
    });
  } else {
    statusEl.textContent = "Uploading to Google Drive…";
    try {
      const fileId = await uploadFileToDrive(blob, filename, recKind === "audio" ? "audio/webm" : "video/webm");
      await addDoc(collection(db, recKind === "audio" ? COL.audio : COL.videos), {
        courseId: course.id, title, url: driveFileViewUrl(fileId), driveFileId: fileId,
        source: "drive", uploadedBy: user.uid, uploadedAt: serverTimestamp(), streamOnly: true
      });
      await logActivity(user.uid, "teacher", "record_drive_" + recKind, course.id);
      statusEl.textContent = "Saved to Google Drive and available to students!";
      toast("Recording saved to Google Drive", "success");
    } catch (err) {
      statusEl.textContent = "Could not save to Google Drive.";
      toast(err.message, "error");
    }
  }
}

/* ---------- Live Class: real-time WebRTC broadcast, nothing is recorded.
   Students may also turn on their own camera/mic — each student tile below
   shows their live feed the moment they enable it. ---------- */
let liveStream = null;
const livePeers = {};          // viewerUid -> RTCPeerConnection
const liveViewerInfo = {};     // viewerUid -> { studentName, studentId }
const liveRemoteStreams = {};  // viewerUid -> MediaStream (that student's camera/mic)
let unsubViewers = null;

function renderLive() {
  if (!course) { main.innerHTML = "<p>No course assigned yet.</p>"; return; }
  const isLive = !!liveStream;
  main.innerHTML = `
    <h2><i class="fa-solid fa-tower-broadcast"></i> Live Class — ${course.title}</h2>
    <div class="glass-card studio-wrap">
      <div style="flex:1;min-width:280px;">
        <div class="studio-preview"><video id="live-preview" autoplay muted playsinline></video></div>
        <div class="studio-controls">
          <button class="btn-gold" id="go-live" ${isLive ? "disabled" : ""}><i class="fa-solid fa-tower-broadcast"></i> Go Live</button>
          <button class="btn-outline" id="live-cam-toggle" ${isLive ? "" : "disabled"}><i class="fa-solid fa-camera"></i> Toggle Camera</button>
          <button class="btn-outline" id="live-mic-toggle" ${isLive ? "" : "disabled"}><i class="fa-solid fa-microphone"></i> Toggle Mic</button>
          <button class="btn-danger" id="end-live" ${isLive ? "" : "disabled"}>End Live Class</button>
        </div>
        <p id="live-status" style="margin-top:8px;color:var(--muted);">${isLive ? `<span class="rec-dot"></span> LIVE — ${Object.keys(livePeers).length} student(s) connected` : ""}</p>
      </div>
    </div>
    <h4 style="margin-top:20px;"><i class="fa-solid fa-users"></i> Students</h4>
    <div class="course-grid" id="student-tiles"></div>
    <p style="color:var(--muted);font-size:.85rem;margin-top:10px;">
      <i class="fa-solid fa-circle-info"></i> This is a live, real-time broadcast — nothing is recorded or saved. Students on the Live Class tab of this course will see it the moment you go live, and any student who turns on their camera/mic will appear in a tile above.
    </p>`;

  if (isLive) {
    document.getElementById("live-preview").srcObject = liveStream;
    renderStudentTiles();
  }

  document.getElementById("go-live").onclick = startLive;
  document.getElementById("end-live").onclick = endLive;
  document.getElementById("live-cam-toggle").onclick = () => liveStream?.getVideoTracks().forEach(t => t.enabled = !t.enabled);
  document.getElementById("live-mic-toggle").onclick = () => liveStream?.getAudioTracks().forEach(t => t.enabled = !t.enabled);
}

function renderStudentTiles() {
  const wrap = document.getElementById("student-tiles");
  if (!wrap) return;
  const ids = Object.keys(livePeers);
  if (!ids.length) { wrap.innerHTML = `<p style="color:var(--muted);">No students connected yet.</p>`; return; }
  wrap.innerHTML = ids.map(id => {
    const info = liveViewerInfo[id] || {};
    return `<div class="course-tile" style="background:#101a2c;padding:0;overflow:hidden;">
      <video id="tile-${id}" autoplay playsinline style="width:100%;height:100%;object-fit:cover;background:#000;"></video>
      <div style="position:absolute;bottom:8px;left:10px;font-size:.8rem;background:rgba(0,0,0,.5);padding:2px 8px;border-radius:6px;">
        ${info.studentName || "Student"} ${info.studentId ? "(" + info.studentId + ")" : ""}
      </div>
    </div>`;
  }).join("");
  ids.forEach(id => {
    const vid = document.getElementById(`tile-${id}`);
    if (vid && liveRemoteStreams[id]) vid.srcObject = liveRemoteStreams[id];
  });
}

async function startLive() {
  try {
    liveStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) { toast("Camera/microphone access is required to go live.", "error"); return; }

  await setDoc(doc(db, COL.liveSessions, course.id), {
    active: true, teacherUid: user.uid, courseTitle: course.title, startedAt: serverTimestamp()
  });

  const viewersCol = collection(db, COL.liveSessions, course.id, "viewers");
  unsubViewers = onSnapshot(viewersCol, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "added") handleNewViewer(change.doc.id, change.doc.data());
      if (change.type === "removed" && livePeers[change.doc.id]) {
        livePeers[change.doc.id].close();
        delete livePeers[change.doc.id];
        delete liveViewerInfo[change.doc.id];
        delete liveRemoteStreams[change.doc.id];
        updateLiveStatus();
        renderStudentTiles();
      }
    });
  });

  await logActivity(user.uid, "teacher", "start_live", course.id);
  toast("You're live!", "success");
  renderLive();
}

async function handleNewViewer(viewerId, data) {
  if (livePeers[viewerId] || !data.offer) return;
  const pc = new RTCPeerConnection(ICE_CONFIG);
  livePeers[viewerId] = pc;
  liveViewerInfo[viewerId] = { studentName: data.studentName, studentId: data.studentId };
  liveRemoteStreams[viewerId] = new MediaStream();

  liveStream.getTracks().forEach((track) => pc.addTrack(track, liveStream));

  // Receive that student's camera/mic if/when they turn it on
  pc.ontrack = (e) => {
    liveRemoteStreams[viewerId].addTrack(e.track);
    const vid = document.getElementById(`tile-${viewerId}`);
    if (vid) vid.srcObject = liveRemoteStreams[viewerId];
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) addDoc(collection(db, COL.liveSessions, course.id, "viewers", viewerId, "teacherCandidates"), e.candidate.toJSON());
  };
  pc.onconnectionstatechange = () => { if (["disconnected", "failed", "closed"].includes(pc.connectionState)) updateLiveStatus(); };

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await updateDoc(doc(db, COL.liveSessions, course.id, "viewers", viewerId), { answer: { type: answer.type, sdp: answer.sdp } });

  onSnapshot(collection(db, COL.liveSessions, course.id, "viewers", viewerId, "studentCandidates"), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "added") pc.addIceCandidate(new RTCIceCandidate(change.doc.data())).catch(() => {});
    });
  });

  updateLiveStatus();
  renderStudentTiles();
}

function updateLiveStatus() {
  const el = document.getElementById("live-status");
  if (el) el.innerHTML = `<span class="rec-dot"></span> LIVE — ${Object.keys(livePeers).length} student(s) connected`;
}

async function endLive() {
  Object.values(livePeers).forEach((pc) => pc.close());
  Object.keys(livePeers).forEach((k) => delete livePeers[k]);
  Object.keys(liveViewerInfo).forEach((k) => delete liveViewerInfo[k]);
  Object.keys(liveRemoteStreams).forEach((k) => delete liveRemoteStreams[k]);
  if (unsubViewers) { unsubViewers(); unsubViewers = null; }
  liveStream?.getTracks().forEach((t) => t.stop());
  liveStream = null;

  await updateDoc(doc(db, COL.liveSessions, course.id), { active: false, endedAt: serverTimestamp() });
  const viewersSnap = await getDocs(collection(db, COL.liveSessions, course.id, "viewers"));
  for (const v of viewersSnap.docs) await deleteDoc(v.ref); // best-effort cleanup of signaling docs

  await logActivity(user.uid, "teacher", "end_live", course.id);
  toast("Live class ended.", "success");
  renderLive();
}

/* ---------- Attendance ---------- */
async function renderAttendance() {
  if (!course) { main.innerHTML = "<p>No course assigned yet.</p>"; return; }
  main.innerHTML = `<h2><i class="fa-solid fa-clipboard-check"></i> Attendance — ${course.title}</h2><div class="glass-card"><div id="att-list">Loading…</div></div>`;
  const snap = await getDocs(query(collection(db, COL.attendance), where("courseId", "==", course.id)));
  let rows = "";
  snap.forEach(d => { const a = d.data(); rows += `<tr><td>${a.studentId}</td><td>${a.date}</td><td>${a.time}</td><td>${a.duration || "—"}</td></tr>`; });
  document.getElementById("att-list").innerHTML = snap.empty ? "<p>No attendance records yet.</p>" : `<table class="data-table"><thead><tr><th>Student</th><th>Date</th><th>Time</th><th>Duration</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ---------- Student Questions ---------- */
async function renderQuestions() {
  if (!course) { main.innerHTML = "<p>No course assigned yet.</p>"; return; }
  main.innerHTML = `<h2><i class="fa-solid fa-comments"></i> Student Questions — ${course.title}</h2><div id="q-list">Loading…</div>`;
  const snap = await getDocs(query(collection(db, COL.questions), where("courseId", "==", course.id)));
  const wrap = document.getElementById("q-list");
  if (snap.empty) { wrap.innerHTML = "<p>No questions yet.</p>"; return; }
  wrap.innerHTML = "";
  snap.forEach(d => {
    const q = d.data();
    const card = document.createElement("div");
    card.className = "glass-card";
    card.style.marginBottom = "12px";
    card.innerHTML = `<strong>${q.studentName || "Student"}:</strong> ${q.question}
      <div style="margin-top:8px;color:var(--muted);">${q.answer ? "<strong>Answer:</strong> " + q.answer : ""}</div>
      ${!q.answer ? `<div class="form-field" style="margin-top:10px;"><textarea rows="2" class="ans-box"></textarea><button class="btn-gold ans-btn" style="margin-top:6px;">Answer</button></div>` : ""}`;
    if (!q.answer) {
      card.querySelector(".ans-btn").onclick = async () => {
        const ans = card.querySelector(".ans-box").value;
        await updateDoc(doc(db, COL.questions, d.id), { answer: ans, answeredAt: serverTimestamp() });
        toast("Answer posted", "success");
        renderQuestions();
      };
    }
    wrap.appendChild(card);
  });
}

/* ---------- Feedback ---------- */
async function renderFeedback() {
  if (!course) { main.innerHTML = "<p>No course assigned yet.</p>"; return; }
  main.innerHTML = `<h2><i class="fa-solid fa-star"></i> Feedback — ${course.title}</h2><div class="glass-card"><div id="fb-list">Loading…</div></div>`;
  const snap = await getDocs(query(collection(db, COL.feedback), where("courseId", "==", course.id)));
  let rows = "";
  snap.forEach(d => { const f = d.data(); rows += `<tr><td>${f.rating || "—"}★</td><td>${f.comment || ""}</td></tr>`; });
  document.getElementById("fb-list").innerHTML = snap.empty ? "<p>No feedback yet.</p>" : `<table class="data-table"><thead><tr><th>Rating</th><th>Comment</th></tr></thead><tbody>${rows}</tbody></table>`;
}
