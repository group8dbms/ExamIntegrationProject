const express = require("express");
const asyncHandler = require("../middleware/async-handler");
const pool = require("../db/pool");

const router = express.Router();

router.get(
  "/logs",
  asyncHandler(async (req, res) => {
    const { entityType, actorRole, limit = 50 } = req.query;
    const values = [];
    const filters = [];

    if (entityType) {
      values.push(entityType);
      filters.push(`entity_type = $${values.length}`);
    }

    if (actorRole) {
      values.push(actorRole);
      filters.push(`actor_role = $${values.length}`);
    }

    values.push(Number(limit));
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const result = await pool.query(
      `
        SELECT id, actor_user_id, actor_role, action, entity_type, entity_id, occurred_at, ip_address, details
          FROM audit_log
          ${where}
         ORDER BY occurred_at DESC
         LIMIT $${values.length}
      `,
      values
    );

    res.json({ items: result.rows });
  })
);

module.exports = router;
