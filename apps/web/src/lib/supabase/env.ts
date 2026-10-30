// Server-safe env reads for Supabase clients. Values are read here, never
// logged; the service role key lives in this module family only and must
// never be reachable from client code.

export function requiredEnv(name: string): string {
  const envMap: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };

  const value = envMap[name] ?? process.env[name];
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  return value;
}
