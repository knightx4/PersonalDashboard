import { NextResponse, type NextRequest } from 'next/server';
import { newsDomain } from '@/lib/news/address';
import { createNewsServiceClient } from '@/lib/news/auth/service';
import { deliver } from '@/lib/news/inbound/deliver';
import { newsStore } from '@/lib/news/inbound/supabase';
import { createMailgunProvider, mailgunSigningKey } from '@/lib/news/providers/mailgun';

// node:crypto for the signature, and nothing here is ever cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where a newsletter arrives.
 *
 * Mailgun receives on the app's own domain and forwards every message here as
 * a form post. Nothing is read out of anybody's mailbox; this endpoint is the
 * only way an issue is ever written, and the address a message was sent to is
 * the only thing that says whose it is.
 *
 * Three answers, and the difference between them matters to the service:
 *
 *   401  the post did not prove it came from Mailgun. Nothing is stored, and
 *        the service is told so, because anything else would invite whoever
 *        sent it to try again.
 *   200  stored, or a repeat of something already stored, or addressed to
 *        nobody. All three are "we are done with this message" -- a retry
 *        would bring back the same thing, and a bounce on the last one would
 *        tell a stranger which addresses exist.
 *   500  the database could not be reached. This is the one case worth a
 *        retry, and Mailgun will make it.
 */
export async function POST(request: NextRequest) {
  const provider = createMailgunProvider({ signingKey: mailgunSigningKey() });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'a form body is required' }, { status: 400 });
  }

  const message = await provider.read(form);
  if (message === 'unsigned') {
    return NextResponse.json({ error: 'signature does not match' }, { status: 401 });
  }
  if (message === 'malformed') {
    // Signed by Mailgun but carrying no message: a delivery that failed rather
    // than an issue to read. Storing it would put an empty row in the list.
    return NextResponse.json({ stored: false }, { status: 200 });
  }

  const outcome = await deliver(
    newsStore(createNewsServiceClient()),
    message,
    newsDomain(),
  );

  return NextResponse.json({ stored: outcome === 'stored' }, { status: 200 });
}
