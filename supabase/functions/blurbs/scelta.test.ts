// Prova la scelta della descrizione contro payload veri di Google Books,
// catturati in `campioni.json` da otto libri del catalogo — otto casi che
// avevano dato problemi davvero, non otto casi inventati.
//
//   node --experimental-strip-types supabase/functions/blurbs/scelta.test.ts
//
// Nessuna rete: i campioni sono su disco, quindi la prova è ripetibile e non
// consuma quota.

// Nota su «La vegetariana», che si aspetta `null`: l'ISBN in catalogo è di
// un'edizione catalana con la descrizione vuota, e la ricerca per titolo
// restituisce solo libri che non c'entrano. La prima versione ne aveva
// accettata la scheda spagnola. Non trovarla è la risposta giusta.

import { readFileSync } from "node:fs";
import { scegli, lingua, stessoTitolo, type Libro, type Volume } from "./scelta.ts";

type Campione = { libro: Libro; atteso: "it" | "en" | null; isbn: Volume[]; titolo: Volume[] };

const campioni: Campione[] = JSON.parse(
  readFileSync(new URL("./campioni.json", import.meta.url), "utf8"),
);

let falliti = 0;
function verifica(nome: string, ok: boolean, dettaglio = "") {
  if (!ok) falliti++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${nome}${dettaglio ? "  — " + dettaglio : ""}`);
}

// --- la pipeline completa, come la usa la funzione ------------------------
for (const c of campioni) {
  const viaIsbn = c.libro.isbn_13 ? scegli(c.isbn, c.libro, false) : null;
  const esito = viaIsbn ?? scegli(c.titolo, c.libro, true);
  const trovato = esito ? esito.lingua : null;
  verifica(
    c.libro.title.slice(0, 34).padEnd(34),
    trovato === c.atteso,
    `atteso ${c.atteso ?? "niente"}, ottenuto ${trovato ?? "niente"}` +
      (esito ? ` «${esito.testo.slice(0, 46)}…»` : ""),
  );
}

// --- i singoli difetti che hanno prodotto queste regole -------------------
verifica(
  "spagnolo non passa per italiano       ",
  lingua(
    "Una novela que se lee con la avidez de un relato de intriga, pero que " +
      "plantea las preguntas más hondas sobre la identidad y sus límites, " +
      "desde el humor y la ironía del maestro portugués.",
  ) !== "it",
);
verifica(
  "danese non passa per italiano         ",
  lingua(
    "Roman fra Sicilien om en politimands arbejde med at opklare et mord, " +
      "som blev begået i en lille by, hvor ingen har set noget, og hvor " +
      "mafiaen har magten sammen med de lokale myndigheder.",
  ) === null,
);
verifica(
  "edizione in altra lingua scartata     ",
  !stessoTitolo("The Double", "L'uomo duplicato"),
);
verifica(
  "sottotitolo non fa scartare           ",
  stessoTitolo("Il giorno della civetta. Guida alla lettura", "Il giorno della civetta"),
);
verifica(
  "articolo iniziale ignorato            ",
  stessoTitolo("Notti bianche", "Le notti bianche"),
);

console.log(falliti === 0 ? "\ntutto a posto" : `\n${falliti} controlli falliti`);
process.exit(falliti === 0 ? 0 : 1);
