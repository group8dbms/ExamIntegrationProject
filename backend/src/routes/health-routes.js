const express = require("express");
const asyncHandler = require("../middleware/async-handler");
const pool = require("../db/pool");

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    try {
      const db = await pool.query("SELECT NOW() AS server_time");
      res.json({
        status: "ok",
        service: "exam-integrity-backend",
        database: "connected",
        dbTime: db.rows[0].server_time
      });
    } catch (error) {
      res.status(503).json({
        status: "degraded",
        service: "exam-integrity-backend",
        database: "disconnected",
        message: error.message
      });
    }
  })
);

module.exports = router;
