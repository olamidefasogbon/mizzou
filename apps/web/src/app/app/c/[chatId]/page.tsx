'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowUp, Check, Download, Loader2, X } from 'lucide-react';
import { formatG1Prompt } from '@mizzou/core/voice';
import { Blobs } from '@/components/chrome';
import { useEvidence } from '@/components/evidence';
import { EvidenceOverlay } from '@/components/evidence-overlay';
import { ensureChatAction } from '@/lib/actions';

function g1Title(program: { name: string; unit: string; institution: string }, opportunityType?: string): {
  title: string;
  subtitle: string;
} {
  switch (opportunityType) {
    case 'job':
    case 'academic_program':
      return {
        title: program.name,
        subtitle: [program.institution, program.unit].filter(Boolean).join(' \u2022 '),
      };
    case 'grant':
    case 'scholarship':
    case 'competition':
    case 'hackathon':
    case 'fellowship':
    case 'incubator':
      return { title: program.name, subtitle: program.institution };
    default:
      return {
        title: program.name,
        subtitle: [program.unit, program.institution].filter(Boolean).join(', '),
      };
  }
}

type StatusState = 'active' | 'done' | 'failed';

interface RequirementDoc {
  name: string;
  limit: string | null;
  optional: boolean;
  confidence: string;
  needs_human: boolean;
  evidenceQuote?: string;
  sourceUrl?: string | null;
}

interface RequirementRule {
  rule: string;
  hard: boolean;
  confidence: string;
  needs_human: boolean;
  evidenceQuote?: string;
  sourceUrl?: string | null;
}

interface PlanPayload {
  title: string;
  deadlines: string[];
  items: string[];
  portalUrl: string | null;
}

interface G2Conflict {
  field: string;
  values: Array<{ iso: string | null; quote: string; source_url: string }>;
}

interface FeedItem {
  id: string;
  kind: 'user' | 'message' | 'status' | 'g1' | 'g2' | 'coverage' | 'requirements' | 'plan' | 'rolling' | 'error';
  text?: string;
  label?: string;
  state?: StatusState;
  program?: { name: string; unit: string; institution: string; portal_url: string | null };
  opportunity_type?: string;
  link?: string;
  decision?: 'yes' | 'no';
  resolved?: boolean;
  what?: string;
  conflicts?: G2Conflict[];
  lines?: string[];
  unreadable?: Array<{ url: string; reason: string }>;
  requirements?: { documents: RequirementDoc[]; eligibility: RequirementRule[] };
  plan?: PlanPayload;
  downloading?: boolean;
}

type ClientEvent =
  | { t: 'message'; id: string; text: string }
  | { t: 'status'; id: string; label: string; state: StatusState }
  | { t: 'needs_approval'; gate: string; card: unknown }
  | { t: 'card'; id: string; kind: string; payload: unknown }
  | { t: 'done'; runId?: string }
  | { t: 'continue'; runId: string }
  | { t: 'error'; friendly: string; link?: string };

