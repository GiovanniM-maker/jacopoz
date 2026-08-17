// =====================================================================
// Scelta della descrizione: la parte che decide, senza rete e senza Deno.
//
// Sta in un file a parte perché è la parte che sbaglia. Google restituisce
// cinque volumi e fra quelli ci sono l'edizione giusta, la traduzione in una
// lingua che non leggiamo, il riassunto non autorizzato di un altro editore e
// la tesi di laurea che cita il libro nel titolo. Separata, si può provare
// contro payload veri (`scelta.test.ts`) invece che a occhio in produzione.
// =====================================================================

/** Sotto questa soglia non è una descrizione, è una riga di catalogo. */
export const MIN_LEN = 100;

export interface Libro {
  id: string;
  title: string;
  authors: string[] | null;
  isbn_13: string | null;
  language: string | null;
}

export type Volume = {
  volumeInfo?: { title?: string; description?: string; language?: string };
};

/** Minuscole, senza accenti, senza articolo iniziale, senza punteggiatura. */
export function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(the|a|an|il|lo|la|i|gli|le|l)[\s']+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Scarti che la verifica del titolo da sola non prende.
 *
 * Cercando "Thinking, Fast and Slow" Google restituisce per primo
 * «Thinking, Fast and Slow ...in 30 minutes», che è il riassunto non
 * autorizzato di un altro editore: il titolo combacia, il contenuto no.
 * Stessa storia per le ristampe print-on-demand dei classici, la cui
 * "descrizione" parla della qualità della scansione, e per i saggi accademici
 * che hanno il titolo del libro dentro il proprio.
 */
const SPAZZATURA = [
  /\bin 30 minutes\b/i,
  /\b(summary|analysis|study guide|sparknotes|cliffsnotes|workbook)\b.{0,40}\bof\b/i,
  /^\s*(summary|riassunto|analisi)\b/i,
  /\brare manuscript\b/i,
  /\b(reproduction|facsimile|scanned) of (the|a|an) original\b/i,
  /\bthis book may have occasional imperfections\b/i,
  /\bprint[- ]on[- ]demand\b/i,
  /\bseminar paper from the year\b/i,
  /\b(bachelor|master)'?s? thesis\b/i,
  /\bthis bibliography lists\b/i,
];

/**
 * `volumeInfo.language` mente: la scheda ISBN di «Il giorno della civetta»
 * dichiara `it` e contiene una descrizione in danese. La lingua si controlla
 * sul testo, non su quanto dichiarato.
 *
 * Italiano e spagnolo condividono troppe parole corte perché basti contare
 * "con", "una", "per": la prima versione ha accettato come italiana la scheda
 * spagnola di «La vegetariana». Servono parole che l'altra lingua non ha.
 */
const MARCATORI: Record<string, RegExp> = {
  it: /\b(che|degli|della|nella|dalla|sulla|nel|dei|delle|essere|questo|questa|anche|perché|più|sono|viene|suoi|dove|quando)\b/gi,
  en: /\b(the|and|of|with|that|this|from|his|her|when|which|into|about|through|between)\b/gi,
  es: /\b(los|las|del|por|para|como|pero|sus|este|esta|más|una vez|así|desde|hacia|muy)\b/gi,
  pt: /\b(dos|das|não|são|uma|pelo|pela|mais|seus|onde|quando|também|através)\b/gi,
  fr: /\b(les|des|dans|pour|avec|cette|leur|ses|plus|mais|entre|chez|ainsi)\b/gi,
  de: /\b(und|der|die|das|den|dem|ein|eine|nicht|sich|auch|über|zwischen|wird)\b/gi,
  da: /\b(af|som|med|til|har|blev|hans|hendes|efter|mellem|sammen)\b/gi,
};

/** La lingua del testo, se è una che il generatore di sinossi sa leggere. */
export function lingua(t: string): "it" | "en" | null {
  const p: Record<string, number> = {};
  for (const [k, re] of Object.entries(MARCATORI)) p[k] = (t.match(re) ?? []).length;
  const vincitore = Object.entries(p).sort((a, b) => b[1] - a[1])[0];
  if (!vincitore || vincitore[1] < 3) return null;
  // Un margine, non un pareggio: fra italiano e spagnolo la differenza è di
  // poche parole, e un pareggio significa che non lo sappiamo.
  const secondo = Object.entries(p).sort((a, b) => b[1] - a[1])[1];
  if (secondo && vincitore[1] - secondo[1] < 2) return null;
  return vincitore[0] === "it" || vincitore[0] === "en" ? vincitore[0] : null;
}

export function usabile(desc: string | undefined | null): string | null {
  const d = (desc ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (d.length < MIN_LEN) return null;
  if (SPAZZATURA.some((r) => r.test(d))) return null;
  if (!lingua(d)) return null;
  return d.slice(0, 4000);
}

/** Il titolo restituito è lo stesso libro? */
export function stessoTitolo(titoloVolume: string | undefined, titoloLibro: string): boolean {
  const tn = norm(titoloVolume), bn = norm(titoloLibro);
  if (!tn || !bn) return false;
  // Il prefisso comune deve coprire il più corto dei due per intero, non un
  // pezzo arbitrario: «Il giorno della civetta» e «Il giorno della civetta.
  // Guida alla lettura» sono lo stesso libro, «L'uomo duplicato» e «The
  // Double» no — ed è giusto scartare il secondo caso, perché la descrizione
  // sarebbe di un'edizione in un'altra lingua.
  const n = Math.min(tn.length, bn.length);
  return tn.slice(0, n) === bn.slice(0, n);
}

/**
 * Sceglie fra i risultati, preferendo la lingua del libro, poi italiano, poi
 * inglese. `verificaTitolo` si disattiva sulla ricerca per ISBN, che è già
 * un'identificazione esatta.
 */
export function scegli(
  items: Volume[] | null | undefined,
  b: Libro,
  verificaTitolo: boolean,
): { testo: string; lingua: "it" | "en" } | null {
  const cand: { lingua: "it" | "en"; testo: string }[] = [];
  for (const it of items ?? []) {
    const vi = it.volumeInfo ?? {};
    const testo = usabile(vi.description);
    if (!testo) continue;
    // Senza ISBN la ricerca è per testo libero e può restituire qualunque
    // cosa: è così che all'arricchimento via Wikipedia è finito addosso a
    // «The trey of spades» un elenco di insulti etnici.
    if (verificaTitolo && !stessoTitolo(vi.title, b.title)) continue;
    cand.push({ lingua: lingua(testo)!, testo });
  }
  for (const pref of [b.language, "it", "en"]) {
    const t = cand.find((c) => c.lingua === pref);
    if (t) return t;
  }
  return null;
}
