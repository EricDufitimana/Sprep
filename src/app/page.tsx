'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icon';
import { LoginBackdrop } from '@/components/login-backdrop';

type Mode = 'signin' | 'signup';

const COPY: Record<Mode, { title: string; subtitle: string; cta: string }> = {
  signin: {
    title: 'Welcome Back',
    subtitle: 'Welcome Back, please sign in to continue',
    cta: 'Continue with Google',
  },
  signup: {
    title: 'Create Account',
    subtitle: 'Get started — it takes one click',
    cta: 'Sign up with Google',
  },
};

/** Google's mark, inlined so no external asset is needed. */
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function LoginPanel() {
  const search = useSearchParams();
  const [mode, setMode] = useState<Mode>('signin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    search.get('error') ? 'That sign-in did not complete. Try again.' : null,
  );

  const signInWithGoogle = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const next = search.get('next') ?? '/dashboard';
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      // On success the browser is already navigating to Google.
      if (authError) {
        // Supabase reports a disabled provider as a 400 "Unsupported provider",
        // which reads as a bug rather than the setup step it is.
        setError(
          /provider is not enabled|unsupported provider/i.test(authError.message)
            ? 'Google sign-in is not enabled on this project yet. Turn it on under Authentication → Providers in Supabase.'
            : authError.message,
        );
        setLoading(false);
      }
    } catch {
      setError('Could not reach the sign-in service. Check your connection.');
      setLoading(false);
    }
  };

  const copy = COPY[mode];

  return (
    <div className="flex min-h-dvh flex-col justify-between bg-surface px-8 py-10 sm:px-14 lg:px-20">
      {/* Wordmark */}
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-blue text-white">
          <Icon name="bolt" className="text-body" />
        </span>
        <span className="text-h3 font-semibold tracking-tight text-ink-900">SPrep</span>
      </div>

      {/* Centre block */}
      <div className="mx-auto w-full max-w-sm py-12">
        <h1 className="text-center text-h1 font-semibold text-ink-900">{copy.title}</h1>
        <p className="mt-2 text-center text-body text-ink-500">{copy.subtitle}</p>

        {/* Segmented Sign in / Sign up */}
        <div
          role="tablist"
          aria-label="Authentication mode"
          className="mt-7 grid grid-cols-2 gap-1 rounded-control bg-sunken p-1"
        >
          {(['signin', 'signup'] as Mode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded-[7px] py-2 text-body font-medium transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue',
                mode === m ? 'bg-surface text-ink-900 shadow-lift' : 'text-ink-500 hover:text-ink-700',
              )}
            >
              {m === 'signin' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>

        {/* Google is the only route in, so it gets the primary treatment
            rather than sitting under an "or continue with" divider. */}
        <button
          onClick={signInWithGoogle}
          disabled={loading}
          className={cn(
            'mt-5 flex h-12 w-full items-center justify-center gap-3 rounded-control border border-blue-deep bg-blue text-body font-medium text-white',
            'shadow-[0_3px_0_0_theme(colors.blue.deep)] transition-[transform,box-shadow,background-color] duration-150 ease-out',
            'motion-safe:hover:-translate-y-px motion-safe:hover:shadow-[0_4px_0_0_theme(colors.blue.deep)]',
            'active:translate-y-[3px] active:bg-blue-deep active:shadow-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2',
            'disabled:pointer-events-none disabled:opacity-60',
          )}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-pill bg-white">
            <GoogleMark className="h-4 w-4" />
          </span>
          {loading ? 'Redirecting to Google…' : copy.cta}
        </button>

        {error && (
          <p role="alert" className="mt-3 rounded-control bg-miss-tint px-3 py-2 text-small text-miss">
            {error}
          </p>
        )}

        <p className="mt-4 text-center text-micro text-ink-400">
          Google is the only sign-in method. No password to remember.
        </p>
      </div>

      <p className="mx-auto max-w-md text-center text-small leading-6 text-ink-400">
        Track every practice sitting, find the skills costing you the most points, and drill them
        until they stop being weak spots.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* LoginPanel reads useSearchParams, so on the server this Suspense
          boundary renders its fallback. The fallback must occupy the left grid
          cell — otherwise the backdrop is the only child during load and grid
          auto-places it into column 1, then it visibly jumps to column 2 once
          the panel hydrates. */}
      <Suspense fallback={<div className="min-h-dvh bg-surface lg:col-start-1" />}>
        <LoginPanel />
      </Suspense>

      {/* Animated artwork panel — decorative, so it's hidden from assistive
          tech and dropped entirely on narrow screens. Pinned to column 2 so it
          stays on the right regardless of what has rendered on the left yet. */}
      <div className="hidden lg:col-start-2 lg:block">
        <LoginBackdrop />
      </div>
    </div>
  );
}
