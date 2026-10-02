import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { MapQuote } from '@/components/vault/map-position';
import { createVaultClient } from '@/lib/vault/auth/server';
import { quoteFragment } from '@/lib/vault/map/fragment';
import { loadNoteLinks, loadThread, type MayaThreadNote } from '@/lib/vault/maya/store';
import { MAYA_QUESTION_MAX } from '@/lib/vault/maya/thought-model';
import type { MayaPoint, MayaSynthesis } from '@/lib/vault/maya/verify';
import { noteHref } from '@/lib/vault/paths';
import type { TalkTurn } from '@/lib/talk/talk';
import { MayaConversation } from './conversation';
import { QuestionField } from './question-field';
import { LinkedText } from '@/components/ui/linked-text';

export const dynamic = 'force-dynamic';

/**
 * One thread with Maya (plan #1286): the question it is about, where you have
 * got to, Maya's ranked points with the notes and works each draws on, and
 * the replies either way with the box to add one.
 *
 * Every link to a thread comes through mayaThreadHref in lib/vault/paths.ts.
 * A thread can exist without its thought (the thought's insert failed after
 * the thread's), and then the page says so and the thread can still be
 * answered: Maya replies from the note.
 */
export default async function MayaThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vault = await createVaultClient();
  const thread = await loadThread(vault, id);
  if (!thread) notFound();

  const thought = thread.messages.find((message) => message.kind === 'thought')?.thought ?? null;
  const cited = await loadNoteLinks(
    vault,
    (thought?.points ?? []).flatMap((point) => point.notes.map((note) => note.noteId)),
  );
  const turns: TalkTurn[] = thread.messages
    .filter((message) => message.kind === 'reply')
    .map((message) => ({
      id: message.id,
      role: message.role === 'maya' ? 'assistant' : 'user',
      body: message.body,
      createdAt: message.createdAt,
    }));

  return (
    <article className="mx-auto max-w-3xl">
      <div className="mb-4">
        <Link
          href="/vault/maya"
          className="inline-flex items-center gap-1 text-ui font-medium text-ink-muted hover:text-ink"
        >
          <ChevronLeft className="size-3.5" strokeWidth={2} aria-hidden />
          Maya
        </Link>
      </div>

      <header className="mb-6">
        <QuestionField
          threadId={thread.id}
          question={thread.question}
          maxLength={MAYA_QUESTION_MAX}
        />
        <p className="mt-1 text-ui text-ink-muted">
          {thread.note ? (
            <>
              On{' '}
              <Link
                href={noteHref(thread.note.path)}
                className="font-medium text-ink hover:underline"
              >
                {thread.note.title}
              </Link>
            </>
          ) : (
            'On a note no longer in the vault'
          )}
          {' · '}
          {thread.origin === 'automatic' ? 'Maya picked this note' : 'You asked'}
          {' · '}
          <time dateTime={thread.createdAt}>{day(thread.createdAt)}</time>
        </p>
      </header>

      <MayaConversation
        threadId={thread.id}
        summary={thread.summary}
        turns={turns}
        copy={{
          question: thread.question,
          notePath: thread.note?.path ?? null,
          points: thought?.points ?? [],
          synthesis: thought?.synthesis ?? null,
          paths: Object.fromEntries([...cited].map(([noteId, note]) => [noteId, note.path])),
        }}
      >
        <section aria-labelledby="thought-heading">
          <h2 id="thought-heading" className="text-body font-semibold text-ink">
            Maya&rsquo;s thought
          </h2>
          {thought && thought.points.length > 0 ? (
            <>
              <ol className="mt-1 divide-y divide-border">
                {thought.points.map((point) => (
                  <li key={point.rank} className="py-4">
                    <Point point={point} cited={cited} />
                  </li>
                ))}
              </ol>
              {thought.synthesis && <Synthesis synthesis={thought.synthesis} />}
            </>
          ) : (
            <p className="mt-1 text-body text-ink-muted">
              Maya&rsquo;s thought on this note was not kept. You can still reply, and Maya will
              answer from the note.
            </p>
          )}
        </section>
      </MayaConversation>
    </article>
  );
}

/** One ranked point: the claim, the argument, then each note and work it rests on. */
function Point({ point, cited }: { point: MayaPoint; cited: Map<string, MayaThreadNote> }) {
  return (
    <div className="flex gap-3">
      <span className="tabular w-4 shrink-0 text-body font-semibold text-ink-muted">
        {point.rank}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold text-ink">{point.claim}</p>
        <p className="mt-1 whitespace-pre-line text-body text-ink">
          <LinkedText text={point.argument} />
        </p>

        {point.notes.length > 0 && (
          <ul className="mt-3 space-y-3" aria-label="From your notes">
            {point.notes.map((note, index) => {
              const link = cited.get(note.noteId);
              return (
                <li key={`${note.noteId}-${index}`}>
                  {/* Your own words, on the vault's tint with its accent down
                      the side, so they are told apart at a glance from Maya's
                      argument above them and from the outside sources below
                      (note 9d8f9bd9). */}
                  <MapQuote
                    quote={note.quote}
                    className="rounded-r-md border-accent bg-accent-tint py-1.5 pr-3 text-ink"
                  />
                  <p className="mt-1 pl-3.5 text-ui text-ink-muted">
                    {link ? (
                      // A plain anchor: a browser acts on a text fragment only
                      // on a document load, as on the map's theme page.
                      <a
                        href={`${noteHref(link.path)}${quoteFragment(note.quote)}`}
                        className="font-medium text-ink underline-offset-2 hover:underline"
                      >
                        {link.title}
                      </a>
                    ) : (
                      <span className="font-medium text-ink">{note.title}</span>
                    )}
                    {'. '}
                    {note.point}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {point.sources.length > 0 && (
          <ul className="mt-3 space-y-2" aria-label="From outside sources">
            {point.sources.map((source, index) => (
              // Someone else's work, on the sunken ground: a different
              // voice from your notes above, and set apart from Maya's own.
              <li
                key={`${source.author}-${index}`}
                className="rounded-md bg-sunken px-3 py-2 text-ui text-ink"
              >
                <span className="font-medium">{source.author}</span>, <cite>{source.work}</cite>
                <span className="text-ink-muted"> (paraphrased): </span>
                {source.gist}
                {source.exactText && <MapQuote quote={source.exactText} className="mt-1.5" />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The reconciliation of two positions of yours that conflict, when the note turns on them. */
function Synthesis({ synthesis }: { synthesis: MayaSynthesis }) {
  const [left, right] = synthesis.positionNames;
  return (
    <div className="mt-2 rounded-card bg-sunken p-4">
      <p className="text-ui font-medium text-ink">
        Reconciling &ldquo;{left}&rdquo; and &ldquo;{right}&rdquo;
      </p>
      <p className="mt-1 whitespace-pre-line text-body text-ink">
        <LinkedText text={synthesis.resolution} />
      </p>
    </div>
  );
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
