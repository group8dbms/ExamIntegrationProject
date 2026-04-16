const crypto = require("crypto");
const env = require("../config/env");

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value) {
  return crypto.createHmac("sha256", env.authSecret).update(value).digest("base64url");
}

function createAuthToken(user) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    role: user.role,
    email: user.email,
    fullName: user.full_name || user.fullName,
    iat: issuedAt,
    exp: issuedAt + (Math.max(1, env.authTokenTtlHours) * 60 * 60)
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifyAuthToken(token) {
  if (!token || !token.includes(".")) {
    throw new Error("Authentication token is missing or invalid.");
  }

  const [encodedPayload, providedSignature] = token.split(".");
  if (!encodedPayload || !providedSignature) {
    throw new Error("Authentication token is malformed.");
  }

  const expectedSignature = sign(encodedPayload);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw new Error("Authentication token signature is invalid.");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  if (!payload.sub || !payload.role || !payload.exp) {
    throw new Error("Authentication token payload is invalid.");
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Authentication token has expired.");
  }

  return {
    id: payload.sub,
    role: payload.role,
    email: payload.email,
    fullName: payload.fullName
  };
}

module.exports = {
  createAuthToken,
  verifyAuthToken
};
