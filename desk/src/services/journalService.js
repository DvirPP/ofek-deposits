const db = require("../integration/db");

async function open(load) {
  await db.query(
    `INSERT INTO load_journal (load_id, banker_id, file_name, content_hash, summary)
     VALUES ($1, $2, $3, $4, $5)`,
    [load.loadId, load.bankerId, load.fileName, load.contentHash, {}],
  );
}

async function writeSummary(loadId, summary) {
  await db.query("UPDATE load_journal SET summary = $2 WHERE load_id = $1", [loadId, summary]);
}

async function find(loadId) {
  const found = await db.query("SELECT decision FROM load_journal WHERE load_id = $1", [loadId]);
  return found.rows[0] ?? null;
}

async function mark(loadId, decision) {
  await db.query("UPDATE load_journal SET decision = $2, decided_at = now() WHERE load_id = $1", [
    loadId,
    decision,
  ]);
}

module.exports = { open, writeSummary, find, mark };
