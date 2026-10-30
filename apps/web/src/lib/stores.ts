// Record shapes shared by the repo and the UI. Storage is Supabase-only;
// the same shapes back supabase/migrations/0001_tables.sql. Types only —
// no node APIs here, so client components may import these types.

export interface Reminder {
  id: string;
  userId: string;
  title: string;
  sub: string;
  pill: string;
  dueAt: string | null;
  kind: string;
  done: boolean;
}

export interface ChatSummary {
  id: string;
  userId: string;
  title: string;
  updatedAt: string;
}
