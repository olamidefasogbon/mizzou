'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import {
  clearChatsAction,
  ensureChatAction,
  restoreChatsAction,
  type AppData,
} from '@/lib/actions';
import type { ChatSummary, Reminder } from '@/lib/stores';

// Client copy of app chrome state, seeded once by the server layout.
// Reminders are created only at plan approval or as check-again reminders;
// chats are created when a chat starts. Until then every list is empty.

interface StoreState {
  name: string | null;
  reminders: Reminder[];
  chats: ChatSummary[];
  ensureChat: (id: string, title: string) => Promise<void>;
  clearChats: () => Promise<void>;
  undoClearChats: () => Promise<void>;
  expireUndo: () => void;
  undoArmed: boolean;
}

const StoreContext = createContext<StoreState | null>(null);

export function StoreProvider({ initial, children }: { initial: AppData; children: ReactNode }) {
  const [name] = useState<string | null>(initial.name);
  const [reminders] = useState<Reminder[]>(initial.reminders);
  const [chats, setChats] = useState<ChatSummary[]>(initial.chats);
  const [snapshot, setSnapshot] = useState<ChatSummary[] | null>(null);
  const [undoArmed, setUndoArmed] = useState(false);

  const ensureChat = useCallback(async (id: string, title: string) => {
    const row = await ensureChatAction(id, title);
    setChats((prev) => (prev.some((c) => c.id === row.id) ? prev : [row, ...prev]));
  }, []);

  const clearChats = useCallback(async () => {
    const removed = await clearChatsAction();
    setSnapshot(removed);
    setChats([]);
    setUndoArmed(true);
  }, []);

  const undoClearChats = useCallback(async () => {
    if (!snapshot) return;
    await restoreChatsAction(snapshot);
    setChats(snapshot);
    setSnapshot(null);
    setUndoArmed(false);
  }, [snapshot]);

  const expireUndo = useCallback(() => {
    setSnapshot(null);
    setUndoArmed(false);
  }, []);

  return (
    <StoreContext.Provider value={{ name, reminders, chats, ensureChat, clearChats, undoClearChats, expireUndo, undoArmed }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): StoreState {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
