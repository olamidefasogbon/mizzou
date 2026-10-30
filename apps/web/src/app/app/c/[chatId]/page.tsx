'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowUp, Check, ChevronDown, Download, Loader2, X } from 'lucide-react';
import { formatG1Prompt } from '@mizzou/core/voice';
import { useEvidence } from '@/components/evidence';
import { EvidenceOverlay } from '@/components/evidence-overlay';
import { ensureChatAction } from '@/lib/actions';
import { useStore } from '@/components/store-context';
import { isTightGroup, messageBubble, statusRun, statusRunHead } from './feed';
import styles from './conversation.module.css';

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
  approving?: boolean;
  approved?: boolean;
  planError?: string;
}

type ClientEvent =
  | { t: 'message'; id: string; text: string }
  | { t: 'status'; id: string; label: string; state: StatusState }
  | { t: 'needs_approval'; gate: string; card: unknown }
  | { t: 'card'; id: string; kind: string; payload: unknown }
  | { t: 'done'; runId?: string }
  | { t: 'continue'; runId: string }
  | { t: 'error'; friendly: string; link?: string };

/**
 * User-local date first, original zone muted. Stored deadlines are UTC
 * instants, so the muted zone reads UTC; date-only values show the date
 * alone with no zone guess. (Replaces the old day-only formatter.)
 */
function formatDeadline(iso: string): { main: string; sub: string | null } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { main: iso, sub: null };
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const hasTime = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
  if (!hasTime) return { main: date, sub: null };
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return { main: `${date}, ${time}`, sub: 'UTC' };
}

function needsLook(confidence: string, needsHuman: boolean): boolean {
  return needsHuman || confidence === 'low';
}

