const { verifyAuthToken } = require("../services/auth-token-service");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ message: "Authentication is required." });
  }

  try {
    req.user = verifyAuthToken(token);
    return next();
  } catch (error) {
    return res.status(401).json({ message: error.message || "Authentication failed." });
  }
}

function requireRole(...allowedRoles) {
  return function checkRole(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication is required." });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "You do not have access to this action." });
    }
    return next();
  };
}

function requireSelf(fieldName, { source = "params", allowRoles = [] } = {}) {
  return function checkSelf(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication is required." });
    }

    const container = req[source] || {};
    const requestedId = container[fieldName];
    if (requestedId && String(requestedId) === String(req.user.id)) {
      return next();
    }
    if (allowRoles.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({ message: "You can only access your own records." });
  };
}

module.exports = {
  requireAuth,
  requireRole,
  requireSelf
};
