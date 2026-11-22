const db = require("../integration/db");

async function findReusable(contentHash) {
  const found = await db.query(
    `SELECT load_id, decision, preview
     FROM load_journal
     WHERE content_hash = $1 AND decision IS DISTINCT FROM 'no' AND preview IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [contentHash],
  );
  return found.rows[0] ?? null;
}

async function open(load) {
  await db.query(
    `INSERT INTO load_journal (load_id, banker_id, file_name, content_hash, summary, preview)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [load.loadId, load.bankerId, load.fileName, load.contentHash, load.summary, load.preview],
  );
}

async function read(loadId) {
  const found = await db.query(
    `SELECT load_id, banker_id, file_name, content_hash, decision, summary, preview
     FROM load_journal WHERE load_id = $1`,
    [loadId],
  );
  return found.rows[0] ?? null;
}

async function writeSummary(loadId, summary) {
  await db.query("UPDATE load_journal SET summary = $2 WHERE load_id = $1", [loadId, summary]);
}

async function mark(loadId, decision) {
  await db.query("UPDATE load_journal SET decision = $2, decided_at = now() WHERE load_id = $1", [
    loadId,
    decision,
  ]);
}

async function discard(loadId) {
  await db.query(
    "UPDATE load_journal SET decision = 'no', decided_at = now(), preview = NULL WHERE load_id = $1",
    [loadId],
  );
}

module.exports = { findReusable, open, read, writeSummary, mark, discard };
