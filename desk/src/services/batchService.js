const db = require("../integration/db");

async function create(batch) {
  await db.query(
    `INSERT INTO processing_batches (batch_id, banker_id, kind, deposit_count, totals)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [batch.batchId, batch.bankerId, batch.kind, batch.depositCount, JSON.stringify(batch.totals)],
  );
}

async function remove(batchId) {
  await db.query("DELETE FROM processing_batches WHERE batch_id = $1", [batchId]);
}

module.exports = { create, remove };