// One compact row for a run of consecutive tool-status events: a spinner
// while any step is active, then a one-line summary that expands on tap
// into the per-step list. Each status id renders once — never repeated.
function ToolSteps({ items, grouped }: { items: Array<{ id: string; label?: string; state?: StatusState }>; grouped: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const activeItem = items.find((entry) => entry.state === 'active');
  const doneCount = items.filter((entry) => entry.state === 'done').length;
  const summary = activeItem
    ? (activeItem.label ?? 'Working')
    : `Finished ${items.length} step${items.length === 1 ? '' : 's'}`;
  return (
    <div className={grouped ? `${styles.toolSteps} ${styles.gapGroup}` : styles.toolSteps}>
      <button
        type="button"
        className={styles.toolHead}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {activeItem ? (
          <Loader2 className={styles.spin} aria-label="working" />
        ) : (
          <Check className={styles.checkIcon} aria-label="done" />
        )}
        <span className={styles.toolSummary}>{summary}</span>
        {doneCount > 0 && activeItem ? <span className={styles.toolCount}>{doneCount} done</span> : null}
        <ChevronDown
          className={open ? `${styles.toolChevron} ${styles.toolChevronOpen}` : styles.toolChevron}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <ul className={styles.toolList}>
          {items.map((entry) => (
            <li key={entry.id} className={styles.toolStep}>
              {entry.state === 'active' && <Loader2 className={styles.spin} aria-label="working" />}
              {entry.state === 'done' && <Check className={styles.checkIcon} aria-label="done" />}
              {entry.state === 'failed' && <X className={styles.failIcon} aria-label="failed" />}
              <span>{entry.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ChatContent(): React.JSX.Element {
  const params = useParams<{ chatId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatId = params.chatId;
  // Handoff from the home composer (?q=). Consumed once, then stripped.
  const initialQ = searchParams.get('q');
  const sentInitial = useRef(false);
  // No canned opener: every assistant line comes from the model (AGENT_BRAIN).
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const { refreshChats } = useStore();
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
      patch(itemId, { downloading: true, planError: undefined });
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
        if (!res.ok) {
          let detail = 'Could not build the calendar file. Give it a minute and try again.';
          try {
            const data = (await res.json()) as { error?: unknown };
            if (typeof data.error === 'string') detail = data.error;
          } catch {
            // Keep the default text when the body is not JSON.
          }
          throw new Error(detail);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mizzou-deadlines.ics';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        patch(itemId, {
          planError: err instanceof Error ? err.message : 'Could not build the calendar file. Give it a minute and try again.',
        });
      } finally {
        patch(itemId, { downloading: false });
      }
    },
    [patch],
  );

  const approvePlan = useCallback(
    async (itemId: string, plan: PlanPayload): Promise<void> => {
      patch(itemId, { approving: true, planError: undefined });
      try {
        const res = await fetch('/api/reminders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: plan.title, deadlines: plan.deadlines, items: plan.items }),
        });
        if (!res.ok) {
          let detail = 'Could not sync reminders. Give it a minute and try again.';
          try {
            const data = (await res.json()) as { error?: unknown };
            if (typeof data.error === 'string') detail = data.error;
          } catch {
            // Keep the default text when the body is not JSON.
          }
          throw new Error(detail);
        }
        patch(itemId, { approved: true });
      } catch (err) {
        patch(itemId, {
          planError: err instanceof Error ? err.message : 'Could not sync reminders. Give it a minute and try again.',
        });
      } finally {
        patch(itemId, { approving: false });
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
      // One bubble per assistant message, in arrival order (see feed.ts).
      setFeed((prev) => {
        const { id, append } = messageBubble(prev, event.id);
        if (append) {
          return prev.map((item, index) =>
            index === prev.length - 1 ? { ...item, text: `${item.text ?? ''}${event.text}` } : item,
          );
        }
        return [...prev, { id, kind: 'message', text: event.text }];
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
        body: JSON.stringify({ message: text, chatId, runId: runIdRef.current ?? undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pump(res);
      try {
        // Pull the server-generated title (and any list changes) into the panel.
        await refreshChats();
      } catch {
        // The panel keeps its optimistic row; titles refresh on next visit.
      }
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
    [busy, chatId, enterStream, leaveStream, pump, refreshChats],
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

  // Same-sender bubbles sit 4px apart (the feed gap); a new group gets
  // 12px (see feed.ts isTightGroup).
  const tight = (index: number): boolean => isTightGroup(feed, index);

  return (
    <div className={styles.screen}>
        <div ref={feedRef} className={styles.feed}>
          {feed.map((item, i) => {
            if (item.kind === 'user') {
              return (
                <div key={item.id} className={tight(i) ? styles.userRow : `${styles.userRow} ${styles.gapGroup}`}>
                  <div className={styles.userBubble}>{item.text}</div>
                </div>
              );
            }
            if (item.kind === 'message') {
              return (
                <div key={item.id} className={tight(i) ? styles.assistantRow : `${styles.assistantRow} ${styles.gapGroup}`}>
                  <p className={styles.assistantText}>{item.text}</p>
                </div>
              );
            }
            if (item.kind === 'status') {
              // Only the head of a consecutive run renders; the run
              // collapses into one compact row (see feed.ts).
              if (!statusRunHead(feed, i)) return null;
              return <ToolSteps key={`tools-${item.id}`} items={statusRun(feed, i)} grouped={i > 0} />;
            }
            if (item.kind === 'g1' && item.program) {
              const heading = g1Title(item.program, item.opportunity_type);
              return (
                <div key={item.id} className={`${styles.card} ${styles.gapGroup}`}>
                  <p className={styles.cardPrompt}>{formatG1Prompt(item.opportunity_type ?? 'generic_opportunity')}</p>
                  <p className={styles.cardTitle}>{heading.title}</p>
                  {heading.subtitle.length > 0 && (
                    <p className={styles.cardSub}>{heading.subtitle}</p>
                  )}
                  {item.decision === undefined && (
                    <div className={styles.btnRow}>
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
                        className={styles.btnPrimary}
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
                        className={styles.btnSecondary}
                      >
                        Not quite
                      </button>
                    </div>
                  )}
                  {item.decision === 'yes' && (
                    <div className={styles.g1Done}>
                      <p className={styles.g1DoneText}>
                        <Check className={styles.checkIcon} aria-label="confirmed" /> Confirmed. Here&apos;s what they ask for.
                      </p>
                    </div>
                  )}
                  {item.decision === 'no' && (
                    <p className={styles.g1No}>No problem — paste a different link and I&apos;ll check that one.</p>
                  )}
                </div>
              );
            }
            if (item.kind === 'g2' && item.conflicts) {
              return (
                <div key={item.id} className={`${styles.card} ${styles.gapGroup}`}>
                  <p className={styles.cardPrompt}>{item.what ?? 'Two official pages disagree. Which one looks right to you?'}</p>
                  <ul className={styles.conflictValues}>
                    {item.conflicts.map((c, i) => (
                      <li key={i} className={styles.cardSub}>
                        <span className={styles.conflictField}>{c.field}</span>
                        <ul className={styles.conflictValues}>
                          {c.values.map((v, j) => (
                            <li key={j}>
                              {v.iso ?? 'no date'} ·{' '}
                              <a href={v.source_url} target="_blank" rel="noreferrer" className={styles.link}>
                                source
                              </a>
                              <span className={styles.conflictQuote}>“{v.quote.slice(0, 140)}”</span>
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
                      className={`${styles.btnPrimary} ${styles.icsBtn}`}
                    >
                      Continue with your best read
                    </button>
                  )}
                </div>
              );
            }
            if (item.kind === 'coverage' && item.lines) {
              return (
                <div key={item.id} className={`${styles.card} ${styles.gapGroup}`}>
                  {item.lines.map((line, i) => (
                    <p key={i} className={styles.coverageLine}>
                      {line}
                    </p>
                  ))}
                  {(item.unreadable ?? []).map((u) => (
                    <a key={u.url} href={u.url} target="_blank" rel="noreferrer" className={`${styles.link} ${styles.coverageOpen}`}>
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
                <div key={item.id} className={`${styles.card} ${styles.gapGroup}`}>
                  <p className={styles.cardPrompt}>What they ask for</p>
                  {item.requirements.documents.length > 0 && (
                    <div className={styles.mt2}>
                      <p className={styles.sectionTitle}>Documents</p>
                      <ul className={styles.reqList}>
                        {item.requirements.documents.map((d, i) => {
                          return (
                            <li key={i} className={styles.reqItem}>
                              {needsLook(d.confidence, d.needs_human) ? (
                                <span aria-label="needs a look" className={styles.warnBadge}>
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                                    <path d="M12 5v10M12 19v0.5" />
                                  </svg>
                                </span>
                              ) : (
                                <Check className={styles.checkIcon} aria-label="clear" />
                              )}
                              <span>
                                {d.name}
                                {d.limit ? <span className={styles.reqDetail}> · {d.limit}</span> : null}
                                {d.optional ? <span className={styles.reqDetail}> · optional</span> : null}
                                {d.evidenceQuote ? (
                                  <span className={styles.block}>
                                    <button
                                      type="button"
                                      className={styles.evidenceBtn}
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
                    <div className={styles.mt2}>
                      <p className={styles.sectionTitle}>Eligibility</p>
                      <ul className={styles.reqList}>
                        {item.requirements.eligibility.map((e, i) => {
                          return (
                            <li key={i} className={styles.reqItem}>
                              {needsLook(e.confidence, e.needs_human) ? (
                                <span aria-label="needs a look" className={styles.warnBadge}>
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                                    <path d="M12 5v10M12 19v0.5" />
                                  </svg>
                                </span>
                              ) : (
                                <Check className={styles.checkIcon} aria-label="clear" />
                              )}
                              <span>
                                {e.rule}
                                {e.evidenceQuote ? (
                                  <span className={styles.block}>
                                    <button
                                      type="button"
                                      className={styles.evidenceBtn}
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
                    <p className={styles.flagNote}>
                      {flagged} {flagged === 1 ? 'item needs' : 'items need'} a look — the page wasn&apos;t clear there.
                    </p>
                  )}
                </div>
              );
            }
            if (item.kind === 'plan' && item.plan && (item.plan.deadlines.length > 0 || item.plan.items.length > 0)) {
              const plan = item.plan;
              return (
                <div key={item.id} className={`${styles.card} ${styles.gapGroup}`}>
                  <p className={styles.cardTitle}>{plan.title}</p>
                  <p className={styles.cardPrompt}>Here&apos;s the plan. Nothing goes on your calendar until you say so.</p>
                  {plan.deadlines.length > 0 && (
                    <ul className={`${styles.reqList} ${styles.mt2}`}>
                      {plan.deadlines.map((iso, i) => {
                        const when = formatDeadline(iso);
                        return (
                          <li key={i} className={styles.planRow}>
                            <span>{when.main}</span>
                            <span className={styles.reqDetail}>{when.sub ?? 'Deadline'}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {plan.items.length > 0 && (
                    <ul className={`${styles.reqList} ${styles.mt2}`}>
                      {plan.items.map((task, i) => (
                        <li key={i} className={styles.planTask}>
                          · {task}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className={styles.btnRow}>
                    {item.approved === true ? (
                      <p className={styles.syncedNote}>
                        <Check className={styles.checkIcon} aria-label="synced" /> Synced to reminders
                      </p>
                    ) : (
                      <button
                        type="button"
                        disabled={item.approving === true}
                        onClick={() => {
                          if (item.plan) void approvePlan(item.id, item.plan);
                        }}
                        className={styles.btnPrimary}
                      >
                        {item.approving === true ? 'Syncing…' : 'Approve & Sync'}
                      </button>
                    )}
                    {plan.deadlines.length > 0 && (
                      <button
                        type="button"
                        disabled={item.downloading === true}
                        onClick={() => {
                          if (item.plan) void downloadPlan(item.id, item.plan);
                        }}
                        className={styles.btnPrimary}
                      >
                        {item.downloading === true ? (
                          <Loader2 className={styles.spin} aria-label="working" />
                        ) : (
                          <Download className={styles.checkIcon} />
                        )}
                        Download .ics
                      </button>
                    )}
                  </div>
                  {item.planError ? (
                    <p className={styles.planError} role="alert">{item.planError}</p>
                  ) : null}
                </div>
              );
            }
            if (item.kind === 'rolling' && item.text) {
              return (
                <div key={item.id} className={`${styles.assistantRow} ${styles.gapGroup}`}>
                  <div>
                    <span className={styles.rollingPill}>
                      Rolling / Unspecified Deadline
                    </span>
                    <p className={styles.rollingText}>{item.text}</p>
                  </div>
                </div>
              );
            }
            return (
              <div key={item.id} className={`${styles.card} ${styles.gapGroup}`}>
                <p className={styles.assistantText}>{item.text}</p>
                {item.link && (
                  <a href={item.link} target="_blank" rel="noreferrer" className={`${styles.link} ${styles.coverageOpen}`}>
                    Open the page
                  </a>
                )}
              </div>
            );
          })}
          {busy && !feed.some((entry) => entry.kind === 'status' && entry.state === 'active') ? (
            <div className={`${styles.assistantRow} ${styles.gapGroup}`} aria-label="Mizzou is typing">
              <span className={styles.typing}>
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
              </span>
            </div>
          ) : null}
        </div>

        <div className={styles.composer}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send();
            }}
            placeholder="Message Mizzou"
            aria-label="Message Mizzou"
            className={styles.composerInput}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || input.trim().length === 0}
            aria-label="Send"
            className={styles.sendBtn}
          >
            <ArrowUp className={styles.sendIcon} />
          </button>
        </div>
        <EvidenceOverlay />
    </div>
  );
}

export default function ConversationPage(): React.JSX.Element {
  return (
    <Suspense fallback={<div className={styles.loadingFallback}>Loading chat...</div>}>
      <ChatContent />
    </Suspense>
  );
}
