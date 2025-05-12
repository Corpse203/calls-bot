const express = require("express");
const cookieParser = require("cookie-parser");
const app = express();
const PORT = process.env.PORT || 3000;

const MOD_PASSWORD = "supermod123"; // change si besoin
let calls = [];
let clients = [];

app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

function isAdmin(req) {
  return req.cookies.admin === "true";
}

// SSE - EventSource
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const client = { res };
  clients.push(client);
  res.write(`data: ${JSON.stringify({ calls, admin: isAdmin(req) })}\n\n`);

  req.on("close", () => {
    clients = clients.filter(c => c !== client);
  });
});

function broadcastCalls() {
  const payload = `data: ${JSON.stringify({ calls })}\n\n`;
  clients.forEach(client => client.res.write(payload));
}

// API routes
app.get("/api/calls", (req, res) => {
  res.json({ calls, admin: isAdmin(req) });
});

app.post("/api/call", (req, res) => {
  const { slot, user } = req.body;
  if (!slot || !user) return res.status(400).json({ error: "Données manquantes" });
  calls.push({ slot, user });
  broadcastCalls();
  res.json({ success: true });
});

app.post("/api/delete", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Unauthorized" });
  const { index } = req.body;
  calls.splice(index, 1);
  broadcastCalls();
  res.json({ success: true });
});

app.post("/api/reset", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Unauthorized" });
  calls = [];
  broadcastCalls();
  res.json({ success: true });
});

app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password === MOD_PASSWORD) {
    res.cookie("admin", "true");
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Bad password" });
  }
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("admin");
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`✅ Serveur en ligne sur http://localhost:${PORT}`);
});
