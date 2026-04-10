function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const payload = {
    message: err.message || "Internal server error"
  };

  if (process.env.NODE_ENV !== "production" && err.detail) {
    payload.detail = err.detail;
  }

  res.status(status).json(payload);
}

module.exports = errorHandler;
