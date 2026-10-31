'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { CLEARED_SNAPSHOT_KEY, readSnapshot, serializeSnapshot } from './panel-helpers';
import {
  clearChatsAction,
  deleteMyDataAction,
  ensureChatAction,
  refreshChatsAction,
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
  deleteMyData: () => Promise<{ chats: number; reminders: number }>;
  clearChats: () => Promise<void>;
  undoClearChats: () => Promise<void>;
  expireUndo: () => void;
  undoArmed: boolean;
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

  return (
    <StoreContext.Provider value={{ isGuest, name, email, reminders, chats, ensureChat, refreshChats, deleteMyData, clearChats, undoClearChats, expireUndo, undoArmed }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): StoreState {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
