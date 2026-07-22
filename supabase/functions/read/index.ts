// =====================================================================
// Edge Function: read
//
// Two jobs behind one endpoint:
//   • { book_id }        → match the book to Project Gutenberg (Gutendex).
//       On a confident match: persist gutenberg_id + free_read_url, and
//       fix the author to Gutenberg's clean canonical name (this is what
//       repairs classics whose Google/OpenLibrary import listed a
//       translator or an odd transliteration instead of the real author).
//       Returns { readable, gutenberg_id, author }.
//   • { gutenberg_id }   → return the cleaned plaintext of the book,
//       stripped of the Project Gutenberg header/footer boilerplate
//       (server-side proxy → no CORS issues in the reader).
// =====================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function norm(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "Dostoyevsky, Fyodor" -> "Fyodor Dostoyevsky"; leave plain names as-is.
function flipName(name: string): string {
  const parts = name.split(",");
  if (parts.length === 2) return `${parts[1].trim()} ${parts[0].trim()}`.trim();
  return name.trim();
}

function surname(name: string): string {
  const n = flipName(name);
  const toks = norm(n).split(" ");
  return toks[toks.length - 1] || "";
}

async function gutendexMatch(title: string, authors: string[]) {
  const q = `${title} ${(authors[0] || "").split(/[, ]/).filter(Boolean).slice(-1)[0] || ""}`.trim();
  const res = await fetch(`https://gutendex.com/books?search=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": "TomoBeta/1.0" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const nt = norm(title);
  const wantSurname = authors.length ? surname(authors[0]) : "";

  for (const r of (data.results ?? []).slice(0, 5)) {
    const rt = norm(r.title);
    const titleOk = rt.includes(nt) || nt.includes(rt);
    const authorOk =
      !wantSurname ||
      (r.authors ?? []).some((a: any) => norm(a.name).includes(wantSurname));
    if (!titleOk || !authorOk) continue;

    const fmt = r.formats ?? {};
    const textUrl =
      fmt["text/plain; charset=utf-8"] ||
      fmt["text/plain; charset=us-ascii"] ||
      fmt["text/plain"] ||
      null;
    return {
      gutenberg_id: r.id as number,
      free_read_url: textUrl as string | null,
      author: r.authors?.[0]?.name ? flipName(r.authors[0].name) : null,
    };
  }
  return null;
}

function stripBoilerplate(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n");
  const start = t.match(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);
  if (start) t = t.slice(start.index! + start[0].length);
  const end = t.match(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
  if (end) t = t.slice(0, end.index);
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();

    // --- Text delivery -------------------------------------------------
    if (body.gutenberg_id) {
      const id = Number(body.gutenberg_id);
      const urls = [
        `https://www.gutenberg.org/ebooks/${id}.txt.utf-8`,
        `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
        `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
      ];
      for (const u of urls) {
        const res = await fetch(u, { headers: { "User-Agent": "TomoBeta/1.0" } });
        if (res.ok) {
          const text = stripBoilerplate(await res.text());
          return new Response(JSON.stringify({ text }), {
            headers: { ...CORS, "content-type": "application/json" },
          });
        }
      }
      return new Response(JSON.stringify({ error: "text not found" }), {
        status: 404,
        headers: { ...CORS, "content-type": "application/json" },
      });
    }

    // --- Match / availability -----------------------------------------
    if (body.book_id) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: book } = await supabase
        .from("books")
        .select("id, title, authors, gutenberg_id, free_read_url, gutenberg_checked_at")
        .eq("id", body.book_id)
        .maybeSingle();
      if (!book) {
        return new Response(JSON.stringify({ readable: false }), {
          headers: { ...CORS, "content-type": "application/json" },
        });
      }
      // Cached result.
      if (book.gutenberg_checked_at) {
        return new Response(
          JSON.stringify({
            readable: !!book.free_read_url,
            gutenberg_id: book.gutenberg_id,
          }),
          { headers: { ...CORS, "content-type": "application/json" } },
        );
      }

      const match = await gutendexMatch(book.title, book.authors ?? []);
      const patch: Record<string, unknown> = { gutenberg_checked_at: new Date().toISOString() };
      if (match) {
        patch.gutenberg_id = match.gutenberg_id;
        patch.free_read_url = match.free_read_url;
        // Gutenberg curates public-domain author names — trust it to fix
        // the translator/transliteration mess from the import providers.
        if (match.author) patch.authors = [match.author];
      }
      await supabase.from("books").update(patch).eq("id", book.id);

      return new Response(
        JSON.stringify({
          readable: !!(match && match.free_read_url),
          gutenberg_id: match?.gutenberg_id ?? null,
          author: match?.author ?? null,
        }),
        { headers: { ...CORS, "content-type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "provide book_id or gutenberg_id" }), {
      status: 400,
      headers: { ...CORS, "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
});
