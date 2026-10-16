import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { isReferencePicture } from '@/lib/plan/mockup';

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * One picture of a registered mockup (lib/preview/references.ts), for the
 * pair on a screen step's row (plan #2215.10). The pictures are kept in the
 * repository under docs/references, which the deployment carries for this
 * route (next.config.ts). Only a path some reference lists is served, so the
 * query cannot reach any other file.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const wanted = request.nextUrl.searchParams.get('path') ?? '';
  const type = TYPES[path.extname(wanted).toLowerCase()];
  if (!type || !isReferencePicture(wanted)) {
    return new NextResponse('No such picture.', { status: 404 });
  }

  try {
    const body = await readFile(path.join(process.cwd(), wanted));
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': type,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return new NextResponse('No such picture.', { status: 404 });
  }
}
