import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { CheckClient } from './check-client';

export const metadata: Metadata = {
  title: 'Question Check — SPrep',
  description: 'Paste a question-bank JSON and strip out anything already in the bank.',
};

/**
 * Unlisted dedupe tool, reached only by typing the URL. It is not in the
 * sidebar by design — but it must still be gated, so this server component
 * verifies the Supabase session before rendering anything. An unauthenticated
 * visitor is bounced to the login screen with `next=/check`, so they land back
 * here after signing in.
 */
export default async function CheckPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/?next=/check');

  return <CheckClient />;
}
