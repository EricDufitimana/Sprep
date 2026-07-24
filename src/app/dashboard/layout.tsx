import { AppSidebar } from '@/components/app-sidebar';

/**
 * Shell for every page except the full-focus test screen (`/test/[id]`), which
 * deliberately keeps no sidebar.
 *
 * The sidebar is a flex sibling that widens on hover (60px ↔ 300px); the
 * content card floats beside it with matching gutters and scrolls internally,
 * so the card never stretches past the viewport.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-paper md:flex-row">
      <AppSidebar />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3 md:py-4 md:pl-0 md:pr-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-lift">
          <main className="flex-1 overflow-y-auto px-8 py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
