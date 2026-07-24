import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * OAuth callback. Google redirects here with a `code`, which we exchange for a
 * session — the cookies that exchange sets are what every server client and the
 * tRPC context read from afterwards.
 *
 * A dedicated client is built here rather than reusing `utils/supabase/server.ts`
 * because that helper's `setAll` swallows write failures for Server Components;
 * in a Route Handler the cookie writes must actually land.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  // Only allow relative redirects, so a crafted link can't bounce the user
  // off-site carrying a fresh session.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=missing_code`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error('❌ [auth/callback] Code exchange failed:', error.message);
    return NextResponse.redirect(`${origin}/?error=exchange_failed`);
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}
