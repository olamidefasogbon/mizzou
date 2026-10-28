import AppShell from '@/components/shell';

// Chat screens share one responsive shell: drawer < 768px, pinned panel +
// centered ~760px column at 768px+, right evidence rail at 1100px+.

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
