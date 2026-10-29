import {
  ExtractionSchema,
  SAY_BUDGET_HIT,
  SAY_ON_IT,
  SAY_PAGE_WOULD_NOT_OPEN,
  BudgetExceededError,
  callModel,
  encodeSseEvent,
  formatFindingStatus,
  formatG1Prompt,
  formatReadingStatus,
  newRun,
  verifyExtractionEvidence,
  type PendingGate,
  type RunEvent,
} from '@mizzou/core';
import { anonId } from '@/lib/session';
import { runsStore } from '@/lib/runs';

export const maxDuration = 60;

function stripHtml(html: string): string {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function isUrl(text: string): string | null {
  const t = text.trim();
  try {
    const u = new URL(t.startsWith('http') ? t : `https://${t}`);
    if (u.hostname.includes('.')) return u.toString();
    return null;
  } catch {
    return null;
  }
}

const READER_PROMPT = (pageText: string, sourceUrl: string): string =>
  `Extract application facts from the page text below. Return ONLY one JSON object with EXACTLY this structure ` +
  `(all keys present; null or [] where nothing is found; never guess a date):\n` +
  `{"opportunity_type": one of [academic_program|job|fellowship|grant|competition|hackathon|scholarship|incubator|generic_opportunity] — classify what the page offers (a degree program, a job posting, a funding call, an event, or generic_opportunity when unclear),\n` +
  ` "program": {"name": EV_STR, "unit": EV_STR, "institution": EV_STR, "portal_url": string|null, "language_read": string},\n` +
  ` "opens": DATEFIELD|null,\n` +
  ` "deadlines": [{"label": string, "field": DATEFIELD}],\n` +
  ` "documents": [{"value": {"name": string, "limit": string|null, "optional": boolean}, "evidence_quote": string, "source_url": string, "confidence": CONF, "needs_human": boolean, "checked": boolean}],\n` +
  ` "eligibility": [{"value": {"rule": string, "hard": boolean}, "evidence_quote": string, "source_url": string, "confidence": CONF, "needs_human": boolean, "checked": boolean}],\n` +
  ` "people": [EV_STR], "tests": [EV_STR], "money": [EV_STR], "unusual_rules": [EV_STR]}\n` +
  `where EV_STR = {"value": string, "evidence_quote": string (max 400 chars, copied verbatim from the page text, must support the value), "source_url": string (always "${sourceUrl}"), "confidence": CONF, "needs_human": boolean, "checked": boolean},\n` +
  `CONF = "high"|"medium"|"low", and DATEFIELD = {"value": {"iso_utc": string|null (UTC as YYYY-MM-DDTHH:MM:SSZ), "original_tz": string|null, "all_day": boolean, "rolling": boolean}, "evidence_quote": string, "source_url": string, "confidence": CONF, "needs_human": boolean, "checked": boolean}.\n` +
  `PAGE TEXT:\n${pageText}`;

export async function POST(req: Request): Promise<Response> {
  let message = '';
  let chatId: string | null = null;
  try {
    const body: unknown = await req.json();
    if (typeof (body as { message?: unknown }).message === 'string') {
      message = (body as { message: string }).message;
    }
    if (typeof (body as { chatId?: unknown }).chatId === 'string') {
      chatId = (body as { chatId: string }).chatId;
    }
  } catch {
    message = '';
  }

  const runId = crypto.randomUUID();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (e: RunEvent): void => {
        controller.enqueue(enc.encode(encodeSseEvent(e)));
      };
      const fail = (friendly: string, link?: string): void => {
        send({ t: 'error', friendly, link });
        send({ t: 'done', runId });
        controller.close();
      };

      try {
        const url = isUrl(message);
        if (!url) {
          send({ t: 'message', id: crypto.randomUUID(), text: 'Send me a link to the opportunity and I\u2019ll read what they ask for.' });
          send({ t: 'done', runId });
          controller.close();
          return;
        }

        send({ t: 'message', id: crypto.randomUUID(), text: SAY_ON_IT });
        const statusId = crypto.randomUUID();
        send({ t: 'status', id: statusId, label: formatFindingStatus(url), state: 'active' });

        let pageText: string;
        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 Mizzou-chat-slice' },
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          pageText = stripHtml(await res.text()).slice(0, 60000);
        } catch {
          send({ t: 'status', id: statusId, label: formatFindingStatus(url), state: 'failed' });
          fail(SAY_PAGE_WOULD_NOT_OPEN, url);
          return;
        }
        send({ t: 'status', id: statusId, label: formatFindingStatus(url), state: 'done' });

        const readId = crypto.randomUUID();
        send({ t: 'status', id: readId, label: formatReadingStatus('generic_opportunity'), state: 'active' });
        let program: { name: string; unit: string; institution: string; portal_url: string | null };
        let opportunityType = 'generic_opportunity';
        // M4: move these card shapes into packages/core/src/schemas/ next to RunEvent.
        let requirements: {
          documents: Array<{ name: string; limit: string | null; optional: boolean; confidence: string; needs_human: boolean; evidence_quote: string; source_url: string }>;
          eligibility: Array<{ rule: string; hard: boolean; confidence: string; needs_human: boolean; evidence_quote: string; source_url: string }>;
        } | null = null;
        let plan: { title: string; deadlines: string[]; items: string[]; portalUrl: string | null } | null = null;
        let quickExtraction: unknown = null;
        try {
          const result = await callModel({
            role: 'reader',
            systemPrompt: 'You read one official admissions page into the extraction schema. Return only JSON matching the schema.',
            prompt: READER_PROMPT(pageText, url),
            schema: ExtractionSchema,
            temperature: 0,
            userId: 'guest',
            isGuest: true,
          });
          if (typeof result.data === 'string') {
            throw new Error('Unexpected text response from reader');
          }
          const checked = verifyExtractionEvidence(pageText, result.data);
          quickExtraction = checked;
          opportunityType = checked.opportunity_type;
          program = {
            name: checked.program.name.value,
            unit: checked.program.unit.value,
            institution: checked.program.institution.value,
            portal_url: checked.program.portal_url,
          };
          requirements = {
            documents: checked.documents.map((d) => ({
              name: d.value.name,
              limit: d.value.limit,
              optional: d.value.optional,
              confidence: d.confidence,
              needs_human: d.needs_human,
              evidence_quote: d.evidence_quote,
              source_url: d.source_url,
            })),
            eligibility: checked.eligibility.map((e) => ({
              rule: e.value.rule,
              hard: e.value.hard,
              confidence: e.confidence,
              needs_human: e.needs_human,
              evidence_quote: e.evidence_quote,
              source_url: e.source_url,
            })),
          };
          plan = {
            title: `${checked.program.name.value} application`,
            deadlines: checked.deadlines
              .map((d) => d.field.value.iso_utc)
              .filter((s): s is string => typeof s === 'string' && s.length > 0)
              .slice(0, 10),
            items: checked.documents.map((d) => d.value.name).slice(0, 50),
            portalUrl: checked.program.portal_url,
          };
        } catch (err) {
          send({ t: 'status', id: readId, label: formatReadingStatus('generic_opportunity'), state: 'failed' });
          if (err instanceof BudgetExceededError) {
            fail(SAY_BUDGET_HIT);
          } else {
            fail('Something went wrong on my side. Give it a minute and try again.');
          }
          return;
        }
        send({
          t: 'status',
          id: readId,
          label: formatReadingStatus(opportunityType, program.institution),
          state: 'done',
        });

        // The quick pass doubles as the G1 evidence. Persist the run with a
        // preset G1 gate; "Yes, that's it" resumes it into the deep scan and
        // the quick extraction seeds the reconcile (no second reader call).
        const userId = await anonId();
        const store = runsStore();
        const run = newRun(runId, userId, chatId);
        run.state = {
          programUrl: url,
          opportunityType,
          quickTitle: program.name,
          quickExtraction,
        };
        run.status = 'needs_approval';
        const g1Card = { kind: 'program', opportunity_type: opportunityType, ...program, source_url: url };
        const g1Gate: PendingGate = {
          gate: 'G1',
          what: formatG1Prompt(opportunityType),
          evidence: { card: g1Card },
          options: null,
        };
        run.pendingGate = g1Gate;
        await store.save(run);
        send({ t: 'message', id: crypto.randomUUID(), text: formatG1Prompt(opportunityType) });
        send({ t: 'needs_approval', gate: 'G1', card: g1Card });
        // Buffered by the client and shown only after the G1 "Yes" —
        // the deep scan and calendar writes still wait for approval.
        if (requirements) {
          send({ t: 'card', id: crypto.randomUUID(), kind: 'requirements', payload: requirements });
        }
        if (plan && plan.deadlines.length > 0) {
          send({ t: 'card', id: crypto.randomUUID(), kind: 'plan', payload: plan });
        }
        if (plan && plan.deadlines.length === 0) {
          send({
            t: 'card',
            id: crypto.randomUUID(),
            kind: 'rolling_notice',
            payload: {
              text: 'No fixed closing date found on this listing. Applications may be reviewed on a rolling basis.',
            },
          });
        }
        send({ t: 'done', runId });
        controller.close();
      } catch {
        fail('Something went wrong on my side. Give it a minute and try again.');
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
