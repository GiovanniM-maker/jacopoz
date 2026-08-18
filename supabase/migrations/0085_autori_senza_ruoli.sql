-- =====================================================================
-- 0085 — «Dick [Illustrator] Francis»: togliere i ruoli dai nomi degli autori
--
-- I record di Gutenberg infilano il ruolo dentro il nome. In catalogo:
--
--   occorrenze di autore                 91.399
--   con una parentesi quadra              2.165   (1.275 nomi distinti)
--   libri coinvolti                       2.061
--     di cui con anche un autore pulito   1.989
--     di cui con solo nomi col ruolo         72
--
-- Il difetto si vede nelle etichette dei filoni — «Fantascienza · attorno a
-- Dick [Illustrator] Francis» — ma non nasce lì e non va corretto lì: lo stesso
-- nome sporco rende `search_authors` incapace di trovare «Dick Francis», rompe
-- `getBooksByAuthor`, che confronta i nomi per uguaglianza dentro l'array, e
-- finisce nel testo da cui si calcola l'embedding.
--
-- --------------------------------------------------------------------
-- Perché non basta togliere le parentesi
-- --------------------------------------------------------------------
-- «Dick [Illustrator] Francis» **non è** Dick Francis. È l'illustratore di quel
-- libro, e il romanziere che corre in ippodromo è un'altra persona. Togliere il
-- marcatore non pulisce un nome: crea un'identità falsa, e la crea proprio dove
-- fa più danno — nella ricerca per autore e nella riga «Ancora <autore>».
--
-- Quindi: dove il libro ha **anche** un autore pulito (1.989 casi su 2.061), il
-- nome col ruolo si toglie, perché `authors` deve contenere autori. Dove non
-- c'è altro (72 casi), si tiene il nome ripulito: è la cosa più vicina a un
-- autore che quel record abbia.
--
-- --------------------------------------------------------------------
-- E non tutto ciò che sta fra parentesi è un ruolo
-- --------------------------------------------------------------------
-- Contate tutte le forme presenti, non immaginate:
--
--   Illustrator 1401 · Translator 464 · Editor 141 · Contributor 58 ·
--   Compiler 27 · Commentator 18 · Engraver 10 · Adapter 8 · Publisher 6 ·
--   Annotator 4 · Photographer 2
--
-- ma anche, e sono un'altra cosa:
--
--   鳥山 明 [Akira Toriyama]        il nome dello stesso autore in caratteri latini
--   青山 剛昌 [Gōshō Aoyama]
--   Baek Se-Hee [백세희]
--   Gebrüder Grimm [Brothers Grimm]
--   J. W. [Dubious author] Duffield   una nota di catalogo, non un ruolo
--   Fred [From Old Catalog] Joint Rothwell
--   Chaves, Osvaldo A. ...[et. al.]
--   [author not identified]           nessun nome affatto
--
-- Una regola che butta via ogni nome con una parentesi butterebbe via Toriyama.
-- Per questo la funzione riconosce il **vocabolario dei ruoli**, non le
-- parentesi; e quando dentro le parentesi c'è la trascrizione latina di un nome
-- scritto in un altro alfabeto, tiene quella — perché è quella che un lettore
-- italiano sa cercare.
-- =====================================================================

/**
 * Normalizza un nome di autore.
 *
 * Restituisce `null` quando la stringa non nomina un autore: un ruolo
 * (illustratore, traduttore, curatore…) o una non-attribuzione.
 * Altrimenti restituisce il nome ripulito.
 */
