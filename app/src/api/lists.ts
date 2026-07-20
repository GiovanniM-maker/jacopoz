import { supabase } from "@/lib/supabase";
import type { BookCard, BookList, UUID } from "@/types/database";

/** Lists owned by a user (public ones for others, all for self via RLS). */
export async function getUserLists(userId: UUID): Promise<BookList[]> {
  const { data, error } = await supabase
    .from("book_lists")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as BookList[];
}

export async function getList(id: UUID): Promise<BookList> {
  const { data, error } = await supabase.from("book_lists").select("*").eq("id", id).single();
  if (error) throw error;
  return data as BookList;
}

export async function createList(
  userId: UUID,
  name: string,
  opts: { description?: string; isPublic?: boolean } = {},
): Promise<BookList> {
  const { data, error } = await supabase
    .from("book_lists")
    .insert({
      user_id: userId,
      name: name.trim(),
      description: opts.description ?? null,
      is_public: opts.isPublic ?? true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as BookList;
}

export async function updateList(
  id: UUID,
  patch: Partial<Pick<BookList, "name" | "description" | "is_public">>,
): Promise<void> {
  const { error } = await supabase.from("book_lists").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteList(id: UUID): Promise<void> {
  const { error } = await supabase.from("book_lists").delete().eq("id", id);
  if (error) throw error;
}

/** Books inside a list, as cards. */
export async function getListBooks(listId: UUID): Promise<BookCard[]> {
  const { data, error } = await supabase
    .from("book_list_items")
    .select(
      "book:books(id,title,subtitle,authors,cover_url,published_year,categories,reads_count,saves_count,likes_count,reviews_count,rating_sum,rating_count)",
    )
    .eq("list_id", listId)
    .order("added_at", { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .map((r: any) => r.book)
    .filter(Boolean)
    .map((b: any) => ({
      id: b.id,
      title: b.title,
      subtitle: b.subtitle,
      authors: b.authors,
      cover_url: b.cover_url,
      published_year: b.published_year,
      categories: b.categories,
      avg_rating: b.rating_count > 0 ? Number((b.rating_sum / b.rating_count).toFixed(2)) : null,
      reads_count: b.reads_count,
      saves_count: b.saves_count,
      likes_count: b.likes_count,
      reviews_count: b.reviews_count,
    }));
}

export async function addBookToList(listId: UUID, bookId: UUID): Promise<void> {
  const { error } = await supabase
    .from("book_list_items")
    .upsert({ list_id: listId, book_id: bookId }, { onConflict: "list_id,book_id" });
  if (error) throw error;
}

export async function removeBookFromList(listId: UUID, bookId: UUID): Promise<void> {
  const { error } = await supabase
    .from("book_list_items")
    .delete()
    .eq("list_id", listId)
    .eq("book_id", bookId);
  if (error) throw error;
}

/** The set of the user's list ids that already contain a given book — used to
 *  show checkmarks in the "add to list" sheet. */
export async function getListIdsContainingBook(userId: UUID, bookId: UUID): Promise<Set<UUID>> {
  const { data, error } = await supabase
    .from("book_list_items")
    .select("list_id, book_lists!inner(user_id)")
    .eq("book_id", bookId)
    .eq("book_lists.user_id", userId);
  if (error) throw error;
  return new Set((data ?? []).map((r: any) => r.list_id));
}
