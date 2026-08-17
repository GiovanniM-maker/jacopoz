-- =====================================================================
-- 0072 — W1b, terza parte: la lettura delle recensioni segue l'opera
--
-- Ultimo punto in cui l'edizione si sostituiva all'opera: la funzione che
-- ordina le recensioni di una scheda filtrava su `r.book_id = p_book_id`.
-- Con le recensioni ora agganciate a `work_id` (0071), quel filtro nascondeva
-- proprio le recensioni che il resto del lavoro serviva a rendere visibili.
--
-- Cambiano due punti: il filtro, e il denominatore del punteggio di
-- coinvolgimento — che va calcolato sullo stesso insieme che poi si ordina,
-- altrimenti una recensione può risultare più popolare del massimo.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_book_reviews_ranked(p_book_id uuid, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS SETOF feed_item
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  c_half_life_hours constant numeric := 72;
begin
  return query
  with
  my_genres as (
    select genre_slug as g from public.user_genre_prefs where user_id = v_user
    union
    select unnest(b.categories)
    from public.user_books ub join public.books b on b.id = ub.book_id
    where ub.user_id = v_user and (ub.liked or ub.status = 'read')
  ),
  my_follows as (
    select following_id from public.follows where follower_id = v_user
  ),
  max_eng as (
    select greatest(max(ln((1 + like_count + 15 * comment_count)::numeric)), 1) as m
    from public.reviews where work_id = (select work_id from public.books where id = p_book_id)
      and status = 'visible'
  )
  select
    r.id, r.book_id, b.title, b.cover_url, b.authors,
    p.id, p.username, p.display_name, p.avatar_url,
    r.rating, r.body, r.contains_spoilers,
    r.like_count, r.comment_count, r.created_at,
    exists (
      select 1 from public.likes l
      where l.user_id = v_user and l.target_type = 'review' and l.target_id = r.id
    ) as viewer_has_liked,
    round(
        0.35 * (
          case when r.user_id in (select following_id from my_follows) then 1.0
               when exists (select 1 from public.user_books ub
                            join public.books rb on rb.id = ub.book_id
                            where ub.user_id = r.user_id and (ub.liked or ub.status = 'read')
                              and rb.categories && (select array_agg(g) from my_genres)) then 0.5
               else 0.0 end)
      + 0.25 * r.quality_score
      + 0.25 * (ln((1 + r.like_count + 15 * r.comment_count)::numeric) / (select m from max_eng))
      + 0.15 * exp(- (extract(epoch from (now() - r.created_at)) / 3600.0) / c_half_life_hours)
    , 4) as score
  from public.reviews r
  join public.books b on b.id = r.book_id
  join public.profiles p on p.id = r.user_id
  -- Per opera, non per edizione: chi apre l'Adelphi deve vedere anche la
  -- recensione scritta sull'Einaudi. Il libro mostrato accanto alla recensione
  -- resta quello che il recensore aveva in mano (r.book_id), che è
  -- l'informazione vera.
  where r.work_id = (select work_id from public.books where id = p_book_id)
    and r.status = 'visible'
    and r.user_id not in (select blocked_id from public.user_blocks where blocker_id = v_user)
  order by score desc, r.created_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$function$
;

revoke execute on function public.get_book_reviews_ranked(uuid, int, int) from anon;
