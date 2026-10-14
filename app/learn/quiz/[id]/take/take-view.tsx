import { PageHeader } from '@/components/shell/page-header';
import { outstandingCount, type Quiz, type QuizQuestion } from '@/lib/learn/quiz/model';
import { QuestionForm } from './question-form';
import { PageColumn } from '@/components/shell/page-width';
import type { Subject as PageSubject } from '@/components/shell/page-header';

/** The quiz with the question you are on, as the page found it (plan #1602). */
export function TakeQuizView({
  quiz,
  current,
  path,
}: {
  quiz: Quiz;
  current: QuizQuestion;
  /** The path to this page, from the page (rowSubject); the gallery passes none. */
  path?: PageSubject;
}) {
  const total = quiz.questions.length;
  const left = outstandingCount(quiz);

  return (
    <PageColumn>
      <PageHeader subject={path} title={quiz.title} />

      <div className="max-w-2xl">
        <QuestionForm
          key={current.id}
          quizId={quiz.id}
          questionId={current.id}
          question={current.question}
          position={total - left + 1}
          total={total}
          intro={
            quiz.preparingFor
              ? `For ${quiz.preparingFor}. Answer in your own words — a phrase or a sentence is enough.`
              : 'Answer in your own words — a phrase or a sentence is enough.'
          }
          left={left}
        />
      </div>
    </PageColumn>
  );
}
