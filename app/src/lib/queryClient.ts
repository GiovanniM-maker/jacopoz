import { QueryClient } from "@tanstack/react-query";

// One client for the app. Reasonable defaults for a social read-heavy app:
// cache aggressively, refetch on reconnect, don't spam retries.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000, // 1 min — feed/dashboard don't need to be realtime
      // Allineato al persister (queryPersist.ts, MAX_AGE_MS = 24 h), non scelto
      // a sentimento. Con `gcTime` a 5 minuti React Query buttava via ogni
      // query inattiva dopo cinque minuti: la cache ripristinata all'avvio
      // serviva solo a ciò che veniva rimontato subito — la Home — e tutto il
      // resto veniva riscaricato. Anche solo uscire da una scheda libro e
      // tornarci dopo cinque minuti rifaceva tutte le richieste.
      //
      // Il prezzo è memoria: le query inattive restano in RAM per un giorno.
      // Sono righe JSON di poche decine di KB ciascuna, e il persister scrive
      // comunque solo le chiavi del suo elenco chiuso.
      gcTime: 24 * 60 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
