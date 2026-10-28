"use client";
import { createAuthClient } from "@neondatabase/auth/next";

let client: ReturnType<typeof createAuthClient> | null = null;
// Talks to this app's /api/auth proxy; the Neon Auth URL and cookie secret stay on the server.
export function authClient() {
  client ??= createAuthClient();
  return client;
}
