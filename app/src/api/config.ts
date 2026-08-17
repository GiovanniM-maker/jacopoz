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

// Qui stavano `affiliateUrl` (RPC `amazon_affiliate_url`) e `buyUrl` (RPC
// `amazon_buy_url`). Rimosse il 15 agosto 2026 perché l'affiliazione non poteva
// funzionare: il tag memorizzato in `app_config` è `jacopoz-20`, un tag del
// programma .com, mentre i link generati puntavano su amazon.it. Un tag di un
// altro marketplace viene ignorato, quindi nessuna conversione è mai stata
// attribuita — il pezzo non ha reso niente, in nessun momento. Le due funzioni
// SQL sono eliminate dalla migrazione 0076.
