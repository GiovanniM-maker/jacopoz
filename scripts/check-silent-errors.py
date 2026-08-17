#!/usr/bin/env python3
"""
Vieta le letture che ingoiano l'errore senza dichiararlo.

Il difetto: `const { data } = await supabase...` scarta `error`. Se la query
falla, il chiamante riceve `undefined`, lo trasforma in lista vuota, e la
schermata dice «non hai niente salvato» a chi ha dei salvataggi. Un guasto che
si presenta come un successo.

Non è un caso di scuola: è successo tre volte su questo progetto in due giorni.
Il backfill delle sinossi rispondeva `{"esaminati":0}` con stato 200 mentre la
query veniva cancellata per timeout — e sembrava «finito». L'import dei libri
era rotto da ore e sembrava un problema di rete.

**A volte ignorarlo è giusto**, e per questo il controllo non è un divieto
assoluto: una lettura che decide se un cuore è pieno o vuoto non deve svuotare
la schermata quando fallisce. Quello che il controllo pretende è che la scelta
sia **scritta**: un commento nelle righe sopra che dica perché. Una riga
`const { data } =` senza spiegazione è indistinguibile da una dimenticanza; con
la spiegazione, chi la rilegge sa che è stata pensata.

Uso:  python3 scripts/check-silent-errors.py
"""
import pathlib
import re
import sys

RADICE = pathlib.Path(__file__).resolve().parent.parent
AREE = ["app/src/api", "app/src/lib", "app/src/store"]

# Parole che, in un commento vicino, contano come dichiarazione della scelta.
GIUSTIFICAZIONI = re.compile(
    r"decoro|decora|ignorato di proposito|best-effort|non blocca|"
    r"volutamente|di proposito|fire-and-forget",
    re.IGNORECASE,
)

# `getSession` e simili non passano da PostgREST e non hanno la stessa forma di
# errore: il difetto che cerchiamo è quello delle letture di dati.
ESENTI = re.compile(r"supabase\.auth\.")


def main() -> int:
    problemi = []
    for area in AREE:
        for f in sorted((RADICE / area).rglob("*.ts")):
            righe = f.read_text(encoding="utf-8").splitlines()
            for i, riga in enumerate(righe):
                if "const { data }" not in riga:
                    continue
                if "await supabase" not in riga and not (
                    i + 1 < len(righe) and "supabase" in righe[i + 1]
                ):
                    continue
                if ESENTI.search(riga) or (
                    i + 1 < len(righe) and ESENTI.search(righe[i + 1])
                ):
                    continue
                # Il commento **attaccato** all'istruzione, quante righe che
                # sia: si risale finché le righe sono commenti. Una finestra
                # fissa di N righe era la prima versione, e bocciava un
                # commento di otto righe scritto bene — il criterio non è
                # «quanto sopra guardo», è «cos'è attaccato a questa riga».
                j = i - 1
                while j >= 0 and righe[j].strip().startswith(("//", "/*", "*")):
                    j -= 1
                contesto = "\n".join(righe[j + 1 : i])
                if not GIUSTIFICAZIONI.search(contesto):
                    problemi.append(
                        f"{f.relative_to(RADICE)}:{i + 1} — `const {{ data }}` senza "
                        f"`error` e senza un commento che dica perché"
                    )

    if problemi:
        print("Letture che ingoiano l'errore senza dichiararlo:\n")
        for p in problemi:
            print(f"  {p}")
        print(
            "\nO leggi `error` e propagalo, oppure — se ignorarlo è la scelta "
            "giusta perché\nquella lettura decora invece di portare contenuto — "
            "scrivi nelle righe sopra\nperché. Vedi app/src/api/bookmarks.ts, che "
            "contiene entrambi i casi a poche\nrighe di distanza."
        )
        return 1

    print("Nessuna lettura ingoia l'errore in silenzio.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
