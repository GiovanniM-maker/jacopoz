// =====================================================================
// Edge Function: blurbs
//
// Recupera da Google Books la descrizione dell'editore per i libri che non ne
// hanno una. È il pezzo che mancava sotto W2: senza materiale la sinossi non
// si può scrivere, e il modello — se lo si lascia fare — la inventa.
//
// Misurato su 40 libri veri del catalogo, ordinati per priorità: **32 su 40**
// hanno una descrizione utilizzabile. Fra questi «Oblivion» di Wallace, cioè
// proprio il libro a cui il modello aveva attribuito la trama di «Infinite
// Jest» quando doveva cavarsela con il solo titolo.
//
// Il testo che arriva **non si mostra mai a un lettore**: finisce in
// `source_blurb_internal`, che è materiale di analisi per la sinossi. Vale la
// stessa regola dichiarata in synopsis/index.ts.
// =====================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
// La parte che sceglie sta in un file a parte perché è quella che sbaglia:
// così si prova contro payload veri (`scelta.test.ts`) e non in produzione.
import { scegli, type Libro, type Volume } from "./scelta.ts";

const KEY = Deno.env.get("GOOGLE_BOOKS_API_KEY") ?? "";
const DISPATCH_SECRET = Deno.env.get("SYNOPSIS_DISPATCH_SECRET") ?? "";

// --------------------------------------------------------------------
// Google Books
// --------------------------------------------------------------------

class QuotaFinita extends Error {}

/**
 * Contatore delle chiamate a Google, per invocazione.
 *
 * Non è una variabile di modulo: un'istanza Edge serve più richieste, e due
 * lotti che si sovrappongono si sommerebbero il conteggio a vicenda.
 */
type Stato = { chiamate: number };

/**
 * Un 403 non vuol dire per forza «quota finita».
 *
 * Google lo usa anche per le restrizioni per paese — `ingest-book` ha una
 * riprova apposta con `country=IT` proprio per quello. Trattarli tutti come
 * muro giornaliero significherebbe spegnere il recupero per il resto della
 * giornata a causa di un singolo libro storto. Il muro vero si dichiara nel
 * corpo della risposta.
 */
function muroDiQuota(status: number, corpo: string): boolean {
  if (status === 429) return true;
  return status === 403 &&
    /(rateLimitExceeded|quotaExceeded|dailyLimitExceeded|userRateLimitExceeded)/i.test(corpo);
}

async function cerca(q: string, st: Stato): Promise<Volume[]> {
  const url = "https://www.googleapis.com/books/v1/volumes?country=IT&maxResults=5" +
    `&key=${KEY}&q=${encodeURIComponent(q)}`;
  // 503 è frequente e transitorio: su una prova di 40 libri ne ha colpiti 3,
  // che senza riprova sarebbero sembrati "libro senza descrizione" e avrebbero
  // consumato un tentativo.
  for (let i = 0; i < 3; i++) {
    st.chiamate++;
    const res = await fetch(url);
    if (res.ok) return ((await res.json())?.items ?? []) as Volume[];
    const corpo = await res.text().catch(() => "");
    if (muroDiQuota(res.status, corpo)) throw new QuotaFinita(String(res.status));
    if (res.status >= 500 && i < 2) {
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      continue;
    }
    return [];
  }
  return [];
}

async function descrizione(b: Libro, st: Stato): Promise<{ testo: string; via: string } | null> {
  if (b.isbn_13) {
    const t = scegli(await cerca(`isbn:${b.isbn_13}`, st), b, false);
    if (t) return { testo: t.testo, via: "isbn" };
  }
  const t = scegli(await cerca(`${b.title} ${b.authors?.[0] ?? ""}`.trim(), st), b, true);
  return t ? { testo: t.testo, via: "titolo" } : null;
}

// --------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (DISPATCH_SECRET === "" || req.headers.get("x-dispatch-secret") !== DISPATCH_SECRET) {
    return new Response(JSON.stringify({ error: "riservato al cron" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  if (!KEY) {
    return new Response(JSON.stringify({ error: "GOOGLE_BOOKS_API_KEY assente" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const st: Stato = { chiamate: 0 };
    const n = Math.min(Number(body.batch ?? 8), 50);
    const { data: coda } = await supabase.rpc("internal_blurb_queue", { p_limit: n });
    const libri = (coda ?? []) as Libro[];

    let trovate = 0, vuoti = 0;
    let quota = false;

    for (const b of libri) {
      let esito: { testo: string; via: string } | null = null;
      try {
        esito = await descrizione(b, st);
      } catch (e) {
        if (e instanceof QuotaFinita) {
          // Fermarsi e basta: i libri non ancora esaminati restano in coda con
          // i loro tentativi intatti, e il giro dopo riparte da lì. Segnarli
          // come "senza descrizione" per un errore di quota li escluderebbe.
          quota = true;
          break;
        }
        throw e;
      }
      if (esito) {
        // Il trigger su questa colonna azzera i tentativi di sinossi: un libro
        // scartato per mancanza di materiali torna in coda ora che ne ha.
        await supabase.from("books").update({
          source_blurb_internal: esito.testo,
          blurb_source: `google_books:${esito.via}`,
          blurb_checked_at: new Date().toISOString(),
        }).eq("id", b.id);
        trovate++;
      } else {
        await supabase.rpc("internal_blurb_not_found", { p_book_id: b.id });
        vuoti++;
      }
    }

    // Si riporta sempre, non solo quando si tocca il muro: è la serie storica
    // che dice qual è la quota, non il singolo giorno in cui si esaurisce.
    await supabase.rpc("internal_blurb_quota_report", {
      p_chiamate: st.chiamate,
      p_libri: libri.length,
      p_esaurita: quota,
    });

    return new Response(
      JSON.stringify({
        trovate, vuoti, esaminati: libri.length, chiamate: st.chiamate,
        quota_esaurita: quota,
      }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    console.error("blurbs error:", err);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
