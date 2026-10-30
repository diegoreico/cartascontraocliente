"use strict";
// Sugerencias y reportes de cartas desde la web.
// Cada envío se convierte en un issue de GitHub en el repositorio del juego, con etiquetas
// ("sugerencia" o "reporte", y "carta-negra" o "carta-blanca") para revisarlo allí.
// En Vercel es una función (/api/feedback); server.js la sirve en la misma ruta.
// Variables de entorno: GITHUB_TOKEN (obligatoria, con permiso para crear issues en el repo)
// y FEEDBACK_REPO (opcional, "dueño/repo"; por defecto el de este juego).

const REPO = process.env.FEEDBACK_REPO || "diegoreico/cartascontraocliente";
const API = process.env.GITHUB_API_URL || "https://api.github.com";
const MAX_BODY = 8192;
const MAX_PER_IP = 30;             // envíos por IP cada 10 minutos (por instancia); en una oficina todos comparten IP
const LANGS = { es: "español", gl: "gallego", pt: "portugués" };
const REASONS = { nonsense: "No tiene sentido", dislike: "No me gusta", translation: "Traducción rara", other: "Otro motivo" };
const LISTS = ["BLACK_T", "WHITE_T", "NAMES"];
// Cartas escritas durante una partida, que el juego envía solo
const ORIGINS = { blank: "carta en blanco jugada en una partida", black: "carta negra propia creada en una partida" };

const hits = new Map();
function limited(ip){
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 600000);
  if (recent.length >= MAX_PER_IP) { hits.set(ip, recent); return true; }
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, n);
// Sin menciones (@usuario) ni referencias (#12) que avisarían a gente en GitHub
const quiet = s => s.replace(/@/g, "@​").replace(/#(\d)/g, "#​$1");
const quote = s => quiet(s).split("\n").map(l => "> " + l).join("\n");
const short = s => { const one = s.replace(/\s+/g, " "); return one.length > 60 ? one.slice(0, 57) + "…" : one; };
const colorName = c => (c === "black" ? "negra" : "blanca");

function build(m){
  const lang = LANGS[m.lang] ? m.lang : "es";
  const name = clean(m.name, 40) || "anónimo";
  const color = m.color === "black" ? "black" : m.color === "white" ? "white" : null;
  if (!color) return null;
  const labels = [color === "black" ? "carta-negra" : "carta-blanca"];
  const meta = [`**Carta:** ${colorName(color)}`, `**Idioma:** ${LANGS[lang]}`, `**Enviada por:** ${quiet(name)}`];

  if (m.type === "suggest") {
    let text = clean(m.text, 200).replace(/_{2,}/g, "___");
    const blanks = (text.match(/___/g) || []).length;
    if (text.length < 3) return null;
    if (color === "black" ? blanks < 1 || blanks > 2 : blanks > 0) return null;
    const origin = ORIGINS[m.origin] ? m.origin : null;
    if (origin) meta.push(`**Origen:** ${ORIGINS[origin]}`);
    return {
      title: quiet(`Sugerencia de carta ${colorName(color)}: ${short(text)}`),
      body: [...meta, "", quote(text), "", "---", "Para aprobarla, ponle la etiqueta `aprobada`."].join("\n"),
      labels: ["sugerencia", ...labels, ...(origin ? ["desde-partida"] : [])],
    };
  }
  if (m.type === "report") {
    const text = clean(m.text, 300);
    const reason = REASONS[m.reason] ? m.reason : null;
    const ref = m.ref && typeof m.ref === "object" ? m.ref : {};
    const list = LISTS.includes(ref.list) ? ref.list : null;
    const i = Number.isInteger(ref.i) && ref.i >= 0 && ref.i < 10000 ? ref.i : null;
    const comment = clean(m.comment, 500);
    if (!text || !reason) return null;
    const lines = [...meta, `**Motivo:** ${REASONS[reason]}`];
    if (list && i != null) lines.push(`**Referencia:** \`${list}[${i}]\``);
    lines.push("", quote(text));
    if (comment) lines.push("", "**Comentario:**", "", quote(comment));
    return {
      title: quiet(`Reporte (${REASONS[reason].toLowerCase()}): ${short(text)}`),
      body: lines.join("\n"),
      labels: ["reporte", ...labels],
    };
  }
  return null;
}

async function readBody(req){
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string" || Buffer.isBuffer(req.body)) return JSON.parse(String(req.body));
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > MAX_BODY) throw new Error("too_large"); }
  return JSON.parse(raw || "{}");
}
function send(res, code, obj){
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(obj));
}

module.exports = async function feedback(req, res){
  if (req.method !== "POST") { res.setHeader("allow", "POST"); return send(res, 405, { error: "method_not_allowed" }); }
  const token = process.env.GITHUB_TOKEN;
  if (!token) return send(res, 503, { error: "not_configured" });
  let m;
  try { m = await readBody(req); } catch (e) { return send(res, 400, { error: "bad_request" }); }
  if (!m || typeof m !== "object" || Array.isArray(m)) return send(res, 400, { error: "bad_request" });
  if (m.hp) return send(res, 200, { ok: true });   // campo trampa: lo rellenan los bots, no las personas
  const ip = String(req.headers["x-forwarded-for"] || (req.socket && req.socket.remoteAddress) || "").split(",")[0].trim();
  if (limited(ip)) return send(res, 429, { error: "rate_limited" });
  const issue = build(m);
  if (!issue) return send(res, 400, { error: "invalid" });
  try {
    const r = await fetch(`${API}/repos/${REPO}/issues`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "cartas-contra-el-cliente" },
      body: JSON.stringify(issue),
    });
    if (!r.ok) { console.error("feedback: GitHub respondió", r.status, (await r.text()).slice(0, 300)); return send(res, 502, { error: "upstream" }); }
    return send(res, 201, { ok: true });
  } catch (e) {
    console.error("feedback: no se pudo crear el issue", e && e.message);
    return send(res, 502, { error: "upstream" });
  }
};
module.exports.build = build;
