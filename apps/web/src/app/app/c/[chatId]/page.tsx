'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowUp, Check, Download, Loader2, X } from 'lucide-react';
import { formatG1Prompt } from '@mizzou/core';
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

interface FeedItem {
  id: string;
  kind: 'user' | 'message' | 'status' | 'g1' | 'requirements' | 'plan' | 'rolling' | 'error';
  text?: string;
  label?: string;
  state?: StatusState;
  program?: { name: string; unit: string; institution: string; portal_url: string | null };
  opportunity_type?: string;
  link?: string;
  decision?: 'yes' | 'no';
  requirements?: { documents: RequirementDoc[]; eligibility: RequirementRule[] };
  plan?: PlanPayload;
  downloading?: boolean;
}

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

  const sendText = useCallback(
    async (raw: string): Promise<void> => {
      const text = raw.trim();
      if (!text || busy) return;
      setInput('');
    setBusy(true);
    const userId = `user-${Date.now()}`;
    setFeed((prev) => [...prev, { id: userId, kind: 'user', text }]);
    setPendingCards(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, chatId }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
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
            const event = JSON.parse(line.slice(5).trim()) as
              | { t: 'message'; id: string; text: string }
              | { t: 'status'; id: string; label: string; state: StatusState }
              | { t: 'needs_approval'; gate: string; card: unknown }
              | { t: 'card'; id: string; kind: string; payload: unknown }
              | { t: 'done' }
              | { t: 'error'; friendly: string; link?: string };
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
                setPendingCards((prev) => ({
                  ...(prev ?? {}),
                  requirements: {
                    documents: (payload.documents ?? []).map(toDoc),
                    eligibility: (payload.eligibility ?? []).map(toRule),
                  },
                }));
              } else if (
                event.kind === 'plan' &&
                typeof payload.title === 'string' &&
                Array.isArray(payload.deadlines) &&
                Array.isArray(payload.items)
              ) {
                setPendingCards((prev) => ({
                  ...(prev ?? {}),
                  plan: {
                    title: payload.title as string,
                    deadlines: payload.deadlines as string[],
                    items: payload.items as string[],
                    portalUrl: typeof payload.portalUrl === 'string' ? payload.portalUrl : null,
                  },
                }));
              } else if (event.kind === 'rolling_notice' && typeof payload.text === 'string') {
                setPendingCards((prev) => ({ ...(prev ?? {}), rolling: { text: payload.text as string } }));
              }
            } else if (event.t === 'error') {
              setFeed((prev) => [...prev, { id: `err-${Date.now()}`, kind: 'error', text: event.friendly, link: event.link }]);
            }
          }
        }
      }
    } catch {
      setFeed((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, kind: 'error', text: 'Something went wrong on my side. Give it a minute and try again.' },
      ]);
    } finally {
      setBusy(false);
      feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
    }
    },
    [busy, chatId],
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
