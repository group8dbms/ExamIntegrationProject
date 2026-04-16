const express = require("express");
const asyncHandler = require("../middleware/async-handler");
const pool = require("../db/pool");
const env = require("../config/env");
const { writeAuditLog } = require("../services/audit-service");
const { hashPassword, verifyPassword, generateToken } = require("../services/password-service");
const { isMailConfigured, sendVerificationEmail } = require("../services/mail-service");
const { createAuthToken } = require("../services/auth-token-service");

const router = express.Router();

function serializeUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    emailVerified: user.email_verified
  };
}

async function sendStudentVerification({ req, email, fullName, token }) {
  const backendBaseUrl = `${req.protocol}://${req.get("host")}`;
  const verificationUrl = `${backendBaseUrl}/api/auth/verify?token=${encodeURIComponent(token)}&redirect=student`;
  await sendVerificationEmail({
    toEmail: email,
    toName: fullName,
    verificationUrl
  });
}

router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const { role } = req.query;
    const values = [];
    let where = "";

    if (role) {
      values.push(role);
      where = "WHERE role = $1::user_role";
    }

    const result = await pool.query(
      `
        SELECT id, email, full_name, role, email_verified, is_active, created_at
        FROM app_user
        ${where}
        ORDER BY created_at DESC, full_name ASC
      `,
      values
    );

    res.json({
      items: result.rows.map((user) => ({
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        emailVerified: user.email_verified,
        isActive: user.is_active,
        createdAt: user.created_at
      }))
    });
  })
);

router.post(
  "/bootstrap-user",
  asyncHandler(async (req, res) => {
    if (env.bootstrapSecret && req.headers["x-bootstrap-secret"] !== env.bootstrapSecret) {
      return res.status(403).json({ message: "Bootstrap access is disabled without a valid bootstrap secret." });
    }

    const { fullName, email, password, role } = req.body;
    const allowedRoles = ["admin", "proctor", "auditor", "evaluator", "instructor"];

    if (!fullName || !email || !password || !allowedRoles.includes(role)) {
      return res.status(400).json({ message: "fullName, email, password, and a valid staff role are required." });
    }

    const result = await pool.query(
      `
        INSERT INTO app_user (email, full_name, role, password_hash, email_verified)
        VALUES ($1, $2, $3::user_role, $4, TRUE)
        ON CONFLICT (email)
        DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, email_verified = TRUE, updated_at = NOW()
        RETURNING id, email, full_name, role, email_verified
      `,
      [email, fullName, role, hashPassword(password)]
    );

    res.status(201).json({ message: "Staff user ready.", user: result.rows[0] });
  })
);

router.post(
  "/student-access",
  asyncHandler(async (req, res) => {
    const { email, password, fullName = "" } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required." });
    }

    const lookup = await pool.query(
      `SELECT id, email, full_name, role, password_hash, email_verified, is_active, email_verification_token FROM app_user WHERE email = $1`,
      [email]
    );

    if (!lookup.rows.length) {
      if (!fullName.trim()) {
        return res.status(400).json({
          mode: "register",
          message: "This email is not registered yet. Enter full name to create a student account."
        });
      }

      if (!isMailConfigured()) {
        return res.status(500).json({
          message: "Student email verification is not configured yet. Add SMTP settings in backend/.env first."
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const token = generateToken();
        const created = await client.query(
          `
            INSERT INTO app_user (
              email,
              full_name,
              role,
              password_hash,
              email_verified,
              email_verification_token,
              verification_sent_at
            ) VALUES ($1, $2, 'student', $3, FALSE, $4, NOW())
            RETURNING id, email, full_name, role, email_verified, email_verification_token
          `,
          [email, fullName.trim(), hashPassword(password), token]
        );

        await sendStudentVerification({ req, email, fullName: fullName.trim(), token });

        await writeAuditLog(client, {
          actorUserId: created.rows[0].id,
          actorRole: "student",
          action: "student_registered",
          entityType: "app_user",
          entityId: created.rows[0].id,
          ipAddress: req.ip,
          details: { email }
        });

        await client.query("COMMIT");
        return res.status(201).json({
          mode: "verification_sent",
          message: `Verification email sent to ${email}. Please click the link in the mail to activate your account.`
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    const user = lookup.rows[0];
    if (user.role !== "student") {
      return res.status(403).json({ message: "This email belongs to a non-student account." });
    }
    if (!user.is_active) {
      return res.status(403).json({ message: "This account is inactive." });
    }
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    if (!user.email_verified) {
      if (!isMailConfigured()) {
        return res.status(403).json({ message: "Email is not verified yet and SMTP is not configured for resend." });
      }

      let token = user.email_verification_token;
      if (!token) {
        token = generateToken();
        await pool.query(
          `UPDATE app_user SET email_verification_token = $1, verification_sent_at = NOW(), updated_at = NOW() WHERE id = $2`,
          [token, user.id]
        );
      }

      await sendStudentVerification({ req, email: user.email, fullName: user.full_name, token });
      return res.status(202).json({
        mode: "verification_sent",
        message: `Your email is not verified yet. A fresh verification link has been sent to ${user.email}.`
      });
    }

    await pool.query(`UPDATE app_user SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`, [user.id]);

    res.json({
      mode: "login",
      message: "Login successful.",
      user: serializeUser(user),
      token: createAuthToken(user)
    });
  })
);

router.get(
  "/verify",
  asyncHandler(async (req, res) => {
    const { token, redirect = "student" } = req.query;

    if (!token) {
      return res.status(400).send("Verification token is required.");
    }

    const result = await pool.query(
      `
        UPDATE app_user
           SET email_verified = TRUE,
               email_verification_token = NULL,
               updated_at = NOW()
         WHERE email_verification_token = $1
         RETURNING id, email, full_name, role, email_verified
      `,
      [token]
    );

    if (!result.rows.length) {
      return res.redirect(`${env.frontendUrl}/?verified=invalid&role=${encodeURIComponent(redirect)}`);
    }

    return res.redirect(`${env.frontendUrl}/?verified=success&role=${encodeURIComponent(redirect)}&email=${encodeURIComponent(result.rows[0].email)}`);
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required." });
    }

    const result = await pool.query(
      `SELECT id, email, full_name, role, password_hash, email_verified, is_active FROM app_user WHERE email = $1`,
      [email]
    );

    if (!result.rows.length) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const user = result.rows[0];
    if (role && user.role !== role) {
      return res.status(403).json({ message: "Role mismatch for this account." });
    }
    if (!user.is_active || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ message: "Invalid credentials." });
    }
    if (user.role === "student" && !user.email_verified) {
      return res.status(403).json({ message: "Verify the email before login." });
    }

    await pool.query(`UPDATE app_user SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`, [user.id]);

    res.json({
      message: "Login successful.",
      user: serializeUser(user),
      token: createAuthToken(user)
    });
  })
);

module.exports = router;
