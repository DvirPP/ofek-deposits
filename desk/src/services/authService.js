const { randomBytes, scryptSync, timingSafeEqual } = require("crypto");
const { config } = require("../config");
const db = require("../integration/db");

async function login(username, password) {
  const found = await db.query(
    "SELECT id, username, display_name, password_hash FROM bankers WHERE username = $1",
    [username],
  );
  const banker = found.rows[0];
  if (!banker || !verifyPassword(password, banker.password_hash)) return null;
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + config.sessionHours * 60 * 60 * 1000);
  await db.query("INSERT INTO sessions (token, banker_id, expires_at) VALUES ($1, $2, $3)", [
    token,
    banker.id,
    expiresAt.toISOString(),
  ]);
  return {
    token,
    expiresAt: expiresAt.toISOString(),
    banker: { id: banker.id, username: banker.username, displayName: banker.display_name },
  };
}

async function bankerFromRequest(req) {
  const token = readToken(req);
  if (!token) return null;
  const found = await db.query(
    `SELECT b.id, b.username, b.display_name
     FROM sessions s
     JOIN bankers b ON b.id = s.banker_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  const banker = found.rows[0];
  if (!banker) return null;
  return { id: banker.id, username: banker.username, displayName: banker.display_name };
}

function readToken(req) {
  const header = req.header("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  const cookie = req.header("cookie") ?? "";
  const pair = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("session="));
  return pair ? decodeURIComponent(pair.slice("session=".length)) : null;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

module.exports = { login, bankerFromRequest };
