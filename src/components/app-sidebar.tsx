'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';
import { Icon, type IconName } from '@/components/ui/icon';
import {
  Sidebar,
  SidebarBody,
  SidebarButton,
  SidebarLink,
} from '@/components/ui/sidebar';

interface NavItem {
  label: string;
  href: string;
  icon: IconName;
}

const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: 'grid-alt' },
  { label: 'Practice', href: '/dashboard/practice', icon: 'pencil' },
  { label: 'Question Bank', href: '/dashboard/question-bank', icon: 'library' },
  { label: 'Vocabulary', href: '/dashboard/vocabulary', icon: 'book' },
  { label: 'Progress', href: '/dashboard/progress', icon: 'bar-chart' },
];

/** Fixed-width icon slot so labels line up at every collapse state. */
function NavIcon({ name, active }: { name: IconName; active?: boolean }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center">
      <Icon name={name} className={cn('text-base', active ? 'text-blue' : 'text-ink-500')} />
    </span>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);

  // Real profile — no placeholder user.
  const { data: profile } = useQuery(trpc.profile.get.queryOptions());

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/');
    router.refresh();
  };

  const displayName = profile?.display_name || profile?.username || 'Your account';

  // Collapsed the rail is 60px wide. At px-4 only 28px of content space is
  // left — exactly the icon's width — so the active pill can't sit around it.
  // Dropping to px-2 when collapsed gives the pill room to enclose the icon.
  const railPad = open ? 'px-4' : 'px-2';
  // Links lose their own horizontal padding when collapsed and centre instead,
  // so the icon sits in the middle of the pill rather than against its edge.
  const rowLayout = open ? 'px-2' : 'justify-center px-0';

  return (
    <Sidebar open={open} setOpen={setOpen}>
      <SidebarBody className={cn('justify-between gap-6', railPad)}>
        <div className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
          {/* Wordmark — collapses to just the mark. Shares the nav rows' layout
              so the mark lines up with the nav icons at every collapse state. */}
          <div className={cn('flex items-center gap-2 py-1', rowLayout)}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-blue text-white">
              <Icon name="bolt" className="text-small" />
            </span>
            {open && (
              <span className="whitespace-pre text-lead font-semibold tracking-tight text-ink-900">
                SPrep
              </span>
            )}
          </div>

          <nav aria-label="Main" className="mt-8 flex flex-col gap-1">
            {NAV.map((item) => {
              const active =
                item.href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(item.href);
              return (
                <SidebarLink
                  key={item.href}
                  link={{
                    label: item.label,
                    href: item.href,
                    icon: <NavIcon name={item.icon} active={active} />,
                  }}
                  className={cn(
                    'rounded-control transition-colors duration-150',
                    rowLayout,
                    active ? 'bg-blue-tint' : 'hover:bg-sunken/70',
                  )}
                />
              );
            })}
          </nav>
        </div>

        {/* Footer: logout + the real signed-in user */}
        <div className="flex flex-col gap-1">
          <SidebarButton
            label="Logout"
            onClick={signOut}
            icon={<NavIcon name="exit" />}
            className={cn('rounded-control hover:bg-sunken/70', rowLayout)}
          />

          {/* Identity readout, not a link — there is no settings page to open. */}
          <div className={cn('flex items-center gap-2 rounded-control py-2', rowLayout)}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center">
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatar_url} alt="" className="h-7 w-7 rounded-pill object-cover" />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-pill bg-blue-tint text-micro font-semibold text-blue">
                  {displayName.charAt(0).toUpperCase()}
                </span>
              )}
            </span>
            {open && (
              <span className="truncate whitespace-pre text-sm text-ink-700">{displayName}</span>
            )}
          </div>
        </div>
      </SidebarBody>
    </Sidebar>
  );
}
