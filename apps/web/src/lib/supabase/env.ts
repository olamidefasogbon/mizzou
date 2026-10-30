// Server-safe env reads for Supabase clients. Values are read here, never
// logged; the service role key lives in this module family only and must
// never be reachable from client code.

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}
