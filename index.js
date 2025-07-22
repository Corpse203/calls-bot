const express = require("express");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const MOD_PASSWORD = process.env.ADMIN_PASSWORD;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const clients = [];

app.use(compression()); // ✅ Compression activée
app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

function isAdmin(req) {
  return req.cookies.admin === "true";
}

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

// ✅ Favicon déjà servi via express.static("public") si présent dans /public

app.get("/events", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const client = { res, isAdmin: isAdmin(req) };
  clients.push(client);

  const calls = await getCalls();
  res.write(`data: ${JSON.stringify({ calls })}\n\n`);

  // ✅ Déconnexion auto après 5 minutes (non-admin uniquement)
  if (!client.isAdmin) {
    client.timeout = setTimeout(() => {
      res.end();
      clients.splice(clients.indexOf(client), 1);
    }, 5 * 60 * 1000); // 5 minutes
  }

  req.on("close", () => {
    clearTimeout(client.timeout);
    clients.splice(clients.indexOf(client), 1);
  });
});

function broadcastCalls() {
  getCalls().then((calls) => {
    const data = `data: ${JSON.stringify({ calls })}\n\n`;
    clients.forEach((c) => c.res.write(data));
  });
}

async function getCalls() {
  const { rows } = await pool.query("SELECT * FROM calls ORDER BY id ASC");
  return rows.map(r => ({ slot: r.slot, user: r.username }));
}

app.get("/api/calls", async (req, res) => {
  const calls = await getCalls();
  res.json({ calls, admin: isAdmin(req) });
});

app.post("/api/call", async (req, res) => {
  const { slot, user } = req.body;
  if (!slot || !user) return res.status(400).json({ error: "Données manquantes" });

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const timestamp = new Date();

  await pool.query("INSERT INTO calls (slot, username) VALUES ($1, $2)", [slot, user]);
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
  if (index < 0 || index >= rows.length) return res.status(400).json({ error: "Index invalide" });

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
  if (!Array.isArray(newOrder)) return res.status(400).json({ error: "Format invalide" });

  await pool.query("DELETE FROM calls");
  for (const { slot, user } of newOrder) {
    await pool.query("INSERT INTO calls (slot, username) VALUES ($1, $2)", [slot, user]);
  }

  broadcastCalls();
  res.json({ success: true });
});

app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password === MOD_PASSWORD) {
    res.cookie("admin", "true", {
      httpOnly: false,
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

app.get("/logs", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).send("Non autorisé");

  const { rows } = await pool.query("SELECT * FROM logs ORDER BY timestamp DESC LIMIT 100");
  res.json(rows);
});

app.listen(PORT, () => {
  console.log(`✅ Serveur en ligne sur http://localhost:${PORT}`);
});
