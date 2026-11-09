"use strict";
// Aplica a public/index.html un issue aprobado (etiqueta "aprobada"). Dos formatos, los que escribe api/feedback.js:
// - Sugerencia de una carta: líneas **Carta:**, **Baraja:** y el texto citado con "> ".
// - Cambios de mazo (editor de mazos): bloque ```json con { deck, name?, desc?, black, white, edit, remove }.
// Las cartas nuevas o editadas van con el mismo texto en los tres idiomas y el comentario "pendiente de traducir".
// Las retiradas se quedan como null en su sitio: los ids de las cartas son posiciones y no deben moverse.
// Lo ejecuta .github/workflows/cartas-aprobadas.yml con ISSUE_NUMBER e ISSUE_BODY en el entorno.
// Deja en $GITHUB_OUTPUT: added (true/false), message (para el issue) y commit.
const fs = require("fs");
const path = require("path");

const FILE = process.env.CARDS_FILE || path.join(__dirname, "..", "..", "public", "index.html");
const NEW_DECKS_MARK = "// Mazos nuevos creados desde el editor de mazos";
const FIXED = { jug: "Sugerencias de jugadores", eq: "Equipo", cch: "Cartas contra la Humanidad" };

// Fila de una lista: JSON, pero sin "<" (va dentro de un <script>) ni separadores de línea Unicode
const js = v => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const norm = s => String(s == null ? "" : s).replace(/\u200b/g, "").replace(/\s+/g, " ").trim().replace(/_{2,}/g, "___");
const cardOk = (txt, black) => { const n = (txt.match(/___/g) || []).length; return txt.length >= 3 && txt.length <= 200 && (black ? n >= 1 && n <= 2 : n === 0); };

