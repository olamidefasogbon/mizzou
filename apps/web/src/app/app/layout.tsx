import { redirect } from 'next/navigation';
import AppShell from '@/components/shell';
import { getAppData, type AppData } from '@/lib/actions';

// Chat screens share one responsive AppShell, seeded with real store rows.
// Google sign-in only: signed-out visits bounce to /signup (proxy guards
// too, this covers the layout race).

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let initial: AppData;
  try {
    initial = await getAppData();
  } catch {
    redirect('/signup');
  }
  return <AppShell initial={initial}>{children}</AppShell>;
}
