import { PageHeader } from '@/components/shell/page-header';
import { MAX_PASTE_CHARS } from '@/lib/learn/quiz/model';
import { QuizForm } from './quiz-form';

export const dynamic = 'force-dynamic';

/**
 * Starting a quiz over material you choose.
 *
 * Nothing is asked of a model here and nothing is generated. The screen ends
 * with a quiz that knows what it is over, which is the row the question
 * writing reads on the next screen.
 */
export default function NewQuizPage() {
  return (
    <>
      <PageHeader
        title="New quiz"
        description="Pick a few notes, paste anything else, and say what you are preparing for. The questions get written from that material and answered in your own words."
      />

      <div className="max-w-2xl">
        <QuizForm maxPasteChars={MAX_PASTE_CHARS} />
      </div>
    </>
  );
}
