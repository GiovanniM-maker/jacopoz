-- =====================================================================
-- 0027 — "Non finito" (DNF) shelf
--
-- A 4th reading state: started but abandoned. It's a weak signal — the
-- reader engaged enough to start, but not to finish — so it sits just below
-- "want_to_read" in the interaction weighting and is deliberately excluded
-- from the positive taste vector (which keys on read / rated / liked).
-- =====================================================================

-- ADD VALUE must be committed before it can be referenced; keep it as the
-- first statement (Supabase's migration runner applies statements in order).
alter type public.shelf_status add value if not exists 'dnf';

create or replace function public.interaction_weight(ub public.user_books)
returns numeric
language sql
immutable
as $$
  select case
    when ub.status = 'read' and coalesce(ub.rating, 0) >= 5 then 8
    when ub.status = 'read' and coalesce(ub.rating, 0) >= 4 then 7
    when ub.status = 'read'                                 then 6
    when ub.status = 'reading'                              then 5
    when ub.liked                                           then 4
    when ub.status = 'want_to_read'                         then 2
    when ub.status = 'dnf'                                  then 1
    else 1
  end::numeric
$$;
