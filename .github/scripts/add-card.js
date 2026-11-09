"use strict";
// Añade a public/index.html la carta de un issue de sugerencia aprobado (etiqueta "aprobada").
// Lo ejecuta .github/workflows/cartas-aprobadas.yml con ISSUE_NUMBER e ISSUE_BODY en el entorno.
// La carta va al final de la lista de su baraja con el mismo texto en los tres idiomas y un comentario
// "pendiente de traducir". Deja en $GITHUB_OUTPUT: added (true/false), message (para el issue) y commit.
const fs = require("fs");
const path = require("path");

const FILE = process.env.CARDS_FILE || path.join(__dirname, "..", "..", "public", "index.html");
const DECKS = {
  jug: { name: "Sugerencias de jugadores", lists: ["PLAYER_BLACK_T", "PLAYER_WHITE_T"] },
  eq: { name: "Equipo", lists: ["BLACK_T", "WHITE_T"] },
  cch: { name: "Cartas contra la Humanidad", lists: ["CAH_BLACK_T", "CAH_WHITE_T"] },
};

// Lee tipo, baraja y texto del cuerpo que escribe api/feedback.js (el texto va citado con "> ")
function parse(body){
  const color = /\*\*Carta:\*\*\s*negra/i.test(body) ? "black" : /\*\*Carta:\*\*\s*blanca/i.test(body) ? "white" : null;
  const dm = body.match(/\*\*Baraja:\*\*[^\n`]*`(\w+)`/);
  const deck = dm && DECKS[dm[1]] ? dm[1] : "jug";
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(l => l.startsWith(">"));
  if (start < 0) return { color, deck, text: "" };
  const quoted = [];
  for (let k = start; k < lines.length && lines[k].startsWith(">"); k++) quoted.push(lines[k].replace(/^>\s?/, ""));
  const text = quoted.join(" ").replace(/​/g, "").replace(/\s+/g, " ").trim().replace(/_{2,}/g, "___");
  return { color, deck, text };
}

function addCard(src, listName, text, issue){
  const open = `const ${listName} = [\n`;
  const at = src.indexOf(open);
  if (at < 0) throw new Error(`No encuentro la lista ${listName}`);
  const close = src.indexOf("\n];", at);
  const block = src.slice(at + open.length, close);
  const row = JSON.stringify([text, text, text]);
  if (block.includes(JSON.stringify(text) + ",")) return null;   // ya está en esa baraja
  const lines = block ? block.split("\n") : [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("[")) continue;
    lines[i] = lines[i].replace(/^(\[.*\])(?!,)(\s*\/\/.*)?$/, "$1,$2");   // coma tras la que era la última
    break;
  }
  lines.push(`${row} // #${issue}: pendiente de traducir`);
  return src.slice(0, at + open.length) + lines.join("\n") + src.slice(close);
}

function main(){
  const issue = String(process.env.ISSUE_NUMBER || "?");
  const out = (k, v) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}<<__FIN__\n${v}\n__FIN__\n`); else console.log(`${k}: ${v}`); };
  const { color, deck, text } = parse(String(process.env.ISSUE_BODY || ""));
  const blanks = (text.match(/___/g) || []).length;
  let problem = "";
  if (!color) problem = "no encuentro si es una carta negra o blanca (línea **Carta:**)";
  else if (text.length < 3 || text.length > 200) problem = "el texto de la carta (las líneas que empiezan por >) está vacío o es demasiado largo";
  else if (color === "black" && (blanks < 1 || blanks > 2)) problem = "una carta negra necesita uno o dos huecos ___";
  else if (color === "white" && blanks) problem = "una carta blanca no puede llevar huecos ___";
  if (problem) { out("added", "false"); out("message", `No he podido añadir la carta: ${problem}. Corrige el issue, quita la etiqueta \`aprobada\` y vuelve a ponerla.`); return; }
  const { name, lists } = DECKS[deck];
  const src = fs.readFileSync(FILE, "utf8");
  const next = addCard(src, lists[color === "black" ? 0 : 1], text, issue);
  if (!next) { out("added", "false"); out("message", `Esta carta ya estaba en la baraja **${name}**; no la he vuelto a añadir.`); return; }
  fs.writeFileSync(FILE, next);
  out("added", "true");
  out("message", `Añadida a la baraja **${name}** como carta ${color === "black" ? "negra" : "blanca"}. Saldrá en el juego cuando Vercel publique el cambio. Va con el mismo texto en los tres idiomas: queda pendiente de traducir.`);
  out("commit", `Carta aprobada en ${name} (#${issue})`);
}

if (require.main === module) main();
module.exports = { parse, addCard };
