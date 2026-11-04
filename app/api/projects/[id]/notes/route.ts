import { after, NextResponse, type NextRequest } from 'next/server';
import { allowedOrigin, bearerToken } from '@/lib/project-notes/keys';
import { authoriseProjectApp, fileProjectNote, sendProjectNoteToPlan, serviceClients } from '@/lib/project-notes/file';
import { outcomeLine } from '@/lib/project-notes/route';
import { loadDevProjects } from '@/lib/plan/projects';

/**
 * A note from a project's own app, such as the music studio's note button
 * (docs/PROJECT-NOTES.md). The app sends `{ body, page }` with the token Dash
 * gave it as a bearer token; the answer says where the note went.
 */

function cors(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/** The request's origin when this project's site (or localhost) may read the answer. */
async function originFor(request: NextRequest, projectId: string): Promise<string | null> {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (allowedOrigin(origin, null)) return origin;
  try {
    const db = serviceClients();
    const { data: ownerId } = await db.core.rpc('dev_owner_id');
    if (typeof ownerId !== 'string') return null;
    const project = (await loadDevProjects(db.pub, ownerId)).find((p) => p.id === projectId);
    return allowedOrigin(origin, project?.url ?? null);
  } catch {
    return null;
  }
}

export async function OPTIONS(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return new NextResponse(null, { status: 204, headers: cors(await originFor(request, id)) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = { ...cors(await originFor(request, id)), 'Cache-Control': 'no-store' };
  const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status, headers });

  let payload: { body?: unknown; page?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return fail(400, 'Send the note as JSON.');
  }

  const db = serviceClients();
  const who = await authoriseProjectApp(db, id, bearerToken(request.headers.get('authorization')));
  if (!who.ok) return fail(who.status, who.error);

  const filed = await fileProjectNote(db, {
    ownerId: who.ownerId,
    project: who.project,
    body: typeof payload.body === 'string' ? payload.body : '',
    page: typeof payload.page === 'string' ? payload.page : null,
  });
  if (!filed.ok) return fail(filed.status, filed.error);

  // Not one fix: shaped into a feature on the plan straight away, as a note from Dash's own header is.
  if (filed.outcome.as === 'idea') after(() => sendProjectNoteToPlan(db, who.ownerId, filed.ideaId));
  return NextResponse.json(
    { ok: true, ...filed.outcome, message: outcomeLine(filed.outcome) },
    { headers },
  );
}
