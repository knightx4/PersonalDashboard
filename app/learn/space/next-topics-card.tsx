import { Card } from '@/components/ui/card';
import { MAX_NEXT_TOPICS, type NextTopic } from '@/lib/learn/map/next-topics';
import { TopicSwatch } from './swatch';

/**
 * The rail's card for the topics next to what you know (plan #2016.6), beside
 * "Topics you have reached". Each row names a Level 4 topic you have not lit,
 * the lit topic it sits beside, and the goal that ranked it, best first and
 * five at most. Learn now draws its cards on these topics from the same
 * list, so the card says where they come from.
 *
 * `topics` is null when the list could not be read, which is said rather
 * than drawn as an empty list, and undefined where nothing loads it.
 */
export function NextTopicsCard({ topics }: { topics?: NextTopic[] | null }) {
  if (topics === undefined) return null;
  const shown = (topics ?? []).slice(0, MAX_NEXT_TOPICS);
  return (
    <Card padding="standard">
      <h2 className="text-ui font-semibold text-ink">Next to what you know</h2>
      {topics === null ? (
        <p className="mt-1 text-ui text-ink-muted">The topics next to what you know could not be read just now.</p>
      ) : shown.length === 0 ? (
        <p className="mt-1 text-ui text-ink-muted">
          Once a topic is lit by ideas you know, the topics beside it show here.
        </p>
      ) : (
        <>
          <ul className="mt-1 divide-y divide-border">
            {shown.map((topic) => (
              <li key={topic.id} className="flex items-start gap-2 py-2">
                <TopicSwatch kind="landmark" className="mt-1" />
                <span className="min-w-0 flex-1">
                  <span className="block text-ui text-ink">{topic.title}</span>
                  <span className="block text-small text-ink-muted">
                    Beside {topic.beside.title}
                    {topic.aim ? ` · for ${topic.aim.name}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {shown.some((topic) => topic.aim) && (
            <p className="mt-1 text-small text-ink-muted">Learn now brings you cards on these.</p>
          )}
        </>
      )}
    </Card>
  );
}
