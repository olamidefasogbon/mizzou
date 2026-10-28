import AppShell from '@/components/shell';
import { getAppData } from '@/lib/actions';

// Chat screens share one responsive AppShell, seeded with real store rows
// (empty on a fresh browser). No demo data.

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const initial = await getAppData();
  return <AppShell initial={initial}>{children}</AppShell>;
}
