// Rebuilds public/algoritmo.html from docs/ALGORITHMS.md, encrypting the
// content with a password so the page is a password gate (client-side
// AES-256-GCM + PBKDF2-SHA256). The password is read from ALGO_PW and never
// written anywhere — only salt/iv/ciphertext land in the HTML.
//
// Usage:  ALGO_PW='your-password' node scripts/encrypt-algoritmo.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { pbkdf2Sync, randomBytes, createCipheriv } from "node:crypto";

const ITER = 600000; // PBKDF2 iterations (raised from 250k)
const PW = process.env.ALGO_PW;
if (!PW) {
  console.error("Set ALGO_PW to the password, e.g. ALGO_PW='...' node scripts/encrypt-algoritmo.mjs");
  process.exit(1);
}

// --- minimal, safe markdown → HTML (trusted input, but we escape text) ------
const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

function mdToHtml(md) {
  const lines = md.split("\n");
  const out = [];
  let i = 0;
  const flushPara = (buf) => {
    if (buf.length) out.push("<p>" + inline(buf.join(" ")) + "</p>");
    buf.length = 0;
  };
  const para = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      flushPara(para);
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++; // closing fence
      out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>");
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      flushPara(para);
      const lvl = line.match(/^#+/)[0].length;
      out.push(`<h${lvl}>` + inline(line.replace(/^#+\s/, "")) + `</h${lvl}>`);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      flushPara(para);
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara(para);
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]))
        items.push("<li>" + inline(lines[i++].replace(/^\s*[-*]\s+/, "")) + "</li>");
      out.push("<ul>" + items.join("") + "</ul>");
      continue;
    }
    if (line.includes("|") && lines[i + 1] && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      flushPara(para);
      const row = (l) =>
        l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = row(line);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].includes("|")) body.push(row(lines[i++]));
      out.push(
        "<table><thead><tr>" +
          head.map((c) => "<th>" + inline(c) + "</th>").join("") +
          "</tr></thead><tbody>" +
          body
            .map((r) => "<tr>" + r.map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>")
            .join("") +
          "</tbody></table>",
      );
      continue;
    }
    if (line.trim() === "") {
      flushPara(para);
      i++;
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara(para);
  return out.join("\n");
}

const md = readFileSync("../docs/ALGORITHMS.md", "utf8");
const bodyHtml = mdToHtml(md);

// --- encrypt (AES-256-GCM; ciphertext||tag to match Web Crypto) -------------
const salt = randomBytes(16);
const iv = randomBytes(12);
const key = pbkdf2Sync(Buffer.from(PW, "utf8"), salt, ITER, 32, "sha256");
const cipher = createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([cipher.update(Buffer.from(bodyHtml, "utf8")), cipher.final(), cipher.getAuthTag()]);
const ENC = {
  salt: salt.toString("base64"),
  iv: iv.toString("base64"),
  ct: ct.toString("base64"),
  iter: ITER,
};

// --- reuse the existing gate markup, swap the ENC blob ----------------------
let html = readFileSync("public/algoritmo.html", "utf8");
html = html.replace(/var ENC = \{[\s\S]*?\};/, "var ENC = " + JSON.stringify(ENC) + ";");
writeFileSync("public/algoritmo.html", html);
console.log(`algoritmo.html re-encrypted: iter=${ITER}, ct=${ct.length}B`);