function formatDay(iso: string): string {
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function needsLook(confidence: string, needsHuman: boolean): boolean {
  return needsHuman || confidence === 'low';
}

function ChatContent(): React.JSX.Element {
  const params = useParams<{ chatId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatId = params.chatId;
  // Handoff from the home composer (?q=). Consumed once, then stripped.
  const initialQ = searchParams.get('q');
  const sentInitial = useRef(false);
  const [feed, setFeed] = useState<FeedItem[]>([
    {
      id: 'hello',
      kind: 'message',
      text: 'Send me a link to the opportunity and I\u2019ll read what they ask for.',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  // Cards streamed with the run stay hidden until the G1 "Yes" —
  // the deep scan still waits for approval.
  const [pendingCards, setPendingCards] = useState<{
    requirements?: { documents: RequirementDoc[]; eligibility: RequirementRule[] };
    plan?: PlanPayload;
    rolling?: { text: string };
  } | null>(null);

  const patch = useCallback((id: string, update: Partial<FeedItem>): void => {
    setFeed((prev) => prev.map((item) => (item.id === id ? { ...item, ...update } : item)));
  }, []);

  const downloadPlan = useCallback(
    async (itemId: string, plan: PlanPayload): Promise<void> => {
      patch(itemId, { downloading: true });
      try {
        const res = await fetch('/api/calendar/ics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: plan.title,
            deadlines: plan.deadlines,
            items: plan.items,
            portalUrl: plan.portalUrl,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mizzou-deadlines.ics';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        setFeed((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            kind: 'error',
            text: 'Could not build the calendar file. Give it a minute and try again.',
          },
        ]);
      } finally {
        patch(itemId, { downloading: false });
      }
    },
    [patch],
  );

  const runIdRef = useRef<string | null>(null);
  const g1YesRef = useRef(false);
  const streamsRef = useRef(0);
  const enterStream = useCallback((): void => {
    streamsRef.current += 1;
    setBusy(true);
  }, []);
  const leaveStream = useCallback((): void => {
    streamsRef.current = Math.max(0, streamsRef.current - 1);
    if (streamsRef.current === 0) setBusy(false);
  }, []);
  const handleEventRef = useRef<(event: ClientEvent) => void>(() => {});
  const resumeRef = useRef<(body: Record<string, unknown>) => Promise<void>>(async () => {});

  const pump = useCallback(async (res: Response): Promise<void> => {
    if (!res.body) throw new Error('Empty stream.');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          handleEventRef.current(JSON.parse(line.slice(5).trim()) as ClientEvent);
        }
      }
    }
  }, []);

  handleEventRef.current = (event: ClientEvent): void => {
    if (event.t === 'message') {
      setFeed((prev) => {
        const existing = prev.find((item) => item.id === event.id);
        if (existing) {
          return prev.map((item) =>
            item.id === event.id ? { ...item, text: `${item.text ?? ''}${event.text}` } : item,
          );
        }
        return [...prev, { id: event.id, kind: 'message', text: event.text }];
      });
    } else if (event.t === 'status') {
      setFeed((prev) => {
        if (prev.some((item) => item.id === event.id)) {
          return prev.map((item) =>
            item.id === event.id ? { ...item, label: event.label, state: event.state } : item,
          );
        }
        return [...prev, { id: event.id, kind: 'status', label: event.label, state: event.state }];
      });
    } else if (event.t === 'needs_approval') {
      const card = (event.card ?? {}) as {
        kind?: string;
        opportunity_type?: string;
        name?: string;
        unit?: string;
        institution?: string;
        portal_url?: string | null;
        what?: string;
        conflicts?: G2Conflict[];
      };
      if (event.gate === 'G1' && card.kind === 'program') {
        setFeed((prev) => [
          ...prev,
          {
            id: `g1-${Date.now()}`,
            kind: 'g1',
            program: {
              name: card.name ?? 'Unknown program',
              unit: card.unit ?? '',
              institution: card.institution ?? '',
              portal_url: card.portal_url ?? null,
            },
            opportunity_type: typeof card.opportunity_type === 'string' ? card.opportunity_type : undefined,
          },
        ]);
      } else if (event.gate === 'G2' && Array.isArray(card.conflicts)) {
        setFeed((prev) => [
          ...prev,
          {
            id: `g2-${Date.now()}`,
            kind: 'g2',
            what: typeof card.what === 'string' ? card.what : undefined,
            conflicts: card.conflicts as G2Conflict[],
          },
        ]);
      }
    } else if (event.t === 'card') {
      const payload = (event.payload ?? {}) as {
        documents?: Array<RequirementDoc & { evidence_quote?: string; source_url?: string }>;
        eligibility?: Array<RequirementRule & { evidence_quote?: string; source_url?: string }>;
        title?: string;
        deadlines?: string[];
        items?: string[];
        portalUrl?: string | null;
        text?: string;
        lines?: string[];
        unreadable?: Array<{ url: string; reason: string }>;
      };
      const toDoc = (d: RequirementDoc & { evidence_quote?: string; source_url?: string }): RequirementDoc => ({
        ...d,
        evidenceQuote: typeof d.evidence_quote === 'string' ? d.evidence_quote : undefined,
        sourceUrl: typeof d.source_url === 'string' ? d.source_url : null,
      });
      const toRule = (e: RequirementRule & { evidence_quote?: string; source_url?: string }): RequirementRule => ({
        ...e,
        evidenceQuote: typeof e.evidence_quote === 'string' ? e.evidence_quote : undefined,
        sourceUrl: typeof e.source_url === 'string' ? e.source_url : null,
      });
      if (event.kind === 'requirements' && Array.isArray(payload.documents) && Array.isArray(payload.eligibility)) {
        const built = {
          documents: (payload.documents ?? []).map(toDoc),
          eligibility: (payload.eligibility ?? []).map(toRule),
        };
        if (g1YesRef.current) {
          const id = `req-${Date.now()}`;
          setFeed((prev) => [...prev, { id, kind: 'requirements', requirements: built }]);
        } else {
          setPendingCards((prev) => ({ ...(prev ?? {}), requirements: built }));
        }
      } else if (
        event.kind === 'plan' &&
        typeof payload.title === 'string' &&
        Array.isArray(payload.deadlines) &&
        Array.isArray(payload.items)
      ) {
        const built: PlanPayload = {
          title: payload.title as string,
          deadlines: payload.deadlines as string[],
          items: payload.items as string[],
          portalUrl: typeof payload.portalUrl === 'string' ? payload.portalUrl : null,
        };
        if (g1YesRef.current) {
          const id = `plan-${Date.now()}`;
          setFeed((prev) => [...prev, { id, kind: 'plan', plan: built }]);
        } else {
          setPendingCards((prev) => ({ ...(prev ?? {}), plan: built }));
        }
      } else if (event.kind === 'rolling_notice' && typeof payload.text === 'string') {
        if (g1YesRef.current) {
          const id = `rolling-${Date.now()}`;
          setFeed((prev) => [...prev, { id, kind: 'rolling', text: payload.text as string }]);
        } else {
          setPendingCards((prev) => ({ ...(prev ?? {}), rolling: { text: payload.text as string } }));
        }
      } else if (event.kind === 'coverage' && Array.isArray(payload.lines)) {
        setFeed((prev) => [
          ...prev,
          {
            id: `coverage-${Date.now()}`,
            kind: 'coverage',
            lines: payload.lines as string[],
            unreadable: Array.isArray(payload.unreadable) ? payload.unreadable : [],
          },
        ]);
      }
    } else if (event.t === 'done') {
      if (typeof event.runId === 'string') runIdRef.current = event.runId;
    } else if (event.t === 'continue') {
      runIdRef.current = event.runId;
      void resumeRef.current({ opId: crypto.randomUUID() });
    } else if (event.t === 'error') {
      setFeed((prev) => [...prev, { id: `err-${Date.now()}`, kind: 'error', text: event.friendly, link: event.link }]);
    }
  };

  resumeRef.current = async (body: Record<string, unknown>): Promise<void> => {
    const id = runIdRef.current;
    if (!id) return;
    enterStream();
    try {
      const res = await fetch(`/api/runs/${id}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pump(res);
    } catch {
      setFeed((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, kind: 'error', text: 'Something went wrong on my side. Give it a minute and try again.' },
      ]);
    } finally {
      leaveStream();
      feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
    }
  };

  const sendText = useCallback(
    async (raw: string): Promise<void> => {
      const text = raw.trim();
      if (!text || busy) return;
      setInput('');
    enterStream();
    const userId = `user-${Date.now()}`;
    setFeed((prev) => [...prev, { id: userId, kind: 'user', text }]);
    setPendingCards(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, chatId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pump(res);
    } catch {
      setFeed((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, kind: 'error', text: 'Something went wrong on my side. Give it a minute and try again.' },
      ]);
    } finally {
      leaveStream();
      feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
    }
    },
    [busy, chatId, enterStream, leaveStream, pump],
  );

  const send = useCallback((): void => {
    void sendText(input);
  }, [input, sendText]);

  // Home-composer handoff: submit ?q= once, then strip it so a refresh
  // cannot resend.
  useEffect(() => {
    if (!initialQ || sentInitial.current) return;
    sentInitial.current = true;
    router.replace(`/app/c/${chatId}`, { scroll: false });
    void ensureChatAction(chatId, initialQ);
    void sendText(initialQ);
  }, [initialQ, chatId, router, sendText]);

  const { select, clear } = useEvidence();

  // The overlay belongs to one chat: changing chats closes it.
  useEffect(() => {
    clear();
  }, [chatId, clear]);

  return (
    <div className="relative z-[1] flex w-full flex-1 flex-col px-4 pb-6 pt-[116px] text-black">
      <Blobs
        specs={[
          { top: -80, right: -100, size: 300, color: 'var(--mz-blob-1)', blur: 60 },
          { top: 300, left: -120, size: 280, color: 'var(--mz-blob-2)', blur: 60 },
          { bottom: 200, right: -110, size: 320, color: 'var(--mz-blob-3)', blur: 70 },
        ]}
      />
        <div ref={feedRef} className="flex flex-1 flex-col gap-3 overflow-y-auto pb-4">
          {feed.map((item) => {
            if (item.kind === 'user') {
              return (
                <div key={item.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl bg-black/[0.07] px-4 py-2.5 text-[15px]">{item.text}</div>
                </div>
              );
            }
            if (item.kind === 'message') {
              return (
                <div key={item.id} className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-[15px] shadow-sm">
                    {item.text}
                  </div>
                </div>
              );
            }
            if (item.kind === 'status') {
              return (
                <div key={item.id} className="flex items-center gap-2 px-1 text-sm text-[#3A3A3A]">
                  {item.state === 'active' && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-label="working" />}
                  {item.state === 'done' && <Check className="h-4 w-4 text-green-700" aria-label="done" />}
                  {item.state === 'failed' && <X className="h-4 w-4 text-red-700" aria-label="failed" />}
                  <span>{item.label}</span>
                </div>
              );
            }
            if (item.kind === 'g1' && item.program) {
              const heading = g1Title(item.program, item.opportunity_type);
              return (
                <div key={item.id} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
                  <p className="text-[13px] font-medium text-[#3A3A3A]">{formatG1Prompt(item.opportunity_type ?? 'generic_opportunity')}</p>
                  <p className="mt-2 text-lg font-bold">{heading.title}</p>
                  {heading.subtitle.length > 0 && (
                    <p className="text-sm text-[#3A3A3A]">{heading.subtitle}</p>
                  )}
                  {item.decision === undefined && (
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          patch(item.id, { decision: 'yes' });
                          g1YesRef.current = true;
                          void resumeRef.current({ gate: 'G1', decision: { confirmed: true }, opId: crypto.randomUUID() });
                          setFeed((prev) => {
                            const extra: FeedItem[] = [];
                            if (pendingCards?.requirements) {
                              extra.push({
                                id: `req-${Date.now()}`,
                                kind: 'requirements',
                                requirements: pendingCards.requirements,
                              });
                            }
                            if (pendingCards?.plan) {
                              extra.push({ id: `plan-${Date.now()}`, kind: 'plan', plan: pendingCards.plan });
                            }
                            if (pendingCards?.rolling) {
                              extra.push({ id: `rolling-${Date.now()}`, kind: 'rolling', text: pendingCards.rolling.text });
                            }
                            return [...prev, ...extra];
                          });
                          setPendingCards(null);
                        }}
                        className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white"
                      >
                        Yes, that&apos;s it
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          patch(item.id, { decision: 'no' });
                          setPendingCards(null);
                          void resumeRef.current({ gate: 'G1', decision: { confirmed: false }, opId: crypto.randomUUID() });
                        }}
                        className="rounded-full bg-black/[0.07] px-4 py-2 text-sm font-medium text-black"
                      >
                        Not quite
                      </button>
                    </div>
                  )}
                  {item.decision === 'yes' && (
                    <div className="mt-3 rounded-xl bg-black/[0.04] p-3">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        <Check className="h-4 w-4 text-green-700" /> Confirmed. Here&apos;s what they ask for.
                      </p>
                    </div>
                  )}
                  {item.decision === 'no' && (
                    <p className="mt-3 text-sm text-[#3A3A3A]">No problem — paste a different link and I&apos;ll check that one.</p>
                  )}
                </div>
              );
            }
            if (item.kind === 'g2' && item.conflicts) {
              return (
                <div key={item.id} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium">{item.what ?? 'Two official pages disagree. Which one looks right to you?'}</p>
                  <ul className="mt-2 space-y-2">
                    {item.conflicts.map((c, i) => (
                      <li key={i} className="text-[13px] text-[#3A3A3A]">
                        <span className="font-medium text-black">{c.field}</span>
                        <ul className="mt-1 space-y-1">
                          {c.values.map((v, j) => (
                            <li key={j}>
                              {v.iso ?? 'no date'} ·{' '}
                              <a href={v.source_url} target="_blank" rel="noreferrer" className="underline underline-offset-[3px]">
                                source
                              </a>
                              <span className="block italic">“{v.quote.slice(0, 140)}”</span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                  {item.resolved !== true && (
                    <button
                      type="button"
                      onClick={() => {
                        patch(item.id, { resolved: true });
                        void resumeRef.current({ gate: 'G2', decision: { useBest: true }, opId: crypto.randomUUID() });
                      }}
                      className="mt-3 rounded-full bg-black px-4 py-2 text-sm font-medium text-white"
                    >
                      Continue with your best read
                    </button>
                  )}
                </div>
              );
            }
            if (item.kind === 'coverage' && item.lines) {
              return (
                <div key={item.id} className="rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-[15px] shadow-sm">
                  {item.lines.map((line, i) => (
                    <p key={i} className={i > 0 ? 'mt-1' : undefined}>
                      {line}
                    </p>
                  ))}
                  {(item.unreadable ?? []).map((u) => (
                    <a key={u.url} href={u.url} target="_blank" rel="noreferrer" className="mt-1 block text-sm underline">
                      Open the page
                    </a>
                  ))}
                </div>
              );
            }
            if (item.kind === 'requirements' && item.requirements) {
              const flagged = [...item.requirements.documents, ...item.requirements.eligibility].filter((f) =>
                needsLook(f.confidence, f.needs_human),
              ).length;
              return (
                <div key={item.id} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium">What they ask for</p>
                  {item.requirements.documents.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[13px] font-medium text-[#3A3A3A]">Documents</p>
                      <ul className="mt-1 space-y-1.5">
                        {item.requirements.documents.map((d, i) => {
                          return (
                            <li key={i} className="flex items-start gap-2 text-[15px]">
                              {needsLook(d.confidence, d.needs_human) ? (
                                <span aria-label="needs a look" className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-600">
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                                    <path d="M12 5v10M12 19v0.5" />
                                  </svg>
                                </span>
                              ) : (
                                <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-label="clear" />
                              )}
                              <span>
                                {d.name}
                                {d.limit ? <span className="text-[#3A3A3A]"> · {d.limit}</span> : null}
                                {d.optional ? <span className="text-[#3A3A3A]"> · optional</span> : null}
                                {d.evidenceQuote ? (
                                  <span className="block">
                                    <button
                                      type="button"
                                      className="text-[13px] text-black underline underline-offset-[3px]"
                                      onClick={() => {
                                        select({ title: d.name, quote: d.evidenceQuote as string, sourceUrl: d.sourceUrl ?? null });
                                      }}
                                    >
                                      Where I found this
                                    </button>
                                  </span>
                                ) : null}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {item.requirements.eligibility.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[13px] font-medium text-[#3A3A3A]">Eligibility</p>
                      <ul className="mt-1 space-y-1.5">
                        {item.requirements.eligibility.map((e, i) => {
                          return (
                            <li key={i} className="flex items-start gap-2 text-[15px]">
                              {needsLook(e.confidence, e.needs_human) ? (
                                <span aria-label="needs a look" className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-600">
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                                    <path d="M12 5v10M12 19v0.5" />
                                  </svg>
                                </span>
                              ) : (
                                <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-label="clear" />
                              )}
                              <span>
                                {e.rule}
                                {e.evidenceQuote ? (
                                  <span className="block">
                                    <button
                                      type="button"
                                      className="text-[13px] text-black underline underline-offset-[3px]"
                                      onClick={() => {
                                        select({ title: e.rule, quote: e.evidenceQuote as string, sourceUrl: e.sourceUrl ?? null });
                                      }}
                                    >
                                      Where I found this
                                    </button>
                                  </span>
                                ) : null}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {flagged > 0 && (
                    <p className="mt-2 text-[13px] text-[#3A3A3A]">
                      {flagged} {flagged === 1 ? 'item needs' : 'items need'} a look — the page wasn&apos;t clear there.
                    </p>
                  )}
                </div>
              );
            }
            if (item.kind === 'plan' && item.plan && (item.plan.deadlines.length > 0 || item.plan.items.length > 0)) {
              const plan = item.plan;
              return (
                <div key={item.id} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium">Here&apos;s the plan. Nothing goes on your calendar until you say so.</p>
                  {plan.deadlines.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {plan.deadlines.map((iso, i) => (
                        <li key={i} className="flex items-baseline justify-between gap-2 text-[15px]">
                          <span>Deadline</span>
                          <span className="font-medium">{formatDay(iso)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {plan.items.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {plan.items.map((task, i) => (
                        <li key={i} className="text-[15px] text-[#3A3A3A]">
                          · {task}
                        </li>
                      ))}
                    </ul>
                  )}
                  {plan.deadlines.length > 0 && (
                    <button
                      type="button"
                      disabled={item.downloading === true}
                      onClick={() => {
                        if (item.plan) void downloadPlan(item.id, item.plan);
                      }}
                      className="mt-3 flex items-center gap-1.5 rounded-full bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-30"
                    >
                      {item.downloading === true ? (
                        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-label="working" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      Download .ics
                    </button>
                  )}
                </div>
              );
            }
            if (item.kind === 'rolling' && item.text) {
              return (
                <div key={item.id} className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl border border-black/10 bg-white px-4 py-2.5 shadow-sm">
                    <span className="inline-block rounded-full bg-black/[0.07] px-3 py-1 text-[13px] font-medium">
                      Rolling / Unspecified Deadline
                    </span>
                    <p className="mt-1.5 text-sm text-[#3A3A3A]">{item.text}</p>
                  </div>
                </div>
              );
            }
            return (
              <div key={item.id} className="rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-[15px]">
                <p>{item.text}</p>
                {item.link && (
                  <a href={item.link} target="_blank" rel="noreferrer" className="mt-1 block text-sm underline">
                    Open the page
                  </a>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 rounded-full border border-black/10 bg-white p-2 pl-4 shadow-sm">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send();
            }}
            placeholder="Message Mizzou"
            aria-label="Message Mizzou"
            className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#3A3A3A]"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || input.trim().length === 0}
            aria-label="Send"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black text-white disabled:opacity-30"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
        <EvidenceOverlay />
    </div>
  );
}

export default function ConversationPage(): React.JSX.Element {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-neutral-500">Loading chat...</div>}>
      <ChatContent />
    </Suspense>
  );
}
