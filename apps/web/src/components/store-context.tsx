'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { CLEARED_SNAPSHOT_KEY, readSnapshot, serializeSnapshot } from './panel-helpers';
import {
  clearChatsAction,
  deleteMyDataAction,
  ensureChatAction,
  deleteChatAction,
  refreshChatsAction,
  refreshRemindersAction,
  restoreChatsAction,
  type AppData,
} from '@/lib/actions';
import type { ChatSummary, Reminder } from '@/lib/stores';

// Client copy of app chrome state, seeded once by the server layout.
// Reminders are created only at plan approval or as check-again reminders;
// chats are created when a chat starts. Until then every list is empty.

interface StoreState {
  isGuest: boolean;
  name: string | null;
  email: string | null;
  reminders: Reminder[];
  chats: ChatSummary[];
  ensureChat: (id: string, title: string) => Promise<void>;
  refreshChats: () => Promise<void>;
  /** Remove one chat from history. */
  deleteChat: (id: string) => Promise<void>;
  deleteMyData: () => Promise<{ chats: number; reminders: number }>;
  clearChats: () => Promise<void>;
  undoClearChats: () => Promise<void>;
  expireUndo: () => void;
  undoArmed: boolean;
  refreshReminders: () => Promise<void>;
  markReminderDone: (id: string) => Promise<void>;
  removeReminder: (id: string) => Promise<void>;
  undoRemoveReminder: () => Promise<void>;
  clearReminders: () => Promise<void>;
  undoClearReminders: () => Promise<void>;
  expireRemindersUndo: () => void;
  reminderUndo: Reminder | null;
  clearedReminders: Reminder[] | null;
  remindersUndoArmed: boolean;
}

const StoreContext = createContext<StoreState | null>(null);

export function StoreProvider({ initial, children }: { initial: AppData; children: ReactNode }) {
  const [isGuest] = useState<boolean>(initial.isGuest);
  const [name] = useState<string | null>(initial.name);
  const [email] = useState<string | null>(initial.email);
  const [reminders, setReminders] = useState<Reminder[]>(initial.reminders);
  const [chats, setChats] = useState<ChatSummary[]>(initial.chats);
  const [snapshot, setSnapshot] = useState<ChatSummary[] | null>(null);
  const [undoArmed, setUndoArmed] = useState(false);

  const ensureChat = useCallback(async (id: string, title: string) => {
    const row = await ensureChatAction(id, title);
    setChats((prev) => (prev.some((c) => c.id === row.id) ? prev : [row, ...prev]));
  }, []);

  const refreshChats = useCallback(async () => {
    setChats(await refreshChatsAction());
  }, []);

  const deleteChat = useCallback(async (id: string) => {
    let removed: ChatSummary | undefined;
    setChats((prev) => {
      removed = prev.find((c) => c.id === id);
      return prev.filter((c) => c.id !== id);
    });
    try {
      await deleteChatAction(id);
    } catch {
      const back = removed;
      if (back) setChats((prev) => (prev.some((c) => c.id === back.id) ? prev : [back, ...prev]));
    }
  }, []);

  const deleteMyData = useCallback(async () => {
    const counts = await deleteMyDataAction();
    setChats([]);
    setReminders([]);
    return counts;
  }, []);

  // Undo survives a refresh inside the window: the snapshot is mirrored to
  // sessionStorage on clear and rehydrated on mount (guarded for SSR).
  useEffect(() => {
    try {
      const rows = readSnapshot(sessionStorage.getItem(CLEARED_SNAPSHOT_KEY), Date.now());
      if (rows) {
        setSnapshot(rows);
        setUndoArmed(true);
      }
    } catch {
      // No storage (SSR, private mode): undo simply does not survive refresh.
    }
  }, []);

  const clearChats = useCallback(async () => {
    const removed = await clearChatsAction();
    setSnapshot(removed);
    setChats([]);
    setUndoArmed(true);
    try {
      sessionStorage.setItem(CLEARED_SNAPSHOT_KEY, serializeSnapshot(removed, Date.now()));
    } catch {
      // Storage unavailable: undo still works until the next refresh.
    }
  }, []);

  const undoClearChats = useCallback(async () => {
    if (!snapshot) return;
    await restoreChatsAction(snapshot);
    setChats(snapshot);
    setSnapshot(null);
    setUndoArmed(false);
    try {
      sessionStorage.removeItem(CLEARED_SNAPSHOT_KEY);
    } catch {
      // Already gone or storage unavailable; nothing to clean up.
    }
  }, [snapshot]);

  const expireUndo = useCallback(() => {
    setSnapshot(null);
    setUndoArmed(false);
    try {
      sessionStorage.removeItem(CLEARED_SNAPSHOT_KEY);
    } catch {
      // Already gone or storage unavailable; nothing to clean up.
    }
  }, []);

  const [reminderUndo, setReminderUndo] = useState<Reminder | null>(null);
  const [clearedReminders, setClearedReminders] = useState<Reminder[] | null>(null);
  const [remindersUndoArmed, setRemindersUndoArmed] = useState(false);

  const refreshReminders = useCallback(async () => {
    setReminders(await refreshRemindersAction());
  }, []);

  const markReminderDone = useCallback(async (id: string) => {
    const res = await fetch('/api/reminders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'done' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setReminders((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const removeReminder = useCallback(async (id: string) => {
    const res = await fetch('/api/reminders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { removed?: Reminder };
    setReminders((prev) => prev.filter((r) => r.id !== id));
    setClearedReminders(null);
    setReminderUndo(data.removed ?? null);
    setRemindersUndoArmed(true);
  }, []);

  const undoRemoveReminder = useCallback(async () => {
    if (!reminderUndo) return;
    const row = reminderUndo;
    await fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restore: { title: row.title, sub: row.sub, pill: row.pill, dueAt: row.dueAt, kind: row.kind } }),
    });
    setReminderUndo(null);
    setRemindersUndoArmed(false);
    setReminders(await refreshRemindersAction());
  }, [reminderUndo]);

  const clearReminders = useCallback(async () => {
    setClearedReminders(reminders);
    setReminderUndo(null);
    const res = await fetch('/api/reminders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setReminders([]);
    setRemindersUndoArmed(true);
  }, [reminders]);

  const undoClearReminders = useCallback(async () => {
    if (!clearedReminders) return;
    for (const row of clearedReminders) {
      await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restore: { title: row.title, sub: row.sub, pill: row.pill, dueAt: row.dueAt, kind: row.kind } }),
      });
    }
    setClearedReminders(null);
    setRemindersUndoArmed(false);
    setReminders(await refreshRemindersAction());
  }, [clearedReminders]);

  const expireRemindersUndo = useCallback(() => {
    setReminderUndo(null);
    setClearedReminders(null);
    setRemindersUndoArmed(false);
  }, []);

  return (
    <StoreContext.Provider value={{ isGuest, name, email, reminders, chats, ensureChat, refreshChats, deleteChat, deleteMyData, clearChats, undoClearChats, expireUndo, undoArmed, refreshReminders, markReminderDone, removeReminder, undoRemoveReminder, clearReminders, undoClearReminders, expireRemindersUndo, reminderUndo, clearedReminders, remindersUndoArmed }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): StoreState {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
