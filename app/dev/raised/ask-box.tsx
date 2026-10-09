'use client';

import { useState } from 'react';
import { useAskDash } from '@/components/shell/ask-dash';
import { Button } from '@/components/ui/button';
import { ComposeBody, ComposeBox } from '@/components/ui/field';
import { DashMark } from '@/components/ui/dash-mark';

/**
 * Ask Dash from the top of Home. Most of what is done from this page starts
 * as a question or an instruction, and the sheet behind the Dash button was
 * one press further away than a box on the page. Sending opens that sheet on
 * the question and asks it at once, so the answer, its links and any change
 * Dash proposes are read where they always are.
 *
 * Nothing is drawn outside the shell, where there is no sheet to open.
 */
export function AskBox() {
  const handle = useAskDash();
  const [question, setQuestion] = useState('');
  if (!handle) return null;

  const send = () => {
    const asked = question.trim();
    if (!asked) return;
    handle.open(asked);
    setQuestion('');
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <label htmlFor="home-ask" className="sr-only">
        Ask Dash
      </label>
      <ComposeBox>
        <ComposeBody
          id="home-ask"
          rows={1}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask Dash, or tell it what to do"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="flex justify-end pt-1.5">
          <Button type="submit" size="sm" disabled={!question.trim()}>
            <DashMark size="2xs" decorative />
            Ask
          </Button>
        </div>
      </ComposeBox>
    </form>
  );
}
