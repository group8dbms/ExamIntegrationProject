const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const healthRoutes = require("./routes/health-routes");
const authRoutes = require("./routes/auth-routes");
const examRoutes = require("./routes/exam-routes");
const submissionRoutes = require("./routes/submission-routes");
const integrityRoutes = require("./routes/integrity-routes");
const auditRoutes = require("./routes/audit-routes");
const documentsRoutes = require("./routes/documents-routes");
const errorHandler = require("./middleware/error-handler");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

app.get("/", (req, res) => {
  res.json({
    name: "exam-integrity-backend",
    status: "running",
    docs: {
      health: "/health",
      auth: "/api/auth",
      exams: "/api/exams",
      submissions: "/api/submissions",
      integrity: "/api/integrity",
      audit: "/api/audit",
      documents: "/api/documents"
    }
  });
});

app.use("/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/submissions", submissionRoutes);
app.use("/api/integrity", integrityRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/documents", documentsRoutes);

app.use(errorHandler);

module.exports = app;
