async function writeAuditLog(client, input) {
  const {
    actorUserId = null,
    actorRole = null,
    action,
    entityType,
    entityId = null,
    ipAddress = null,
    details = {}
  } = input;

  await client.query(
    `SELECT write_audit_log($1::uuid, $2::user_role, $3::text, $4::text, $5::uuid, $6::inet, $7::jsonb)`,
    [actorUserId, actorRole, action, entityType, entityId, ipAddress, JSON.stringify(details)]
  );
}

module.exports = {
  writeAuditLog
};
