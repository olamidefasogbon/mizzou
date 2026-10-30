// Admin Supabase client (service role). Server only, and only for the
// usage ledger and budget work that must bypass RLS. Never import this
// module — or the key it reads — from client code.

import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { requiredEnv } from './env';

type AdminClient = ReturnType<typeof createClient>;

let admin: AdminClient | undefined;

export function supabaseAdmin(): AdminClient {
  admin ??= createClient(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
