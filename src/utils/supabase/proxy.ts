import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { ONBOARDED_COOKIE, ONBOARDED_COOKIE_OPTIONS } from '@/lib/onboarding-cookie'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value)
          )
        },
      },
    }
  )

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  const { data } = await supabase.auth.getClaims()

  const user = data?.claims

  const { pathname } = request.nextUrl

  // This app's login page lives at `/` rather than `/login`, so the public set
  // is the root plus the OAuth callback under `/auth`. `/api` is excluded from
  // the redirect because tRPC enforces its own auth and should answer with a
  // JSON error rather than an HTML redirect.
  const isPublicRoute =
    pathname === '/' || pathname.startsWith('/auth') || pathname.startsWith('/api')

  const isOnboardingRoute = pathname.startsWith('/onboarding')
  const isDashboardRoute = pathname.startsWith('/dashboard') || pathname.startsWith('/test')

  // Rule: signed out. The real login page at `/` stays visible.
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  if (user) {
    // `onboarded` is monotonic, so a `true` cookie is a safe cache. Anything
    // else costs one read, and only on routes where the answer matters —
    // see lib/onboarding-cookie.ts for the reasoning.
    let onboarded = request.cookies.get(ONBOARDED_COOKIE)?.value === '1'

    if (!onboarded && (isDashboardRoute || isOnboardingRoute || pathname === '/')) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('onboarded')
        .eq('id', user.sub as string)
        .maybeSingle()

      onboarded = profile?.onboarded === true
      if (onboarded) {
        supabaseResponse.cookies.set(ONBOARDED_COOKIE, '1', ONBOARDED_COOKIE_OPTIONS)
      }
    }

    // Rule 2: unboarded users cannot reach the dashboard by any URL.
    // The onboarding route itself is exempt, which is what prevents a loop.
    if (!onboarded && isDashboardRoute) {
      const url = request.nextUrl.clone()
      url.pathname = '/onboarding'
      url.search = ''
      return NextResponse.redirect(url)
    }

    // Rule 3: onboarding is not re-runnable from the URL bar.
    if (onboarded && isOnboardingRoute) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      url.search = ''
      return NextResponse.redirect(url)
    }

    // Rule 1: a signed-in user has no reason to sit on the login page.
    // Sending the unboarded straight to onboarding avoids a second hop.
    if (pathname === '/') {
      const url = request.nextUrl.clone()
      url.pathname = onboarded ? '/dashboard' : '/onboarding'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is. If you're
  // creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse
}
