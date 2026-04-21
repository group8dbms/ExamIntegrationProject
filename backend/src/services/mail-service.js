const nodemailer = require("nodemailer");
const env = require("../config/env");

function isMailConfigured() {
  return Boolean(env.smtpHost && env.smtpUser && env.smtpPass && env.smtpFrom);
}

function createTransporter() {
  if (!isMailConfigured()) {
    throw new Error("SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM to send emails.");
  }

  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass
    }
  });
}

async function sendVerificationEmail({ toEmail, toName, verificationUrl }) {
  const transporter = createTransporter();

  await transporter.sendMail({
    from: env.smtpFrom,
    to: toEmail,
    subject: "Verify your student account",
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;color:#102033;line-height:1.6">
        <h2>Verify your student account</h2>
        <p>Hello ${toName || "Student"},</p>
        <p>Click the button below to verify your email and activate your exam dashboard.</p>
        <p>
          <a href="${verificationUrl}" style="display:inline-block;padding:12px 18px;background:#0f8bd7;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600">
            Verify Email
          </a>
        </p>
        <p>If the button does not work, open this link:</p>
        <p><a href="${verificationUrl}">${verificationUrl}</a></p>
      </div>
    `
  });
}

async function sendResultPublishedEmail({ toEmail, toName, examTitle, courseCode, awardedMarks, totalMarks, percentage, integrityScore, caseStatus, submissionHashVerified, thresholdBreached = false, integrityThreshold = null, resultOutcome = null }) {
  const transporter = createTransporter();
  const normalizedOutcome = String(resultOutcome || (thresholdBreached ? "Failed due to integrity threshold breach" : "Published"));
  const failedOutcome = normalizedOutcome.toLowerCase().includes("failed") || normalizedOutcome.toLowerCase().includes("disqualified");
  const displayCaseStatus = caseStatus || "clear";
  const cheatingConfirmed = String(displayCaseStatus).toLowerCase() === "confirmed_cheating" || normalizedOutcome.toLowerCase().includes("confirmed cheating");

  await transporter.sendMail({
    from: env.smtpFrom,
    to: toEmail,
    subject: `${failedOutcome ? "Failed result" : "Result published"}: ${examTitle}`,
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;color:#102033;line-height:1.6">
        <h2>Your exam result has been published</h2>
        <p>Hello ${toName || "Student"},</p>
        <p>Your result for <strong>${examTitle}</strong> (${courseCode}) is now available.</p>
        ${failedOutcome ? `
          <div style="margin:16px 0;padding:14px 16px;border-radius:14px;background:#fff0f0;border:1px solid #f2b4b4;color:#7b1f1f;font-weight:600">
            Final outcome: ${normalizedOutcome}
          </div>
        ` : ""}
        ${cheatingConfirmed ? `
          <div style="margin:16px 0;padding:14px 16px;border-radius:14px;background:#fff0f0;border:1px solid #f2b4b4;color:#7b1f1f;font-weight:600">
            The proctor confirmed cheating for this attempt. This exam has been recorded as disqualified.
          </div>
        ` : thresholdBreached ? `
          <div style="margin:16px 0;padding:14px 16px;border-radius:14px;background:#fff0f0;border:1px solid #f2b4b4;color:#7b1f1f;font-weight:600">
            An integrity case was opened due to suspicious activity, and your final penalty total crossed the exam threshold${integrityThreshold !== null ? ` (${integrityThreshold})` : ""}. This attempt has been marked as failed on integrity grounds.
          </div>
        ` : ""}
        <table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:520px">
          <tr><td style="padding:10px;border:1px solid #d7e2ee">Awarded Marks</td><td style="padding:10px;border:1px solid #d7e2ee">${awardedMarks}</td></tr>
          <tr><td style="padding:10px;border:1px solid #d7e2ee">Total Marks</td><td style="padding:10px;border:1px solid #d7e2ee">${totalMarks}</td></tr>
          <tr><td style="padding:10px;border:1px solid #d7e2ee">Percentage</td><td style="padding:10px;border:1px solid #d7e2ee">${percentage}%</td></tr>
          <tr><td style="padding:10px;border:1px solid #d7e2ee">Integrity Score</td><td style="padding:10px;border:1px solid #d7e2ee">${integrityScore}</td></tr>
          <tr><td style="padding:10px;border:1px solid #d7e2ee">Case Status</td><td style="padding:10px;border:1px solid #d7e2ee">${displayCaseStatus}</td></tr>
          <tr><td style="padding:10px;border:1px solid #d7e2ee">Result Outcome</td><td style="padding:10px;border:1px solid #d7e2ee">${normalizedOutcome}</td></tr>
          <tr><td style="padding:10px;border:1px solid #d7e2ee">Submission Hash Verified</td><td style="padding:10px;border:1px solid #d7e2ee">${submissionHashVerified ? "Yes" : "No"}</td></tr>
        </table>
        <p>If you believe there is an issue with your result, please contact your instructor for re-check workflow support.</p>
      </div>
    `
  });
}

async function sendPasswordResetEmail({ toEmail, toName, resetUrl }) {
  const transporter = createTransporter();

  await transporter.sendMail({
    from: env.smtpFrom,
    to: toEmail,
    subject: "Reset your student password",
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;color:#102033;line-height:1.6">
        <h2>Reset your password</h2>
        <p>Hello ${toName || "Student"},</p>
        <p>We received a request to reset your student password. Use the button below to choose a new password.</p>
        <p>
          <a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#0f8bd7;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600">
            Reset Password
          </a>
        </p>
        <p>This link expires soon and can only be used once.</p>
        <p>If the button does not work, open this link:</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
      </div>
    `
  });
}

async function sendPublishApprovalEmail({ toEmail, toName, examTitle, courseCode, requestedByName, approvalUrl = null }) {
  const transporter = createTransporter();

  await transporter.sendMail({
    from: env.smtpFrom,
    to: toEmail,
    subject: `Approval needed before publishing results: ${examTitle}`,
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;color:#102033;line-height:1.6">
        <h2>Result publication approval requested</h2>
        <p>Hello ${toName || "Admin"},</p>
        <p>${requestedByName || "Another admin"} has requested approval to publish results for <strong>${examTitle}</strong> (${courseCode}).</p>
        <p>Please review the exam in the admin workspace and approve the request if everything looks correct.</p>
        ${approvalUrl ? `<p><a href="${approvalUrl}" style="display:inline-block;padding:12px 18px;background:#0f8bd7;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600">Open Admin Workspace</a></p>` : ""}
      </div>
    `
  });
}

module.exports = {
  isMailConfigured,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendResultPublishedEmail,
  sendPublishApprovalEmail
};
