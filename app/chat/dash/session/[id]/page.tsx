import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadSessionThread } from '@/lib/core/session-threads';
import { isThreadId } from '@/lib/core/session-threads-model';
import { activeProjects } from '@/lib/plan/projects';
import { loadProjectsForRequest } from '@/lib/plan/request-plan';
import {
  answerSessionMessageAction,
  commentOnSessionMockupAction,
  pickSessionMockupAction,
  sendSessionMessageAction,
  startSessionThreadAction,
} from '../../session-actions';
import { SessionThreadView } from '../../session-view';

export const metadata = { title: 'Session' };
export const dynamic = 'force-dynamic';

const ACTIONS = {
  start: startSessionThreadAction,
  send: sendSessionMessageAction,
  answer: answerSessionMessageAction,
  pick: pickSessionMockupAction,
  comment: commentOnSessionMockupAction,
};

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

/**
 * A conversation with a Claude Code session, open beside the chats on Chat's
 * Dash tab (plan #2789.7). `/chat/dash/session/new` is a new one, on the
 * project `?project=` names (the "Talk about this project" button on a
 * project's page) or on this app.
 */
export default async function SessionThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  const [{ id }, { project }] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const projects = activeProjects(await loadProjectsForRequest(user.id));
  const now = readAt();

  if (id === 'new') {
    const wanted = typeof project === 'string' ? project : null;
    return (
      <SessionThreadView
        key={`new-${wanted ?? ''}`}
        thread={null}
        messages={[]}
        projects={projects.map((p) => ({ id: p.id, label: p.label }))}
        projectId={projects.some((p) => p.id === wanted) ? wanted : null}
        actions={ACTIONS}
        now={now}
      />
    );
  }

  if (!isThreadId(id)) notFound();
  const page = await loadSessionThread(await createCoreClient(), user.id, id, projects);
  if (!page) notFound();
  return (
    <SessionThreadView
      key={page.thread.id}
      thread={page.thread}
      messages={page.messages}
      reported={page.reported}
      report={page.report}
      actions={ACTIONS}
      now={now}
    />
  );
}
