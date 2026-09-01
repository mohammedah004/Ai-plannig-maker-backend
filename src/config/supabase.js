import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/**
 * Singleton Supabase admin client configured with Service Role credentials.
 * Bypasses RLS for trusted backend operations and atomic RPC calls.
 * NEVER expose this client or its credentials to frontend clients.
 */
export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);
