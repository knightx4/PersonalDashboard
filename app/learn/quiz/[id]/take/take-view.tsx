import { PageHeader } from '@/components/shell/page-header';
import { outstandingCount, type Quiz, type QuizQuestion } from '@/lib/learn/quiz/model';
import { QuestionForm } from './question-form';

/** The quiz with the question you are on, as the page found it (plan #1602). */
export function TakeQuizView({ quiz, current }: { quiz: Quiz; current: QuizQuestion }) {
  const total = quiz.questions.length;
  const left = outstandingCount(quiz);

  return (
    <>
      <PageHeader
        title={quiz.title}
        description={
          quiz.preparingFor
            ? `For ${quiz.preparingFor}. Answer in your own words — a phrase or a sentence is enough.`
            : 'Answer in your own words — a phrase or a sentence is enough.'
        }
      />

      <div className="max-w-2xl">
        <QuestionForm
          key={current.id}
          quizId={quiz.id}
          questionId={current.id}
          question={current.question}
          position={total - left + 1}
          total={total}
          left={left}
        />
      </div>
    </>
  );
}
