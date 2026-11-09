"use strict";
// Sugerencias, reportes y cambios de mazos desde la web.
// Cada envío se convierte en un issue de GitHub en el repositorio del juego, con etiquetas
// ("sugerencia", "reporte" o "mazo", y "carta-negra" o "carta-blanca") para revisarlo allí.
// Al poner la etiqueta "aprobada", .github/scripts/apply-cards.js aplica las sugerencias y los mazos.
// También recibe los errores del navegador de quien juega (type "error"): un issue por error distinto
// (etiqueta "error") y, si se repite, un comentario en ese mismo issue.
// En Vercel es una función (/api/feedback); server.js la sirve en la misma ruta.
// Variables de entorno: GITHUB_TOKEN (obligatoria, con permiso para crear issues en el repo)
// y FEEDBACK_REPO (opcional, "dueño/repo"; por defecto el de este juego).

const REPO = process.env.FEEDBACK_REPO || "diegoreico/cartascontraocliente";
const API = process.env.GITHUB_API_URL || "https://api.github.com";
const MAX_BODY = 65536;             // el editor de mazos puede enviar muchas cartas de una vez
const DECK_MAX = 60;               // cartas nuevas de cada color, ediciones y retiradas por envío
const MAX_PER_IP = 30;             // envíos por IP cada 10 minutos (por instancia); en una oficina todos comparten IP
const MAX_ERRORS_PER_IP = 20;      // errores por IP cada 10 minutos, aparte, para no gastar el cupo de sugerencias
const MAX_ERROR_COMMENTS = 25;     // repeticiones que se apuntan en el issue de un error; después solo se cuentan
const LANGS = { es: "español", gl: "gallego", pt: "portugués" };
const REASONS = { nonsense: "No tiene sentido", dislike: "No me gusta", translation: "Traducción rara", other: "Otro motivo" };
// Listas de cartas del juego (BLACK_T, WHITE_T, CAH_WHITE_T, DECK_M12_BLACK_T…) y la de nombres
const LIST_RE = /^(NAMES|[A-Z][A-Z0-9_]{0,40}_T)$/;
const DECK_ID_RE = /^[a-z0-9]{1,12}$/;
// Nombres de las barajas fijas; las creadas con el editor mandan su nombre desde la web.
// apply-cards.js lee el id entre comillas invertidas de la línea "Baraja" al aprobar una sugerencia.
const DECKS = { jug: "Sugerencias de jugadores", eq: "Equipo", cch: "Cartas contra la Humanidad" };
// Cartas escritas durante una partida, que el juego envía solo
const ORIGINS = { blank: "carta en blanco jugada en una partida", black: "carta negra propia creada en una partida" };

const hits = new Map();
function limited(ip, kind = "fb", max = MAX_PER_IP){
  const now = Date.now(); const key = kind + " " + ip;
  const recent = (hits.get(key) || []).filter(t => now - t < 600000);
  if (recent.length >= max) { hits.set(key, recent); return true; }
  recent.push(now); hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, n);
