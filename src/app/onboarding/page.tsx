'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { AVATARS } from '@/lib/avatars';
import { ONBOARDED_COOKIE } from '@/lib/onboarding-cookie';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';

type Step = 'welcome' | 'name' | 'avatar' | 'target' | 'date' | 'bank';

const ORDER: Step[] = ['welcome', 'name', 'avatar', 'target', 'date', 'bank'];

export default function OnboardingPage() {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('welcome');
  const [displayName, setDisplayName] = useState('');
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [targetScore, setTargetScore] = useState('');
  const [testDate, setTestDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const index = ORDER.indexOf(step);

  const complete = useMutation(
    trpc.profile.completeOnboarding.mutationOptions({
      onSuccess: async () => {
        // Let the proxy skip its DB read from here on.
        document.cookie = `${ONBOARDED_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
        await queryClient.invalidateQueries();
        router.replace('/dashboard');
        router.refresh();
      },
      onError: (e) => setError(e.message),
    }),
  );

  const finish = (thenAddBank: boolean) => {
    setError(null);
    complete.mutate(
      {
        display_name: displayName.trim(),
        avatar_id: avatarId ?? undefined,
        target_score: targetScore ? Number(targetScore) : undefined,
        test_date: testDate || undefined,
      },
      {
        onSuccess: () => {
          if (thenAddBank) router.replace('/dashboard/practice?upload=1');
        },
      },
    );
  };

  const next = () => setStep(ORDER[Math.min(index + 1, ORDER.length - 1)]);
  const back = () => setStep(ORDER[Math.max(index - 1, 0)]);

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      {/* Chrome: wordmark + step counter */}
      <header className="flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-blue text-white">
            <Icon name="bolt" className="text-small" />
          </span>
          <span className="text-lead font-semibold tracking-tight text-ink-900">SPrep</span>
        </div>
        <span className="text-small text-ink-400 tabular-nums">
          Step {index + 1} of {ORDER.length}
        </span>
      </header>

      {/* Thin progress rule */}
      <div className="h-0.5 w-full bg-sunken">
        <div
          className="h-full bg-blue transition-[width] duration-300 ease-out"
          style={{ width: `${((index + 1) / ORDER.length) * 100}%` }}
        />
      </div>

      {/* Centre stage */}
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-xl">
          {step === 'welcome' && (
            <StepShell
              title="Let’s Get Started"
              subtitle="A few quick questions, then straight to practice."
            >
              <ul className="mx-auto max-w-sm space-y-3 text-left">
                {[
                  { icon: 'files' as const, text: 'Upload a question PDF — answers included' },
                  { icon: 'pencil' as const, text: 'Sit it timed or untimed' },
                  { icon: 'bar-chart' as const, text: 'See exactly which skills cost you points' },
                ].map((row) => (
                  <li key={row.text} className="flex items-center gap-3 text-body text-ink-700">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-blue-tint text-blue">
                      <Icon name={row.icon} className="text-small" />
                    </span>
                    {row.text}
                  </li>
                ))}
              </ul>
            </StepShell>
          )}

          {step === 'name' && (
            <StepShell title="What should we call you?" subtitle="This is the name shown in the app.">
              <Input
                label="Display name"
                placeholder="e.g. Eric"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoFocus
                className="mx-auto max-w-sm text-left"
              />
            </StepShell>
          )}

          {step === 'avatar' && (
            <StepShell title="Pick an avatar" subtitle="You can change it later in Settings.">
              <div className="grid grid-cols-5 gap-3 sm:grid-cols-7">
                {AVATARS.map((a) => {
                  const selected = avatarId === a.id;
                  return (
                    <button
                      key={a.id}
                      onClick={() => setAvatarId(a.id)}
                      aria-pressed={selected}
                      aria-label={`Avatar ${a.id.replace('vibrent_', '')}`}
                      className={cn(
                        'aspect-square overflow-hidden rounded-pill border-2 transition-all duration-150',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2',
                        selected
                          ? 'border-blue ring-2 ring-blue/30'
                          : 'border-transparent opacity-70 hover:opacity-100',
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </button>
                  );
                })}
              </div>
            </StepShell>
          )}

          {step === 'target' && (
            <StepShell title="What score are you aiming for in the Reading & Writing Section?" subtitle="Optional — it sets the bar on your progress page.">
              <Input
                label="Target score"
                type="number"
                min={100}
                max={800}
                step={10}
                placeholder="720"
                value={targetScore}
                onChange={(e) => setTargetScore(e.target.value)}
                hint="400–1600"
                className="mx-auto max-w-xs text-left"
              />
            </StepShell>
          )}

          {step === 'date' && (
            <StepShell title="When’s the test?" subtitle="Optional — used to pace your practice.">
              <Input
                label="Test date"
                type="date"
                value={testDate}
                onChange={(e) => setTestDate(e.target.value)}
                className="mx-auto max-w-xs text-left"
              />
            </StepShell>
          )}

          {step === 'bank' && (
            <StepShell
              title="Add your first question bank?"
              subtitle="Upload one answers PDF and we’ll pull every question out of it."
            >
              <p className="mx-auto max-w-sm rounded-control bg-blue-wash px-4 py-3 text-small text-ink-700">
                You can skip this and do it any time from Practice.
              </p>
            </StepShell>
          )}

          {error && (
            <p role="alert" className="mx-auto mt-4 max-w-sm rounded-control bg-miss-tint px-3 py-2 text-small text-miss">
              {error}
            </p>
          )}

          {/* Controls */}
          <div className="mt-10 flex items-center justify-center gap-3">
            {index > 0 && (
              <Button variant="ghost" onClick={back} disabled={complete.isPending}>
                <Icon name="arrow-left" className="text-small" />
                Back
              </Button>
            )}

            {step === 'bank' ? (
              <>
                <Button variant="ghost" onClick={() => finish(false)} disabled={complete.isPending}>
                  Skip for now
                </Button>
                <Button onClick={() => finish(true)} disabled={complete.isPending}>
                  {complete.isPending ? 'Saving…' : 'Upload a paper'}
                  <Icon name="arrow-right" className="text-small" />
                </Button>
              </>
            ) : (
              <Button
                onClick={next}
                disabled={step === 'name' && displayName.trim().length === 0}
              >
                Continue
                <Icon name="arrow-right" className="text-small" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="text-center">
      <h1 className="text-h1 font-semibold text-ink-900">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-body text-ink-500">{subtitle}</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}
