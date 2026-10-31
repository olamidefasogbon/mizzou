import { NextResponse } from 'next/server';
import { BudgetExceededError, BudgetGuard, budgetFriendlyMessage, costForVoice, limitsFromEnv } from '@mizzou/core';
import { AuthRequiredError, resolveUser } from '@/lib/auth';
import { logServerError } from '@/lib/errors';
import { adaptDb, repo } from '@/lib/repo';
import {
  abuseLimitsFromEnv,
  checkHitRate,
  checkUploadCount,
  checkUploadSize,
  clientIp,
  logCapRefusal,
  supabaseCounterStore,
} from '@/lib/caps';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { RequestUsageStore } from '@/lib/usage';
import { MAX_VOICE_SECONDS, parseWav, transcribeWav } from '@/lib/transcribe';

export const maxDuration = 60;

// POST /api/transcribe — one voice note to text (PROMPT.md 4, G).
// Body: { audio } (base64 16 kHz mono 16-bit WAV from the browser).
// Server caps: size, per-minute rate, per-day count, 60-second duration.
// The transcript returns for the composer as EDITABLE text: the user
// reviews, then sends. Never auto-sent. Usage records duration cost
// ($0.18/hr) into the same table as model calls.
export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const audio = (body as { audio?: unknown }).audio;
  if (typeof audio !== 'string' || audio.length === 0) {
    return NextResponse.json({ error: 'Attach a voice note first.' }, { status: 400 });
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(audio, 'base64'));
  } catch {
    return NextResponse.json({ error: 'That recording did not come through. Try again.' }, { status: 400 });
  }
  if (bytes.length === 0) {
    return NextResponse.json({ error: 'That recording did not come through. Try again.' }, { status: 400 });
  }
  const info = parseWav(bytes);
  if (!info) {
    return NextResponse.json({ error: 'That is not a voice note I can read. Record again in the app.' }, { status: 400 });
  }
  if (info.seconds > MAX_VOICE_SECONDS) {
    return NextResponse.json({ error: 'Keep voice notes under 60 seconds.' }, { status: 400 });
  }
  let userId: string;
  try {
    ({ userId } = await resolveUser());
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'Give it a minute and try again.' }, { status: 503 });
    }
    throw err;
  }
  try {
    const limits = abuseLimitsFromEnv();
    const tooBig = checkUploadSize(bytes.length, limits);
    if (!tooBig.ok) {
      logCapRefusal(tooBig.detail);
      return NextResponse.json({ error: tooBig.message }, { status: 400 });
    }
    const db = await repo();
    const counters = supabaseCounterStore(adaptDb(supabaseAdmin()));
    const ip = clientIp(req);
    const hit = await checkHitRate(counters, ip, limits);
    if (!hit.ok) {
      logCapRefusal(hit.detail);
      return NextResponse.json({ error: hit.message }, { status: 429 });
    }
    const uploads = await checkUploadCount(counters, ip, limits);
    if (!uploads.ok) {
      logCapRefusal(uploads.detail);
      return NextResponse.json({ error: uploads.message }, { status: 429 });
    }

    const snapshot = await db.usage.snapshot(userId);
    const usageStore = new RequestUsageStore(snapshot.userSpend, snapshot.globalSpend);
    const budgetGuard = new BudgetGuard(usageStore, limitsFromEnv());
    try {
      budgetGuard.checkBeforeCall({ userId, model: 'muse-voice-transcribe-1.0', promptText: 'voice note transcription' });
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        return NextResponse.json({ error: budgetFriendlyMessage(err.scope) }, { status: 429 });
      }
      throw err;
    }
    const { text } = await transcribeWav(bytes, info);
    usageStore.add({
      userId,
      model: 'muse-voice-transcribe-1.0',
      promptTokens: 0,
      completionTokens: 0,
      costUsd: costForVoice(info.seconds),
      at: new Date().toISOString(),
    });
    await db.usage.flush(usageStore.pending(), `voice:${userId}:${Date.now()}`);
    return NextResponse.json({ transcript: text, seconds: info.seconds });
  } catch (err) {
    const ref = logServerError('transcribe', err);
    return NextResponse.json({ error: `I could not transcribe that. Try again in a moment. (ref ${ref})` }, { status: 502 });
  }
}
