// ===============================
// Imports & config
// ===============================
require("dotenv").config();

const express = require("express");
const cookieParser = require("cookie-parser");
const { Pool } = require("pg");
const https = require("https");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// ===============================
// PostgreSQL
// ===============================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

// ===============================
// Middlewares
// ===============================
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ===============================
// Utils
// ===============================
function isAdmin(req) {
  return req.cookies.admin === "true";
}

function isValidDateYYYYMMDD(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              return reject(
                new Error(parsed?.message || `HTTP ${res.statusCode}`)
              );
            }
            resolve(parsed);
          } catch (e) {
            reject(new Error("Réponse non JSON"));
          }
        });
      })
      .on("error", reject);
  });
}

// ===============================
// DB init
// ===============================
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calls (
      id SERIAL PRIMARY KEY,
      slot TEXT NOT NULL,
      username TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ NOT NULL,
      ip TEXT,
      slot TEXT,
      username TEXT
    );
  `);
})();

// ===============================
// SSE (events)
// ===============================
const clients = [];

app.get("/events", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const client = { res };
  clients.push(client);

  const calls = await getCalls();
  res.write(`data: ${JSON.stringify({ calls })}\n\n`);

  req.on("close", () => {
    clients.splice(clients.indexOf(client), 1);
  });
});

function broadcastCalls() {
  getCalls().then((calls) => {
    const payload = `data: ${JSON.stringify({ calls })}\n\n`;
    clients.forEach((c) => c.res.write(payload));
  });
}

// ===============================
// Calls helpers
// ===============================
async function getCalls() {
  const { rows } = await pool.query(
    "SELECT slot, username FROM calls ORDER BY id ASC"
  );
  return rows.map((r) => ({ slot: r.slot, user: r.username }));
}

// ===============================
// API Calls
// ===============================
app.get("/api/calls", async (req, res) => {
  const calls = await getCalls();
  res.json({ calls, admin: isAdmin(req) });
});

app.post("/api/call", async (req, res) => {
  const { slot, user } = req.body;
  if (!slot || !user)
    return res.status(400).json({ error: "Données manquantes" });

  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const timestamp = new Date();

  await pool.query(
    "INSERT INTO calls (slot, username) VALUES ($1, $2)",
    [slot, user]
  );

  await pool.query(
    "INSERT INTO logs (timestamp, ip, slot, username) VALUES ($1, $2, $3, $4)",
    [timestamp, ip, slot, user]
  );

  broadcastCalls();
  res.json({ success: true });
});

app.post("/api/delete", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Unauthorized" });

  const { index } = req.body;
  const { rows } = await pool.query("SELECT id FROM calls ORDER BY id ASC");

  if (index < 0 || index >= rows.length)
    return res.status(400).json({ error: "Index invalide" });

  await pool.query("DELETE FROM calls WHERE id = $1", [rows[index].id]);
  broadcastCalls();
  res.json({ success: true });
});

app.post("/api/reset", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Unauthorized" });
  await pool.query("DELETE FROM calls");
  broadcastCalls();
  res.json({ success: true });
});

app.post("/api/reorder", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Unauthorized" });

  const { newOrder } = req.body;
  if (!Array.isArray(newOrder))
    return res.status(400).json({ error: "Format invalide" });

  await pool.query("DELETE FROM calls");

  for (const { slot, user } of newOrder) {
    await pool.query(
      "INSERT INTO calls (slot, username) VALUES ($1, $2)",
      [slot, user]
    );
  }

  broadcastCalls();
  res.json({ success: true });
});

// ===============================
// Auth admin
// ===============================
app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.cookie("admin", "true", {
      httpOnly: true,
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production",
    });
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Bad password" });
  }
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("admin");
  res.json({ success: true });
});

// ===============================
// Logs
// ===============================
app.get("/logs", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).send("Non autorisé");

  const { rows } = await pool.query(
    "SELECT * FROM logs ORDER BY timestamp DESC LIMIT 200"
  );
  res.json(rows);
});

// ===============================
// Rainbet API (ADMIN ONLY)
// ===============================
app.get("/api/rainbet/affiliates", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Unauthorized" });

    const { start_at, end_at } = req.query;
    if (!isValidDateYYYYMMDD(start_at) || !isValidDateYYYYMMDD(end_at)) {
      return res.status(400).json({
        error: "Dates invalides (YYYY-MM-DD)",
      });
    }

    const key = process.env.RAINBET_API_KEY;
    if (!key) {
      return res.status(500).json({ error: "RAINBET_API_KEY manquant" });
    }

    const url =
      `https://services.rainbet.com/v1/external/affiliates` +
      `?start_at=${encodeURIComponent(start_at)}` +
      `&end_at=${encodeURIComponent(end_at)}` +
      `&key=${encodeURIComponent(key)}`;

    const data = await fetchJson(url);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || "Erreur Rainbet" });
  }
});
// ===============================
// Rainbet PUBLIC TOP 10 (sans cookie admin)
// ===============================
app.get("/api/rainbet/public-top", async (req, res) => {
  try {
    const { start_at, end_at } = req.query;

    if (!start_at || !end_at) {
      return res.status(400).json({ error: "Dates manquantes" });
    }

    const key = process.env.RAINBET_API_KEY;
    if (!key) {
      return res.status(500).json({ error: "RAINBET_API_KEY manquant" });
    }

    const url =
      `https://services.rainbet.com/v1/external/affiliates` +
      `?start_at=${encodeURIComponent(start_at)}` +
      `&end_at=${encodeURIComponent(end_at)}` +
      `&key=${encodeURIComponent(key)}`;

    const data = await fetchJson(url);

    const rows = Array.isArray(data.affiliates) ? data.affiliates : [];

    // 🔥 TRI + TOP 10
    const top10 = rows
      .sort((a, b) => Number(b.wagered_amount) - Number(a.wagered_amount))
      .slice(0, 10)
      .map((r, i) => ({
        rank: i + 1,
        username: r.username,
        wagered_amount: Number(r.wagered_amount)
      }));

    res.json({
      top10,
      updated_at: data.cache_updated_at || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Erreur Rainbet" });
  }
});

// ===============================
// Start server
// ===============================
app.listen(PORT, () => {
  console.log(`✅ Serveur en ligne sur http://localhost:${PORT}`);
});
