import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getUser } from '@/lib/auth/server';
import { ownsPostImagePath, POST_IMAGES_BUCKET } from '@/lib/dev/posts';

/**
 * Open an image the person uploaded to a post on the Posts tab. The bucket is
 * private (migration 0192), so the card links here with the image's path and
 * this signs a five-minute link to it on their session. The bucket's policies
 * refuse a file outside their own folder, and so does the check below before
 * storage is asked.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const path = request.nextUrl.searchParams.get('path') ?? '';
  if (!ownsPostImagePath(user.id, path)) return new NextResponse('No such image.', { status: 404 });

  const supabase = await createClient();
  const download = request.nextUrl.searchParams.has('download');
  const { data, error } = await supabase.storage
    .from(POST_IMAGES_BUCKET)
    .createSignedUrl(path, 300, download ? { download: true } : undefined);
  if (error || !data) return new NextResponse('No such image.', { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