// Sin menciones (@usuario) ni referencias (#12) que avisarían a gente en GitHub
const quiet = s => s.replace(/@/g, "@​").replace(/#(\d)/g, "#​$1");
const quote = s => quiet(s).split("\n").map(l => "> " + l).join("\n");
const short = s => { const one = s.replace(/\s+/g, " "); return one.length > 60 ? one.slice(0, 57) + "…" : one; };
const colorName = c => (c === "black" ? "negra" : "blanca");
// Texto de una carta: una línea, huecos como ___ y sin ``` (rompería el bloque de datos del issue)
const cardText = s => clean(s, 200).replace(/\s+/g, " ").replace(/`{3,}/g, "''").replace(/_{2,}/g, "___");
const cardOk = (txt, black) => { const n = (txt.match(/___/g) || []).length; return txt.length >= 3 && (black ? n >= 1 && n <= 2 : n === 0); };
const deckName = (id, sent) => DECKS[id] || clean(sent, 40) || id;

// Error en el navegador de alguien: huella para agrupar los iguales, título, cuerpo y comentario de repetición
const ERROR_KINDS = { error: "Error de JavaScript", promesa: "Promesa rechazada sin capturar", recurso: "No se pudo cargar un recurso" };
const fence = s => String(s).replace(/`{3,}/g, "''");
function buildError(m){
  const kind = ERROR_KINDS[m.kind] ? m.kind : "error";
  const message = clean(m.message, 300).replace(/\s+/g, " ") || "(sin mensaje)";
  const source = clean(m.source, 300).replace(/[?#].*$/, "");
  const line = Number.isInteger(m.line) && m.line >= 0 ? m.line : 0, col = Number.isInteger(m.col) && m.col >= 0 ? m.col : 0;
  const stack = clean(m.stack, 3000);
  const where = source ? `${source.replace(/^https?:\/\/[^/]+/, "")}${line ? `:${line}:${col}` : ""}` : "";
  const fp = require("crypto").createHash("sha1").update([kind, message, source.replace(/^https?:\/\/[^/]+/, ""), line].join("|")).digest("hex").slice(0, 8);
  const ctx = m.ctx && typeof m.ctx === "object" && !Array.isArray(m.ctx) ? m.ctx : {};
  const ctxLines = Object.keys(ctx).slice(0, 12).map(k => `- ${clean(k, 20)}: ${quiet(clean(JSON.stringify(ctx[k]), 120))}`);
  const when = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const ua = clean(m.ua, 300); const page = clean(m.url, 200).replace(/[?#].*$/, "");
  const lang = LANGS[m.lang] ? LANGS[m.lang] : "";
  const occurrence = [`**${when}**${lang ? ` · ${lang}` : ""}`, `- Navegador: ${quiet(ua) || "?"}`, ...(page ? [`- Página: ${page}`] : []), ...ctxLines].join("\n");
  return {
    fp,
    issue: {
      title: quiet(`Error en el navegador [${fp}]: ${short(message)}`),
      body: [`**Tipo:** ${ERROR_KINDS[kind]}`, `**Mensaje:** ${quiet(message)}`, ...(where ? [`**Dónde:** \`${fence(where)}\``] : []),
        ...(stack ? ["", "**Pila:**", "", "```", fence(stack), "```"] : []),
        "", "**Primera vez:**", "", occurrence, "", "---",
        `Lo ha enviado el juego solo. Si vuelve a pasar, se apunta como comentario en este issue (huella \`${fp}\`). Ciérralo cuando esté arreglado.`].join("\n"),
      labels: ["error"],
    },
    comment: `Ha vuelto a pasar:\n\n${occurrence}`,
  };
}

// Cambios en un mazo existente o petición de un mazo nuevo (editor de mazos)
function buildDeck(m, lang, name){
  const deck = m.deck === "new" ? "new" : typeof m.deck === "string" && DECK_ID_RE.test(m.deck) ? m.deck : null;
  if (!deck) return null;
  const newName = cardText(m.name).slice(0, 40), newDesc = cardText(m.desc).slice(0, 160);
  if (deck === "new" && newName.length < 3) return null;
  const cards = (arr, black) => [...new Set((Array.isArray(arr) ? arr : []).slice(0, DECK_MAX).map(cardText))].filter(x => cardOk(x, black));
  const black = cards(m.black, true), white = cards(m.white, false);
  const ref = x => (x && typeof x === "object" && typeof x.list === "string" && LIST_RE.test(x.list) && x.list !== "NAMES" && Number.isInteger(x.i) && x.i >= 0 && x.i < 10000);
  const edit = deck === "new" ? [] : (Array.isArray(m.edit) ? m.edit : []).slice(0, DECK_MAX).filter(ref)
    .map(x => ({ list: x.list, i: x.i, from: cardText(x.from), to: cardText(x.to) })).filter(x => cardOk(x.to, x.list.includes("BLACK")));
  const remove = deck === "new" ? [] : (Array.isArray(m.remove) ? m.remove : []).slice(0, DECK_MAX).filter(ref).map(x => ({ list: x.list, i: x.i, text: cardText(x.text) }));
  if (!(black.length + white.length + edit.length + remove.length)) return null;
  const head = deck === "new"
    ? [`**Mazo nuevo:** ${quiet(newName)}`, ...(newDesc ? [`**De qué va:** ${quiet(newDesc)}`] : [])]
    : [`**Mazo:** ${quiet(deckName(deck, m.deckName))} (\`${deck}\`)`];
  const lines = [...head, `**Idioma:** ${LANGS[lang]}`, `**Enviado por:** ${quiet(name)}`];
  const section = (title, items) => { if (items.length) lines.push("", `**${title} (${items.length})**`, ...items); };
  section("Cartas negras nuevas", black.map(x => "- " + quiet(x)));
  section("Cartas blancas nuevas", white.map(x => "- " + quiet(x)));
  section("Cartas editadas", edit.map(x => `- \`${x.list}[${x.i}]\`: ~~${quiet(x.from)}~~ → ${quiet(x.to)}`));
  section("Cartas para quitar", remove.map(x => `- \`${x.list}[${x.i}]\`: ${quiet(x.text)}`));
  const data = { deck, ...(deck === "new" ? { name: newName, desc: newDesc } : {}), black, white, edit: edit.map(({ list, i, to }) => ({ list, i, to })), remove: remove.map(({ list, i }) => ({ list, i })) };
  lines.push("", "---",
    "Para aplicar los cambios, ponle la etiqueta `aprobada`. Para dejar fuera alguno, bórralo antes del bloque de datos de abajo (la lista de arriba es solo para leer). Para descartarlo todo, cierra el issue.",
    "", "<details><summary>Datos para aplicar los cambios</summary>", "", "```json", JSON.stringify(data, null, 1), "```", "", "</details>");
  const what = [black.length && `${black.length} negras`, white.length && `${white.length} blancas`, edit.length && `${edit.length} editadas`, remove.length && `${remove.length} para quitar`].filter(Boolean).join(", ");
  return {
    title: quiet(deck === "new" ? `Mazo nuevo: ${newName} (${what})` : `Cambios en el mazo ${deckName(deck, m.deckName)}: ${what}`),
    body: lines.join("\n"),
    labels: ["mazo", ...(deck === "new" ? ["nuevo-mazo"] : [])],
  };
}

function build(m){
  const lang = LANGS[m.lang] ? m.lang : "es";
  if (m.type === "deck") return buildDeck(m, lang, clean(m.author, 40) || "anónimo");
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
    const deck = typeof m.deck === "string" && DECK_ID_RE.test(m.deck) ? m.deck : "jug";
    meta.push(`**Baraja:** ${quiet(deckName(deck, m.deckName))} (\`${deck}\`)`);
    if (origin) meta.push(`**Origen:** ${ORIGINS[origin]}`);
    // Cartas de partida: mazos que se estaban usando, para poder elegir a cuál añadirla
    const inUse = (Array.isArray(m.inUse) ? m.inUse : []).slice(0, 12).filter(x => x && DECK_ID_RE.test(x.id)).map(x => `${quiet(deckName(x.id, x.name))} (\`${x.id}\`)`);
    if (inUse.length) meta.push(`**Mazos en uso en la partida:** ${inUse.join(", ")}. Para guardarla en otro, cambia el id de la línea **Baraja** antes de aprobarla.`);
    return {
      title: quiet(`Sugerencia de carta ${colorName(color)}: ${short(text)}`),
      body: [...meta, "", quote(text), "", "---", "Para añadirla al juego, ponle la etiqueta `aprobada` (puedes editar antes el texto). Para descartarla, cierra el issue."].join("\n"),
      labels: ["sugerencia", ...labels, ...(origin ? ["desde-partida"] : [])],
    };
  }
  if (m.type === "report") {
    const text = clean(m.text, 300);
    const reason = REASONS[m.reason] ? m.reason : null;
    const ref = m.ref && typeof m.ref === "object" ? m.ref : {};
    const list = typeof ref.list === "string" && LIST_RE.test(ref.list) ? ref.list : null;
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
  if (m.type === "error") return reportError(m, ip, token, res);
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
// Llamada a la API de GitHub con el token del juego
function gh(token, method, url, body){
  return fetch(`${API}${url}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "cartas-contra-el-cliente" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
// Un issue por error distinto: si ya hay uno abierto con la misma huella, se comenta en él
async function reportError(m, ip, token, res){
  if (limited(ip, "error", MAX_ERRORS_PER_IP)) return send(res, 429, { error: "rate_limited" });
  const e = buildError(m);
  try {
    const list = await gh(token, "GET", `/repos/${REPO}/issues?labels=error&state=open&per_page=100`);
    const open = list.ok ? await list.json() : [];
    const same = Array.isArray(open) && open.find(x => x && typeof x.title === "string" && x.title.includes(`[${e.fp}]`) && !x.pull_request);
    if (same) {
      if ((same.comments || 0) >= MAX_ERROR_COMMENTS) return send(res, 200, { ok: true, repeated: true });
      const r = await gh(token, "POST", `/repos/${REPO}/issues/${same.number}/comments`, { body: e.comment });
      if (!r.ok) { console.error("feedback: GitHub respondió", r.status, (await r.text()).slice(0, 300)); return send(res, 502, { error: "upstream" }); }
      return send(res, 201, { ok: true, repeated: true });
    }
    const r = await gh(token, "POST", `/repos/${REPO}/issues`, e.issue);
    if (!r.ok) { console.error("feedback: GitHub respondió", r.status, (await r.text()).slice(0, 300)); return send(res, 502, { error: "upstream" }); }
    return send(res, 201, { ok: true });
  } catch (err) {
    console.error("feedback: no se pudo informar del error", err && err.message);
    return send(res, 502, { error: "upstream" });
  }
}
module.exports.build = build;
module.exports.buildError = buildError;
