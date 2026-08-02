import { Platform } from "react-native";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Tiene la cache delle query nel localStorage, così riaprendo l'app la Home si
 * disegna subito con quello che c'era e la rete la aggiorna dopo, invece di
 * lasciare uno spinner mentre partono dieci richieste.
 *
 * Scritto a mano invece di aggiungere `@tanstack/react-query-persist-client`:
 * servono quaranta righe e in cambio si controlla esattamente *cosa* finisce
 * su disco, che qui è il punto delicato.
 *
 * Tre vincoli, tutti per una ragione precisa:
 *
 *  - **Solo dati di catalogo.** Si salva una lista chiusa di chiavi. Feed,
 *    notifiche e profili altrui non ci finiscono: sono dati di persone, e la
 *    cache di un browser condiviso è il posto sbagliato.
 *  - **Legata all'utente.** La chiave di storage contiene l'id: chi entra dopo
 *    non vede lo scaffale di chi c'era prima. Al logout si cancella.
 *  - **Con una scadenza e una versione.** Dati vecchi di un giorno non valgono
 *    la pena, e cambiare la forma di una risposta deve invalidare quello che
 *    c'è, non farlo leggere a un codice che non se lo aspetta.
 */

const VERSION = 3;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const WRITE_DEBOUNCE_MS = 1500;

// Le uniche query che vale la pena ritrovare già pronte: sono ciò che disegna
// la prima schermata.
const PERSIST: ReadonlySet<string> = new Set([
  "home-sections",
  "recos",
  "trending",
  "free-reads",
  "paid-discoveries",
  "new-releases",
  "continue-reading",
  "genres",
  "genre-prefs",
]);

const available = () =>
  Platform.OS === "web" && typeof localStorage !== "undefined";

const storageKey = (userId: string) => `tomo.qc.v${VERSION}.${userId}`;

interface Dumped {
  at: number;
  entries: { key: unknown; data: unknown }[];
}

/** Rimette in cache quello che c'era, se non è scaduto. */
export function hydrateQueryCache(client: QueryClient, userId: string): void {
  if (!available() || !userId) return;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return;
    const dump = JSON.parse(raw) as Dumped;
    if (!dump?.at || Date.now() - dump.at > MAX_AGE_MS) {
      localStorage.removeItem(storageKey(userId));
      return;
    }
    for (const e of dump.entries ?? []) {
      // `updatedAt` nel passato: i dati si vedono subito ma risultano stantii,
      // quindi react-query li rinfresca da solo appena montato il componente.
      client.setQueryData(e.key as never, e.data as never, {
        updatedAt: dump.at,
      });
    }
  } catch {
    // Una cache illeggibile non deve impedire l'avvio.
    try {
      localStorage.removeItem(storageKey(userId));
    } catch {
      /* niente da fare */
    }
  }
}

/** Comincia a salvare i cambiamenti. Restituisce la funzione per smettere. */
export function persistQueryCache(client: QueryClient, userId: string): () => void {
  if (!available() || !userId) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;

  const dump = () => {
    timer = null;
    try {
      const entries = client
        .getQueryCache()
        .getAll()
        .filter((q) => {
          const head = Array.isArray(q.queryKey) ? q.queryKey[0] : q.queryKey;
          return (
            typeof head === "string" &&
            PERSIST.has(head) &&
            q.state.status === "success" &&
            q.state.data !== undefined
          );
        })
        .map((q) => ({ key: q.queryKey, data: q.state.data }));
      if (entries.length === 0) return;
      localStorage.setItem(
        storageKey(userId),
        JSON.stringify({ at: Date.now(), entries } satisfies Dumped),
      );
    } catch {
      // Quota piena o storage negato: si perde la cache, non la sessione.
    }
  };

  const unsubscribe = client.getQueryCache().subscribe(() => {
    if (timer) return;
    timer = setTimeout(dump, WRITE_DEBOUNCE_MS);
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

/** Al logout: quello che resta sul dispositivo non è più di chi lo usa. */
export function clearPersistedQueryCache(): void {
  if (!available()) return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith("tomo.qc.")) localStorage.removeItem(k);
    }
  } catch {
    /* niente da fare */
  }
}
