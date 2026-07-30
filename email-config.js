/* ==========================================================================
   EMAIL-CONFIG.JS — Real email notifications via EmailJS (free tier)
   --------------------------------------------------------------------------
   ONE-TIME SETUP (5 minutes, no cost, no credit card):
   1. Go to https://www.emailjs.com → create a free account.
   2. "Email Services" → Add New Service → connect a Gmail/Outlook account
      (or use EmailJS's own test address while you're setting things up).
      Copy the Service ID it gives you.
   3. "Email Templates" → Create New Template. Use these variable names in
      your template body so they match what this app sends:
        {{to_name}}   {{to_email}}   {{subject}}   {{message}}
      A simple template body works fine:
        Subject: {{subject}}
        Hello {{to_name}}, {{message}}
      Copy the Template ID it gives you.
   4. "Account" → "General" → copy your Public Key.
   5. Paste all three values below.

   FREE TIER LIMIT: EmailJS's free plan sends up to 200 emails/month. This
   module is deliberately conservative about when it sends mail (account
   creation, exam grading, and opt-in announcement notifications only) so a
   small college stays comfortably inside that limit. See README.md for more.
   ========================================================================== */

// ---- REPLACE WITH YOUR OWN EMAILJS CREDENTIALS ------------------------
export const EMAILJS_PUBLIC_KEY = "RTPaCdCRNw91ntczK";
export const EMAILJS_SERVICE_ID = "service_cd7m9pa";
export const EMAILJS_TEMPLATE_ID = "template_z2q41ac";
// -----------------------------------------------------------------------

let sdkLoadPromise = null;
let initialized = false;

/* ---------- Self-hosted SDK (emailjs.min.js lives in this same folder) —
   loaded on demand, not on every page load, and never from a third-party CDN ---------- */
function loadEmailJsSdk() {
  if (window.emailjs) return Promise.resolve(window.emailjs);
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "./emailjs.min.js";
    script.onload = () => {
      if (window.emailjs) resolve(window.emailjs);
      else reject(new Error("Email service failed to initialize."));
    };
    script.onerror = () => reject(new Error("Could not load the email service library."));
    document.head.appendChild(script);
  });
  return sdkLoadPromise;
}

async function ensureInit() {
  const emailjs = await loadEmailJsSdk();
  if (!initialized) {
    emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    initialized = true;
  }
  return emailjs;
}

/* ---------- Low-level send — every notification below funnels through this.
   Failures are caught by callers deliberately: a notification email failing
   to send should never block the underlying action (account creation,
   grading, etc.) from succeeding. ---------- */
export async function sendNotificationEmail({ toEmail, toName, subject, message }) {
  if (!toEmail) return { skipped: true, reason: "No email address on file." };
  if (EMAILJS_PUBLIC_KEY.startsWith("YOUR_")) return { skipped: true, reason: "Email notifications aren't configured yet (see email-config.js)." };
  const emailjs = await ensureInit();
  return emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
    to_email: toEmail, to_name: toName || "there", subject, message
  });
}

/* ---------- Convenience helpers for each notification this app sends ---------- */

export function sendWelcomeEmail(toEmail, toName, role, loginId, passCode) {
  return sendNotificationEmail({
    toEmail, toName,
    subject: `Welcome to CAC Good Works Assembly Believers Bible College`,
    message: `Your ${role} account has been created.\n\nLogin ID: ${loginId}\n\n \n\nPasscode: ${passCode}\n\nFor security, your passcode was shown only once on screen to whoever created your account — please collect it from the College Administrator if you don't already have it.\n\nYou can sign in at the college portal using your Login ID and passcode.`
  });
}

export function sendResultEmail(toEmail, toName, courseTitle, score, total, percent, grade) {
  return sendNotificationEmail({
    toEmail, toName,
    subject: `Your exam result for ${courseTitle} is ready`,
    message: `Your exam for "${courseTitle}" has been fully graded.\n\nScore: ${score}/${total} (${percent}%)\nGrade: ${grade}\n\nLog in to your student portal to view details${percent >= 50 ? " and download your certificate" : ""}.`
  });
}

export function sendAnnouncementEmail(toEmail, toName, title, body) {
  return sendNotificationEmail({
    toEmail, toName,
    subject: `Announcement: ${title}`,
    message: body
  });
}
