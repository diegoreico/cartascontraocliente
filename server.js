"use strict";
// Servidor de Cartas contra el Cliente.
// Sirve public/index.html y hace de "sala" en tiempo real por WebSocket (/ws):
// cada conexión entra en salas por nombre y comparte un objeto de presencia (máx. 4 KiB)
// que el servidor reenvía al resto de la sala. Toda la lógica del juego vive en el navegador.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 8080;
const MAX_PRESENCE_BYTES = 4096;     // por persona y sala
const MAX_PEERS_PER_ROOM = 256;
const MAX_ROOMS_PER_PEER = 16;
const ROOM_RE = /^(__lobby|[a-z0-9][a-z0-9_.-]{0,47})$/;
const INDEX_PATH = path.join(__dirname, "public", "index.html");
const INDEX = fs.readFileSync(INDEX_PATH);

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  if (url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("ok");
    return;
  }
  if (req.method === "GET" && (url === "/" || url === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", "x-content-type-options": "nosniff" });
    res.end(INDEX);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("No encontrado");
});

/** rooms: nombre -> Map(peer -> cliente) */
const rooms = new Map();
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const view = (c, room) => ({ peer: c.peer, by: c.by, presence: c.presence.get(room) || {} });
function broadcast(room, msg, except) {
  const members = rooms.get(room);
  if (!members) return;
  const data = JSON.stringify(msg);
  for (const c of members.values()) if (c !== except && c.ws.readyState === 1) c.ws.send(data);
}
function leave(c, room) {
  c.presence.delete(room);
  const members = rooms.get(room);
  if (!members || members.get(c.peer) !== c) return;
  members.delete(c.peer);
  if (!members.size) rooms.delete(room);
  broadcast(room, { t: "left", room, peer: c.peer });
}

wss.on("connection", ws => {
  let c = null;
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== "object") return;

    if (m.t === "hello") {
      if (c) return;
      const peer = typeof m.peer === "string" && /^[a-z0-9]{8,32}$/.test(m.peer) ? m.peer : crypto.randomBytes(8).toString("hex");
      const by = typeof m.by === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(m.by) ? m.by : null;
      c = { ws, peer, by, presence: new Map() };
      send(ws, { t: "welcome", peer });
      return;
    }
    if (!c) return;
    const room = m.room;
    if (typeof room !== "string" || !ROOM_RE.test(room)) { send(ws, { t: "error", id: m.id, code: "invalid_argument" }); return; }

    if (m.t === "join") {
      let members = rooms.get(room);
      if (!members) { members = new Map(); rooms.set(room, members); }
      const already = members.get(c.peer) === c;
      if (!already && (members.size >= MAX_PEERS_PER_ROOM || c.presence.size >= MAX_ROOMS_PER_PEER)) {
        if (!members.size) rooms.delete(room);
        send(ws, { t: "error", id: m.id, code: "limit_reached" });
        return;
      }
      let pres = m.presence && typeof m.presence === "object" && !Array.isArray(m.presence) ? m.presence : {};
      if (Buffer.byteLength(JSON.stringify(pres)) > MAX_PRESENCE_BYTES) pres = {};
      members.set(c.peer, c);   // una reconexión con el mismo peer sustituye a la anterior
      c.presence.set(room, pres);
      send(ws, { t: "joined", id: m.id, room, peers: [...members.values()].map(x => view(x, room)) });
      broadcast(room, { t: "peer", room, peer: view(c, room) }, c);
    } else if (m.t === "presence") {
      const members = rooms.get(room);
      if (!members || members.get(c.peer) !== c) return;
      const patch = m.patch && typeof m.patch === "object" && !Array.isArray(m.patch) ? m.patch : {};
      const next = Object.assign({}, c.presence.get(room) || {});
      for (const k of Object.keys(patch)) { if (patch[k] === null) delete next[k]; else next[k] = patch[k]; }
      if (Buffer.byteLength(JSON.stringify(next)) > MAX_PRESENCE_BYTES) {
        send(ws, { t: "error", id: m.id, code: "invalid_argument", message: "La presencia supera 4 KiB" });
        return;
      }
      c.presence.set(room, next);
      broadcast(room, { t: "peer", room, peer: view(c, room) }, c);
    } else if (m.t === "leave") {
      leave(c, room);
    }
  });
  ws.on("close", () => { if (c) for (const room of [...c.presence.keys()]) leave(c, room); });
  ws.on("error", () => {});
});

// Cierra conexiones muertas (móviles que se duermen, proxies que cortan)
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 25000);
wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, () => console.log(`Cartas contra el Cliente escuchando en http://0.0.0.0:${PORT}`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { wss.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
