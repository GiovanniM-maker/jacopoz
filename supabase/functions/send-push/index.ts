// =====================================================================
// Edge Function: send-push
//
// Called (via pg_net) by the `dispatch_push` trigger whenever a row lands in
// public.notifications. It loads the notification + its actor/book, builds a
// short Italian message, and delivers a Web Push to every device the recipient
// has opted in from (public.push_subscriptions), signing with VAPID and
// encrypting the payload. Stale endpoints (404/410) are pruned.
//
// Auth: this function runs with verify_jwt = false and instead checks a shared
// secret header (x-dispatch-secret) that only the DB trigger knows. Data is
// read/written with the service role (auto-injected env), bypassing RLS.
//
// Secrets (Edge Function env): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT, PUSH_DISPATCH_SECRET.
// =====================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "https://jacopoz.vercel.app";
const DISPATCH_SECRET = Deno.env.get("PUSH_DISPATCH_SECRET") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function firstName(name: string | null | undefined): string {
  return (name ?? "Qualcuno").split(" ")[0] || "Qualcuno";
}

/** Notification row + embedded actor and (for like/comment) the book title. */
function buildMessage(n: any): { title: string; body: string; url: string } {
  const who = firstName(n.actor?.display_name);
  const book = n.review?.book?.title as string | undefined;
  if (n.type === "follow") {
    return { title: "Nuovo follower", body: `${who} ha iniziato a seguirti`, url: "/notifications" };
  }
  if (n.type === "comment") {
    return {
      title: "Nuovo commento",
      body: book ? `${who} ha commentato la tua recensione di “${book}”` : `${who} ha commentato la tua recensione`,
      url: n.review?.id ? `/review/${n.review.id}` : "/notifications",
    };
  }
  return {
    title: "Nuovo like",
    body: book ? `${who} ha messo like alla tua recensione di “${book}”` : `${who} ha messo like alla tua recensione`,
    url: n.review?.id ? `/review/${n.review.id}` : "/notifications",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  if (!DISPATCH_SECRET || req.headers.get("x-dispatch-secret") !== DISPATCH_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  let notificationId: string | undefined;
  try {
    notificationId = (await req.json())?.notification_id;
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!notificationId) return new Response("missing notification_id", { status: 400 });

  // Load the notification with actor + review/book for the message.
  const { data: n, error } = await admin
    .from("notifications")
    .select(
      "id, user_id, type, actor:profiles!actor_id(display_name), review:reviews!review_id(id, book:books(title))",
    )
    .eq("id", notificationId)
    .single();
  if (error || !n) return new Response("notification not found", { status: 200 });

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", n.user_id);
  if (!subs || subs.length === 0) return new Response(JSON.stringify({ sent: 0 }), { status: 200 });

  const msg = buildMessage(n);
  const payload = JSON.stringify({ ...msg, tag: n.type });

  let sent = 0;
  const stale: string[] = [];
  await Promise.all(
    subs.map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) stale.push(s.id);
      }
    }),
  );

  if (stale.length) await admin.from("push_subscriptions").delete().in("id", stale);

  return new Response(JSON.stringify({ sent, pruned: stale.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
