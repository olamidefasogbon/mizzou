import { NextResponse } from 'next/server';
import { BudgetGuard, limitsFromEnv, readImageExtraction } from '@mizzou/core';
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
import { parseImageDataUrl, sniffImageType, uploadIdFromBytes } from '@/lib/upload';

export const maxDuration = 60;

// POST /api/upload — one flyer or screenshot for the vision role.
// Body: { dataUrl, name }. The client downscales to 1600px on the long
// side before sending; the server enforces size, type (magic bytes) and
// rate/count caps, then reads the image into the SAME extraction schema
// (vision role, evidence quotes from the image text, never invented
// dates). Nothing is accepted: the extraction returns to the client and
// enters the chat as a seed for the normal G1 program card.
export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const dataUrl = (body as { dataUrl?: unknown }).dataUrl;
  const rawName = (body as { name?: unknown }).name;
  if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
    return NextResponse.json({ error: 'Attach a PNG, JPEG or WebP image.' }, { status: 400 });
  }
  const name = typeof rawName === 'string' ? rawName.slice(0, 120) : 'upload';
  let userId: string;
  try {
    ({ userId } = await resolveUser());
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ error: 'Give it a minute and try again.' }, { status: 503 });
    }
    throw err;
  }

  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) {
    return NextResponse.json({ error: 'Attach a PNG, JPEG or WebP image.' }, { status: 400 });
  }
  const limits = abuseLimitsFromEnv();
  const tooBig = checkUploadSize(parsed.bytes.length, limits);
  if (!tooBig.ok) {
    logCapRefusal(tooBig.detail);
    return NextResponse.json({ error: tooBig.message }, { status: 400 });
  }
  if (!sniffImageType(parsed.bytes)) {
    return NextResponse.json({ error: 'That file is not a PNG, JPEG or WebP image.' }, { status: 400 });
  }
  try {
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

    const uploadId = uploadIdFromBytes(parsed.bytes);
    const snapshot = await db.usage.snapshot(userId);
    const usageStore = new RequestUsageStore(snapshot.userSpend, snapshot.globalSpend);
    const budgetGuard = new BudgetGuard(usageStore, limitsFromEnv());
    try {
      const read = await readImageExtraction({
        name,
        sourceUrl: `upload:${uploadId}`,
        dataUrl,
        userId,
        budgetGuard,
      });
      await db.usage.flush(usageStore.pending(), `upload:${uploadId}`);
      return NextResponse.json({ uploadId, name, extraction: read.extraction });
    } catch (err) {
      try {
        await db.usage.flush(usageStore.pending(), `upload:${uploadId}`);
      } catch {
        // Usage flush is best-effort; the friendly error below matters.
      }
      throw err;
    }
  } catch (err) {
    const ref = logServerError('upload', err);
    return NextResponse.json({ error: `I could not read that image. Give it a minute and try again. (ref ${ref})` }, { status: 502 });
  }
}
