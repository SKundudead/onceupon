// Username sign-in proxy. Configure SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY as Supabase Function secrets. Never expose service role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405, headers: { ...cors, "Content-Type": "application/json" }
  });

  try {
    const { username, password } = await req.json();
    const clean = String(username || "").trim();
    if (!/^[A-Za-z0-9_]{3,24}$/.test(clean) || typeof password !== "string" || password.length < 8) {
      return new Response(JSON.stringify({ error: "Invalid username or password." }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const auth = createClient(url, anonKey, { auth: { persistSession: false } });

    const { data: mapping, error: mapError } = await admin
      .from("account_usernames")
      .select("user_id")
      .eq("username_normalized", clean.toLowerCase())
      .maybeSingle();
    if (mapError || !mapping) {
      return new Response(JSON.stringify({ error: "Invalid username or password." }), {
        status: 401, headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(mapping.user_id);
    if (userError || !userData.user?.email) {
      return new Response(JSON.stringify({ error: "Invalid username or password." }), {
        status: 401, headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    const { data, error } = await auth.auth.signInWithPassword({
      email: userData.user.email,
      password
    });
    if (error || !data.session) {
      return new Response(JSON.stringify({ error: "Invalid username or password." }), {
        status: 401, headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ session: data.session }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" }
    });
  } catch {
    return new Response(JSON.stringify({ error: "Unable to sign in right now." }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" }
    });
  }
});
