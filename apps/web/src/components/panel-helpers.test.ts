// Run: node --test src/components/panel-helpers.test.ts (from apps/web).
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  activeChatIdFromPath,
  filterPanelChats,
  dedupeReminders,
  filterPanelReminders,
  newChatHref,
  reminderQuestion,
  openReminderCount,
  readSnapshot,
  serializeSnapshot,
  UNDO_WINDOW_MS,
} from './panel-helpers.ts';
import type { ChatSummary, Reminder } from '../lib/stores.ts';

function chat(id: string, title = id): ChatSummary {
  return { id, userId: 'u', title, updatedAt: '2026-10-30T12:00:00.000Z' };
}

function reminder(id: string, done: boolean, title = id): Reminder {
  return { id, userId: 'u', title, sub: 'sub', pill: 'in 3d', dueAt: null, kind: 'deadline', done };
}

describe('activeChatIdFromPath', () => {
  it('reads the id from a chat route', () => {
    assert.equal(activeChatIdFromPath('/app/c/abc123'), 'abc123');
  });

  it('ignores trailing segments', () => {
    assert.equal(activeChatIdFromPath('/app/c/abc123/extra'), 'abc123');
  });

  it('returns null off chat routes', () => {
    assert.equal(activeChatIdFromPath('/app'), null);
    assert.equal(activeChatIdFromPath('/'), null);
    assert.equal(activeChatIdFromPath(null), null);
    assert.equal(activeChatIdFromPath('/app/c/'), null);
  });
});

describe('panel search', () => {
  const chats = [chat('1', 'Stanford CS application'), chat('2', 'Resume polish')];

  it('matches chat titles case-insensitively', () => {
    assert.deepEqual(filterPanelChats(chats, 'stanford').map((c) => c.id), ['1']);
    assert.deepEqual(filterPanelChats(chats, '  RESUME ').map((c) => c.id), ['2']);
  });

  it('blank query returns every chat', () => {
    assert.equal(filterPanelChats(chats, '   ').length, 2);
  });

  it('matches reminders on title and subtitle', () => {
    const rows = [reminder('a', false, 'Passport'), { ...reminder('b', false), sub: 'Passport photos' }];
    assert.deepEqual(filterPanelReminders(rows, 'passport').map((r) => r.id), ['a', 'b']);
    assert.deepEqual(filterPanelReminders(rows, 'photos').map((r) => r.id), ['b']);
  });
});

describe('openReminderCount', () => {
  it('counts exactly the open reminders', () => {
    const rows = [reminder('a', false), reminder('b', true), reminder('c', false)];
    assert.equal(openReminderCount(rows), 2);
  });

  it('is zero when everything is done', () => {
    assert.equal(openReminderCount([reminder('a', true)]), 0);
  });
});

describe('clear-undo snapshot', () => {
  const rows = [chat('1'), chat('2')];

  it('round-trips inside the Undo window (survives refresh)', () => {
    const now = 1_000_000;
    const raw = serializeSnapshot(rows, now);
    assert.deepEqual(readSnapshot(raw, now + UNDO_WINDOW_MS - 1), rows);
  });

  it('expires after the window', () => {
    const raw = serializeSnapshot(rows, 1_000_000);
    assert.equal(readSnapshot(raw, 1_000_000 + UNDO_WINDOW_MS + 1), null);
  });

  it('rejects missing or corrupt payloads', () => {
    assert.equal(readSnapshot(null, 0), null);
    assert.equal(readSnapshot('not-json', 0), null);
    assert.equal(readSnapshot('{"at":"x","rows":[]}', 0), null);
  });
});

describe('reminder rows', () => {
  const r = (id: string, title: string, pill: string): Reminder => ({
    id, userId: 'u', title, sub: 'Application deadline', pill, dueAt: null, kind: 'deadline', done: false,
  });
  it('shows a repeated program and date once', () => {
    const out = dedupeReminders([r('1', 'ETH Fellowship', 'Dec 16'), r('2', 'ETH Fellowship', 'Dec 16'), r('3', 'ETH Fellowship', 'Jul 2')]);
    assert.deepEqual(out.map((x) => x.id), ['1', '3']);
  });
  it('asks about the program by name and builds a chat href', () => {
    assert.equal(reminderQuestion({ title: 'ETH Fellowship' }), 'What should I do next for ETH Fellowship?');
    assert.equal(newChatHref('a b?', 'abc'), '/app/c/abc?q=a%20b%3F');
  });
});
