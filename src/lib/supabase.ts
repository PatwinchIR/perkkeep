import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
let client: SupabaseClient<Database> | null = null;
export function getSupabase(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  if (key.startsWith("sb_secret_"))
    throw new Error(
      "A public publishable key is required. Never use a secret key in the browser.",
    );
  if (!key.startsWith("sb_publishable_"))
    throw new Error("Configure a Supabase publishable key.");
  if (!client)
    client = createClient<Database>(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  return client;
}
export function isLocal(): boolean {
  try {
    return ["127.0.0.1", "localhost"].includes(
      new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").hostname,
    );
  } catch {
    return false;
  }
}