create or replace function public.autore_normalizzato(p_nome text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := btrim(coalesce(p_nome, ''));
  v_dentro text;
  v_fuori  text;
begin
  if v = '' then return null; end if;

  -- Google Books scrive lo stesso ruolo fra parentesi tonde: «James Stevenson
  -- (Illustrator)». Oggi è un caso su 91.399, ma il canale da cui arriva è
  -- quello che sta crescendo, quindi si copre la forma e non la riga. La
  -- conversione avviene **solo** se dentro c'è esattamente un ruolo: le tonde,
  -- a differenza delle quadre, in un nome ci stanno per mille motivi buoni.
  v := regexp_replace(
         v,
         '\((illustrator|translator|editor|contributor|compiler|commentator|'
         || 'engraver|adapter|publisher|annotator|photographer)\)',
         '[\1]', 'gi');

  -- Nessuna parentesi: la stragrande maggioranza dei 91.399 nomi.
  if v !~ '[\[\]]' then
    return nullif(btrim(regexp_replace(v, '\s+', ' ', 'g')), '');
  end if;

  -- Parentesi mai chiusa. Undici nomi, e dieci hanno la stessa forma:
  -- «Alexander H. [Author of introduction Chorney». Chi firma la prefazione non
  -- è l'autore del libro, quindi vale la regola dei ruoli; l'undicesimo,
  -- «[Litta, Pompeo conte», è un nome vero con una parentesi di troppo.
  -- E la simmetrica: una quadra chiusa senza l'aperta, «etc.] Fowl».
  if (v ~ '\[') <> (v ~ '\]') then
    if v ~* '\[\s*(author of |)(introduction|preface|foreword|note)' then
      return null;
    end if;
    return nullif(btrim(regexp_replace(regexp_replace(v, '[\[\]]', '', 'g'),
                                       '\s+', ' ', 'g')), '');
  end if;

  v_dentro := (regexp_match(v, '\[([^\]]*)\]'))[1];
  v_fuori  := btrim(regexp_replace(v, '\s*\[[^\]]*\]\s*', ' ', 'g'));
  v_fuori  := btrim(regexp_replace(v_fuori, '\s+', ' ', 'g'));
  -- «Chaves, Osvaldo A. ...[et. al.]» lascia dei puntini di sospensione in coda.
  -- Si tolgono quelli (due o più) e la punteggiatura di separazione, **non** un
  -- punto singolo: «Chaves, Osvaldo A.» finisce con l'iniziale di un nome, e
  -- toglierle il punto la trasforma in un'altra cosa. La prima stesura lo
  -- toglieva, e si vedeva solo provandola su tutti i nomi.
  v_fuori  := btrim(regexp_replace(v_fuori, '(\.{2,}|[\s,;])+$', ''));

  -- Le parentesi attorno alla concatenazione non sono cosmetiche: `~*` e `||`
  -- hanno la stessa precedenza e associano a sinistra, quindi
  -- `v ~* 'a' || 'b'` si legge `(v ~* 'a') || 'b'` — la regex arriva troncata
  -- alla prima metà, e con una parentesi aperta il motore falla a ogni riga.
  -- Trovato applicandola, non rileggendola.

  -- 1. Un ruolo: questo nome non è l'autore del libro.
  if v_dentro ~* ('^(illustrator|translator|editor|contributor|compiler|commentator|'
                 || 'engraver|adapter|publisher|annotator|photographer|author)$') then
    return null;
  end if;

  -- 2. Una non-attribuzione: non c'è nessun nome da salvare, oppure ce n'è uno
  --    fuori dalle parentesi e la parentesi è una nota di catalogo.
  if v_dentro ~* ('^(author not identified|dubious author|from old catalog|et\.? ?al\.?|'
                 || 'pseud\.?|unknown)$') then
    return nullif(v_fuori, '');
  end if;

  -- 3. La parentesi contiene un nome. Se **fuori** non c'è nemmeno una lettera
  --    latina — 鳥山 明 [Akira Toriyama] — la forma utile è quella dentro:
  --    è quella che un lettore italiano può digitare.
  if v_fuori !~ '[A-Za-zÀ-ÿ]' then
    return nullif(btrim(regexp_replace(v_dentro, '\s+', ' ', 'g')), '');
  end if;

  -- 4. Altrimenti si tiene il nome fuori dalle parentesi.
  return nullif(v_fuori, '');
end;
$$;
grant execute on function public.autore_normalizzato(text) to authenticated, anon;

-- --------------------------------------------------------------------
-- La pulizia del catalogo
-- --------------------------------------------------------------------
-- Provata a secco prima di essere eseguita:
--
--   libri che cambiano                           2.110
--     perdono un nome (l'illustratore)           1.982
--     cambiano solo per spazi doppi o in coda        48
--     restano senza nessun autore                     2   («[author not identified]»)
--
-- I due che restano senza autore sono corretti così: `BookCard` mostra «Autore
-- ignoto», che è esattamente ciò che dice il record. Un nome inventato sarebbe
-- peggio del vuoto.
update public.books b
set authors = coalesce(
      nullif(array(select public.autore_normalizzato(n)
                   from unnest(b.authors) n
                   where public.autore_normalizzato(n) is not null), '{}'),
      -- Tutti i nomi erano ruoli: 72 libri, e sono antologie, raccolte e
      -- traduzioni. Per un'antologia il curatore **è** l'attribuzione più vicina
      -- a un autore, e non c'è nessun romanziere con cui confonderlo — il
      -- rischio dell'identità falsa vale per l'illustratore del romanzo di
      -- qualcun altro, che infatti qui viene tolto.
      array(select btrim(regexp_replace(regexp_replace(n, '\s*\[[^\]]*\]\s*', ' ', 'g'),
                                        '\s+', ' ', 'g'))
            from unnest(b.authors) n
            where btrim(regexp_replace(regexp_replace(n, '\s*\[[^\]]*\]\s*', ' ', 'g'),
                                       '\s+', ' ', 'g')) <> '')
    )
where b.authors is not null
  and b.authors is distinct from coalesce(
      nullif(array(select public.autore_normalizzato(n)
                   from unnest(b.authors) n
                   where public.autore_normalizzato(n) is not null), '{}'),
      array(select btrim(regexp_replace(regexp_replace(n, '\s*\[[^\]]*\]\s*', ' ', 'g'),
                                        '\s+', ' ', 'g'))
            from unnest(b.authors) n
            where btrim(regexp_replace(regexp_replace(n, '\s*\[[^\]]*\]\s*', ' ', 'g'),
                                       '\s+', ' ', 'g')) <> '')
    );

-- --------------------------------------------------------------------
-- Dove ci si ferma, e perché fermarsi è la scelta giusta
-- --------------------------------------------------------------------
-- Dopo la pulizia restano tre nomi che contengono un ruolo scritto in prosa:
--
--   Knight, Sarah (Freelance editor)
--   Gardner, Helen, editor
--   2013. editor: Tōkyō : Yakōsha
--
-- Tre su 41.157 nomi distinti. Una regola più larga — «togli tutto ciò che
-- somiglia a editor» — li prenderebbe, e insieme a loro prenderebbe questi, che
-- sono l'entità accreditata per davvero:
--
--   Equipo Editorial · Fagr Editore · Editorial Escudo de Oro ·
--   Editors at America's Test Kitchen · Héstia editores · Family Circle Editors
--
-- «Editore» ed «Editorial» sono semplicemente le parole italiana e spagnola per
-- editore. La regola qui è esatta — il vocabolario dei ruoli, dentro parentesi —
-- e per questo lascia stare i quattordici nomi buoni. Tre righe sbagliate sono
-- un prezzo più basso di quattordici editori cancellati.

-- `authors` entra nel testo da cui si calcola l'embedding, quindi questi 2.110
-- libri hanno ora un `embedding_text_hash` che non corrisponde più: il cron
-- `reembed-changed` li rimette in coda da solo. È il motivo per cui questa
-- migrazione viene **prima** del ricalcolo dei filoni e non dopo.
analyze public.books;
