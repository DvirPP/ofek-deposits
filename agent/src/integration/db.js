const { Pool } = require("pg");
const { config } = require("../config");

const pool = new Pool({ connectionString: config.databaseUrl, max: 4 });

function readOnlySql(sql) {
  const text = String(sql ?? "").trim().replace(/;+\s*$/u, "");
  if (!text) {
    return { error: "SQL is required" };
  }
  if (text.includes(";")) {
    return { error: "Only one SELECT statement is allowed" };
  }
  if (!/^(select|with)\b/i.test(text)) {
    return { error: "Only SELECT is allowed" };
  }
  if (/\b(insert|update|delete|drop|alter|grant|revoke|truncate|copy|create|comment|vacuum|execute|call|do|set)\b/i.test(text)) {
    return { error: "Only read queries are allowed" };
  }
  return { sql: `SELECT * FROM (${text}) AS agent_query LIMIT 200` };
}

async function query(sql) {
  const checked = readOnlySql(sql);
  if (checked.error) return checked;
  try {
    const result = await pool.query(checked.sql);
    return {
      columns: result.fields.map((field) => field.name),
      rows: result.rows,
      rowCount: result.rowCount,
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function waitUntilReady() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (attempt === 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

module.exports = { query, waitUntilReady };
