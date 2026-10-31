import { NextResponse } from 'next/server';

// GET /api/health — booleans only, never values, so the human can confirm
// Vercel env is configured without leaking secrets into the response.

export async function GET(): Promise<NextResponse> {
  const vars = {
    modelKey: Boolean(process.env.MODEL_API_KEY ?? process.env.META_API_KEY),
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    turnstile: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
  };
  return NextResponse.json({ ok: Object.values(vars).every(Boolean), vars });
}
