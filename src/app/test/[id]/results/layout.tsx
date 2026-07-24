import { AppSidebar } from '@/components/app-sidebar';

/**
 * Results sit outside the dashboard route group (they belong to a test), but
 * the sitting is over — so the sidebar comes back. Only `/test/[id]` itself
 * stays full-focus.
 */
export default function ResultsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-paper md:flex-row">
      <AppSidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3 md:py-4 md:pl-0 md:pr-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-lift">
          <main className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-8 py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
