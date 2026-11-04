'use client';

import { LaterMenu } from '@/components/inbox/snooze-menu';
import { useToast } from '@/components/ui/toast';
import { closedToast } from '@/lib/core/lifecycle';
import { restoreAsideAction, setAsideAction } from '../home-actions';

/**
 * Not now on the step of yours under Now on a goal's Plan tab (plan
 * #2778.12), as the approved mockup draws it beside Done. It is the Goals
 * home's Later on a step: the same days, the step's start date set to the
 * one chosen so it moves to Later on the plan, and Undo in the toast putting
 * the dates back. The card hides at once; a refusal brings it back.
 */
export function NotNow({
  stepId,
  title,
  onAside,
}: {
  stepId: string;
  title: string;
  onAside: (hidden: boolean) => void;
}) {
  const toast = useToast();
  const choose = async (choice: string) => {
    onAside(true);
    const form = new FormData();
    form.set('id', stepId);
    form.set('choice', choice);
    const result = await setAsideAction(form);
    if (result.error || !result.before) {
      onAside(false);
      toast({ text: result.error ?? 'It could not be set aside.' });
      return;
    }
    const before = result.before;
    const text = closedToast('later', title);
    toast({
      text: result.message ? `${text}, ${result.message}` : text,
      undone: 'Put back.',
      undo: async () => {
        const back = new FormData();
        back.set('id', before.id);
        back.set('startsOn', before.startsOn ?? '');
        back.set('dueOn', before.dueOn ?? '');
        const restored = await restoreAsideAction(back);
        if (restored.error) throw new Error(restored.error);
        onAside(false);
      },
    });
  };
  return <LaterMenu label={title} word="Not now" outlined onChoose={(choice) => void choose(choice)} />;
}
