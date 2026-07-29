'use client';

import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { Modal } from '@/components/ui/modal';
import { Icon, type IconName } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useSection, SECTION_LABELS, type Section } from '@/lib/section';

/**
 * The profile sheet, opened from the sidebar identity. Its main job is the
 * section switch: picking Reading & Writing or Math re-points every page —
 * banks, question pool, progress — at that section's content. The choice is
 * held in `useSection` (localStorage), so it sticks and takes effect instantly.
 */
const SECTION_CARDS: { value: Section; icon: IconName; blurb: string }[] = [
  { value: 'reading_writing', icon: 'book', blurb: 'Passages, grammar, and rhetoric.' },
  { value: 'math', icon: 'graph', blurb: 'Algebra, advanced math, data, and geometry.' },
];

export function ProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const trpc = useTRPC();
  const { data: profile } = useQuery(trpc.profile.get.queryOptions());
  const { section, setSection } = useSection();

  const displayName = profile?.display_name || profile?.username || 'Your account';

  return (
    <Modal open={open} onClose={onClose} title="Profile" className="max-w-lg">
      {/* Identity */}
      <div className="mb-6 flex items-center gap-3">
        {profile?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatar_url} alt="" className="h-12 w-12 rounded-pill object-cover" />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-pill bg-blue-tint text-body font-semibold text-blue">
            {displayName.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-body font-semibold text-ink-900">{displayName}</p>
          {profile?.email && <p className="truncate text-small text-ink-500">{profile.email}</p>}
        </div>
      </div>

      {/* Section switch */}
      <p className="mb-2 text-micro font-medium uppercase tracking-wide text-ink-400">
        Practice section
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {SECTION_CARDS.map((card) => {
          const active = section === card.value;
          return (
            <button
              key={card.value}
              onClick={() => {
                setSection(card.value);
                onClose();
              }}
              aria-pressed={active}
              className={cn(
                'flex flex-col items-start gap-2 rounded-card border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue',
                active
                  ? 'border-blue bg-blue-tint'
                  : 'border-line hover:border-ink-400/50 hover:bg-paper',
              )}
            >
              <span
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-control',
                  active ? 'bg-blue text-white' : 'bg-sunken text-ink-500',
                )}
              >
                <Icon name={card.icon} className="text-base" />
              </span>
              <span className="flex items-center gap-1.5 text-body font-semibold text-ink-900">
                {SECTION_LABELS[card.value]}
                {active && <Icon name="checkmark-circle" className="text-small text-blue" />}
              </span>
              <span className="text-small text-ink-500">{card.blurb}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-small text-ink-500">
        Switching changes the banks, question pool, and progress you see across the app.
      </p>
    </Modal>
  );
}
