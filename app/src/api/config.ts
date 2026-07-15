import { supabase } from "@/lib/supabase";

/** Remote flags from app_config (ads on/off, affiliate tag, etc.). */
export async function getAppConfig(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from("app_config").select("key,value");
  if (error) throw error;
  const out: Record<string, unknown> = {};
  for (const row of data ?? []) out[row.key] = row.value;
  return out;
}

/** Whether the signed-in user has an active Premium entitlement. */
export async function isPremium(): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_premium");
  if (error) return false;
  return !!data;
}

/** Build an Amazon affiliate URL for a book from its ISBN, via the DB helper
 *  (keeps the associate tag server-side and rotatable). */
export async function affiliateUrl(isbn: string | null): Promise<string | null> {
  if (!isbn) return null;
  const { data, error } = await supabase.rpc("amazon_affiliate_url", { p_isbn: isbn });
  if (error) return null;
  return (data as string) ?? null;
}
