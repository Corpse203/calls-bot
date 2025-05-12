const express = require("express");
const WebSocket = require("ws");
const cookieParser = require("cookie-parser");
const app = express();
const PORT = process.env.PORT || 3000;

const STREAMER_USERNAME = "TonNomDLive"; // <-- change ici
const MOD_PASSWORD = "supermod123"; // <-- change ici

let calls = [];

app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

function isAdmin(req) {
  return req.cookies.admin === "true";
}

app.get("/api/calls", (req, res) => {
  res.json({ calls, admin: isAdmin(req) });
});

app.post("/api/delete", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Unauthorized" });
  const { index } = req.body;
  calls.splice(index, 1);
  res.json({ success: true });
});

app.post("/api/reset", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Unauthorized" });
  calls = [];
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

// const ws = new WebSocket(...);
// ws.on("open", ...) {...}
// ws.on("message", ...) {...}

app.listen(PORT, () => {
  console.log(`🚀 Serveur en ligne sur http://localhost:${PORT}`);
});

// API : ajout d'un call public
app.post("/api/call", (req, res) => {
  const { slot, user } = req.body;
  if (!slot || !user) return res.status(400).json({ error: "Données manquantes" });
  calls.push({ slot, user });
  res.json({ success: true });
});