// Barajas declaradas en PACKS: id -> { black, white } (nombres de las listas)
function packsOf(src){
  const at = src.indexOf("const PACKS = [\n"); const end = src.indexOf("\n];", at);
  const out = {};
  for (const m of src.slice(at, end).matchAll(/\{ id: "([a-z0-9]+)", lists: \["([A-Z0-9_]+)", "([A-Z0-9_]+)"\]/g)) out[m[1]] = { black: m[2], white: m[3] };
  return out;
}
// Partes de una lista: inicio y fin del bloque y sus líneas
function listBlock(src, name){
  const open = `const ${name} = [\n`;
  const at = src.indexOf(open);
  if (at < 0) throw new Error(`No encuentro la lista ${name}`);
  const start = at + open.length; const end = src.indexOf("\n];", at);
  const body = src.slice(start, end);
  return { start, end, lines: body ? body.split("\n") : [] };
}
const isRow = l => l.startsWith("[") || l.startsWith("null");
// Pone coma al final de una fila (antes de su comentario, si lo tiene)
const withComma = l => l.replace(/^((?:\[.*\]|null))(?!,)(\s*\/\/.*)?$/, "$1,$2");

function addCard(src, list, text, issue){
  const b = listBlock(src, list);
  if (b.lines.some(l => isRow(l) && l.includes(js(text) + ","))) return null;   // ya está en esa lista
  for (let i = b.lines.length - 1; i >= 0; i--) if (isRow(b.lines[i])) { b.lines[i] = withComma(b.lines[i]); break; }
  b.lines.push(`${js([text, text, text])} // #${issue}: pendiente de traducir`);
  return src.slice(0, b.start) + b.lines.join("\n") + src.slice(b.end);
}
// Cambia la fila i de una lista por otra (o por null para retirarla)
function setRow(src, list, i, row, note){
  const b = listBlock(src, list);
  let k = -1;
  for (let n = 0; n < b.lines.length; n++) {
    if (!isRow(b.lines[n]) || ++k !== i) continue;
    const comma = /^(?:\[.*\]|null),/.test(b.lines[n]);
    b.lines[n] = `${row}${comma ? "," : ""} // ${note}`;
    return src.slice(0, b.start) + b.lines.join("\n") + src.slice(b.end);
  }
  return null;
}
function rowAt(src, list, i){
  const rows = listBlock(src, list).lines.filter(isRow);
  return rows[i];
}
function createDeck(src, issue, name, desc){
  const id = `m${issue}`; const up = `DECK_M${issue}`;
  if (packsOf(src)[id]) throw new Error(`El mazo ${id} ya existe`);
  const lists = `// Mazo "${name.replace(/[\r\n]/g, " ")}" (#${issue})\nconst ${up}_BLACK_T = [\n];\nconst ${up}_WHITE_T = [\n];\n`;
  const mark = src.indexOf(NEW_DECKS_MARK);
  if (mark < 0) throw new Error("No encuentro el sitio para mazos nuevos");
  const afterMark = src.indexOf("\n", mark) + 1;
  src = src.slice(0, afterMark) + lists + src.slice(afterMark);
  const at = src.indexOf("const PACKS = [\n"); const end = src.indexOf("\n];", at);
  const entry = `  { id: "${id}", lists: ["${up}_BLACK_T", "${up}_WHITE_T"], black: ${up}_BLACK_T, white: ${up}_WHITE_T, name: ${js([name, name, name])}, desc: ${js([desc, desc, desc])} }, // #${issue}: pendiente de traducir`;
  return { src: src.slice(0, end) + "\n" + entry + src.slice(end), id, lists: { black: `${up}_BLACK_T`, white: `${up}_WHITE_T` } };
}

// ---- sugerencia de una carta
function parseSuggestion(body){
  const color = /\*\*Carta:\*\*\s*negra/i.test(body) ? "black" : /\*\*Carta:\*\*\s*blanca/i.test(body) ? "white" : null;
  const dm = body.match(/\*\*Baraja:\*\*[^\n`]*`(\w+)`/);
  const deck = dm ? dm[1] : "jug";
  const lines = body.split(/\r?\n/);
  const s = lines.findIndex(l => l.startsWith(">"));
  const quoted = [];
  if (s >= 0) for (let k = s; k < lines.length && lines[k].startsWith(">"); k++) quoted.push(lines[k].replace(/^>\s?/, ""));
  return { color, deck, text: norm(quoted.join(" ")) };
}
function applySuggestion(src, body, issue){
  const { color, deck, text } = parseSuggestion(body);
  const pk = packsOf(src)[deck];
  let problem = "";
  if (!color) problem = "no encuentro si es una carta negra o blanca (línea **Carta:**)";
  else if (!pk) problem = `no existe el mazo \`${deck}\` (línea **Baraja:**)`;
  else if (text.length < 3 || text.length > 200) problem = "el texto de la carta (las líneas que empiezan por >) está vacío o es demasiado largo";
  else if (!cardOk(text, color === "black")) problem = color === "black" ? "una carta negra necesita uno o dos huecos ___" : "una carta blanca no puede llevar huecos ___";
  if (problem) return { src: null, message: `No he podido añadir la carta: ${problem}. Corrige el issue, quita la etiqueta \`aprobada\` y vuelve a ponerla.` };
  const next = addCard(src, color === "black" ? pk.black : pk.white, text, issue);
  if (!next) return { src: null, message: "Esta carta ya estaba en ese mazo; no la he vuelto a añadir." };
  return { src: next, message: `Añadida al mazo \`${deck}\` como carta ${color === "black" ? "negra" : "blanca"}. Saldrá en el juego cuando Vercel publique el cambio. Va con el mismo texto en los tres idiomas: queda pendiente de traducir.`, commit: `Carta aprobada en el mazo ${deck} (#${issue})` };
}

// ---- cambios de mazo
function applyDeck(src, data, issue){
  const notes = []; const done = { black: 0, white: 0, edit: 0, remove: 0 };
  let deck = data.deck; let lists;
  if (deck === "new") {
    const name = norm(data.name).slice(0, 40); const desc = norm(data.desc).slice(0, 160);
    if (name.length < 3) return { src: null, message: "No he podido crear el mazo: le falta el nombre (`name` en el bloque de datos)." };
    const r = createDeck(src, issue, name, desc); src = r.src; deck = r.id; lists = r.lists;
    notes.push(`Mazo nuevo \`${deck}\` creado: "${name}".`);
  } else {
    lists = packsOf(src)[deck];
    if (!lists) return { src: null, message: `No existe el mazo \`${deck}\`. Corrige \`deck\` en el bloque de datos y vuelve a poner la etiqueta.` };
  }
  for (const color of ["black", "white"]) {
    for (const raw of Array.isArray(data[color]) ? data[color] : []) {
      const text = norm(raw);
      if (!cardOk(text, color === "black")) { notes.push(`No añadida (no vale como carta ${color === "black" ? "negra" : "blanca"}): "${text}"`); continue; }
      const next = addCard(src, lists[color], text, issue);
      if (next) { src = next; done[color]++; } else notes.push(`Ya estaba: "${text}"`);
    }
  }
  const mine = new Set([lists.black, lists.white]);
  for (const e of Array.isArray(data.edit) ? data.edit : []) {
    const text = norm(e && e.to);
    if (!e || !mine.has(e.list) || !Number.isInteger(e.i)) { notes.push(`Edición ignorada: \`${e && e.list}[${e && e.i}]\` no es de este mazo.`); continue; }
    if (!cardOk(text, e.list === lists.black)) { notes.push(`Edición ignorada en \`${e.list}[${e.i}]\`: el texto no vale para esa carta.`); continue; }
    if (rowAt(src, e.list, e.i) === undefined || /^null/.test(rowAt(src, e.list, e.i))) { notes.push(`Edición ignorada: \`${e.list}[${e.i}]\` no existe o está retirada.`); continue; }
    src = setRow(src, e.list, e.i, js([text, text, text]), `#${issue}: editada, pendiente de traducir`); done.edit++;
  }
  for (const r of Array.isArray(data.remove) ? data.remove : []) {
    if (!r || !mine.has(r.list) || !Number.isInteger(r.i) || rowAt(src, r.list, r.i) === undefined) { notes.push(`Retirada ignorada: \`${r && r.list}[${r && r.i}]\` no es de este mazo.`); continue; }
    src = setRow(src, r.list, r.i, "null", `#${issue}: retirada`); done.remove++;
  }
  const total = done.black + done.white + done.edit + done.remove;
  const summary = `${done.black} negras y ${done.white} blancas nuevas, ${done.edit} editadas y ${done.remove} retiradas`;
  if (!total && data.deck !== "new") return { src: null, message: ["No he aplicado ningún cambio.", ...notes].join("\n- ") };
  return {
    src,
    message: [`Aplicado en el mazo \`${deck}\`: ${summary}. Saldrá en el juego cuando Vercel publique el cambio. Las cartas nuevas y editadas quedan pendientes de traducir.`, ...notes].join("\n- "),
    commit: data.deck === "new" ? `Mazo nuevo ${deck} (#${issue})` : `Cambios en el mazo ${deck} (#${issue})`,
  };
}

function main(){
  const issue = String(process.env.ISSUE_NUMBER || "?").replace(/\D/g, "") || "0";
  const body = String(process.env.ISSUE_BODY || "");
  const out = (k, v) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}<<__FIN__\n${v}\n__FIN__\n`); else console.log(`${k}: ${v}`); };
  const src = fs.readFileSync(FILE, "utf8");
  let r;
  const m = body.match(/```json\s*\n([\s\S]*?)\n```/);
  if (m) {
    let data;
    try { data = JSON.parse(m[1]); } catch (e) { r = { src: null, message: `El bloque de datos no es JSON válido (${e.message}). Corrígelo y vuelve a poner la etiqueta.` }; }
    if (data) r = applyDeck(src, data, issue);
  } else r = applySuggestion(src, body, issue);
  if (r.src) fs.writeFileSync(FILE, r.src);
  out("added", r.src ? "true" : "false");
  out("message", r.message);
  if (r.commit) out("commit", r.commit);
}

if (require.main === module) main();
module.exports = { parseSuggestion, addCard, setRow, createDeck, packsOf, applyDeck, applySuggestion };
