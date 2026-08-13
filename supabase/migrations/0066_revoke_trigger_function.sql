-- =====================================================================
-- 0066 — La funzione di trigger va revocata come tutte le altre
--
-- Trovata dal controllo S-2 della suite: `internal_reset_synopsis_attempts`,
-- creata in 0062, era l'unica funzione `internal_*` con EXECUTE per `anon`.
-- Non l'avevo revocata perché è una funzione di trigger e il trigger scatta
-- comunque, indipendentemente dai permessi di chi fa la UPDATE.
--
-- Chiamarla direttamente darebbe errore («trigger functions can only be called
-- as triggers»), quindi non era sfruttabile. Ma la regola esiste proprio per
-- non dover fare questo ragionamento caso per caso: se l'invariante è «nessuna
-- internal_* è raggiungibile da anon», un'eccezione ragionata vale quanto una
-- dimenticanza, perché la prossima volta nessuno la rifà.
-- =====================================================================

revoke execute on function public.internal_reset_synopsis_attempts()
  from public, anon, authenticated;
