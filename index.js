const express = require("express");
const cookieParser = require("cookie-parser");
const { Pool } = require("pg");
const app = express();
const PORT = process.env.PORT || 3000;

const MOD_PASSWORD = "supermod123"; // 💡 à passer en variable d’environnement en production

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const clients = [];

app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

function isAdmin(req) {
  return req.cookies.admin === "true";
}

// ✅ Crée la table si elle n'existe pas
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calls (
      id SERIAL PRIMARY KEY,
      slot TEXT NOT NULL,
      username TEXT NOT NULL
    );
  `);
})();

// 🔁 Diffusion SSE (sans admin)
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

// ⏩ Broadcast actualisé
function broadcastCalls() {
  getCalls().then((calls) => {
    const data = `data: ${JSON.stringify({ calls })}\n\n`;
    clients.forEach((c) => c.res.write(data));
  });
}

// 📥 Lecture des appels depuis PostgreSQL
async function getCalls() {
  const { rows } = await pool.query("SELECT * FROM calls ORDER BY id ASC");
  return rows.map(r => ({ slot: r.slot, user: r.username }));
}

// 📡 API — Récupération des appels avec état admin
app.get("/api/calls", async (req, res) => {
  const calls = await getCalls();
  res.json({ calls, admin: isAdmin(req) });
});

// ➕ Ajouter un appel
app.post("/api/call", async (req, res) => {
  const { slot, user } = req.body;
  if (!slot || !user) return res.status(400).json({ error: "Données manquantes" });
  await pool.query("INSERT INTO calls (slot, username) VALUES ($1, $2)", [slot, user]);
  broadcastCalls();
  res.json({ success: true });
});

// 🗑️ Supprimer un appel
app.post("/api/delete", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Unauthorized" });

  const { index } = req.body;
  const { rows } = await pool.query("SELECT id FROM calls ORDER BY id ASC");

  if (index < 0 || index >= rows.length) return res.status(400).json({ error: "Index invalide" });

  await pool.query("DELETE FROM calls WHERE id = $1", [rows[index].id]);
  broadcastCalls();
  res.json({ success: true });
});

// ♻️ Réinitialiser la liste
app.post("/api/reset", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Unauthorized" });

  await pool.query("DELETE FROM calls");
  broadcastCalls();
  res.json({ success: true });
});

// 🔐 Connexion admin
app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password === MOD_PASSWORD) {
    res.cookie("admin", "true", {
      httpOnly: false, // ⚠️ rendu accessible au JS frontend
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production",
    });
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Bad password" });
  }
});

// 🔓 Déconnexion admin
app.post("/api/logout", (req, res) => {
  res.clearCookie("admin");
  res.json({ success: true });
});

// 🚀 Démarrage serveur
app.listen(PORT, () => {
  console.log(`✅ Serveur en ligne sur http://localhost:${PORT}`);
});
