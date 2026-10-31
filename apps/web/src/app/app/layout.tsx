import { redirect } from 'next/navigation';
import AppShell from '@/components/shell';
import { getAppData, type AppData } from '@/lib/actions';

// Chat screens share one responsive AppShell, seeded with real store rows.
// No signup required: the proxy mints an anonymous session on the way in,
// so getAppData almost always succeeds. The redirect below only covers the
// layout race when no session exists at all (Supabase unreachable).

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let initial: AppData;
  try {
    initial = await getAppData();
  } catch {
    redirect('/');
  }
  return <AppShell initial={initial}>{children}</AppShell>;
}
