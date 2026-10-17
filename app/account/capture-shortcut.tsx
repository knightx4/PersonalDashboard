import type { ReactNode } from 'react';
import { Disclosure } from '@/components/ui/disclosure';

/**
 * How to build the Siri Shortcut that adds to Dash through a capture token
 * (plan #1707). The address is the app's own origin, read on the server, so
 * what is shown is what to paste. The request and its replies are described
 * in docs/INPUT-CHANNELS.md.
 */
export function CaptureShortcutSection({ address }: { address: string }) {
  return (
    <section>
      <Disclosure
        title={<h3 className="text-ui font-semibold">Add to Dash with Siri</h3>}
        meta="Six steps"
        remember="account-siri-shortcut"
        bodyClassName="mt-3"
      >
        <p className="text-ui text-ink-muted">
          Build this once in the Shortcuts app on your iPhone. Then say &ldquo;Hey Siri, add to
          Dash&rdquo; and speak what you want kept. Make an Adds only token above first and keep it
          copied.
        </p>

        <ol className="mt-4 list-decimal space-y-3 pl-5 text-ui text-ink marker:text-ink-muted">
          <li>
            Open Shortcuts, tap +, and name the shortcut <Term>Add to Dash</Term>. Siri answers to
            that name.
          </li>
          <li>
            Add <Term>Dictate Text</Term>. To type instead of speaking, add{' '}
            <Term>Ask for Input</Term>.
          </li>
          <li>
            Add <Term>Get Contents of URL</Term> and set its URL to:
            <Code>{address}</Code>
          </li>
          <li>
            Tap Show More, set Method to <Term>POST</Term>, and add two headers.
            <Code>Authorization: Bearer your token</Code>
            <Code>Content-Type: application/json</Code>
            <span className="mt-1.5 block">
              Replace <Term>your token</Term> with the whole token, including the <Term>dash_</Term>{' '}
              at its start.
            </span>
          </li>
          <li>
            Set Request Body to <Term>JSON</Term> and add one Text field named <Term>text</Term>.
            Tap its value and choose Dictated Text, or Provided Input if you used Ask for Input.
          </li>
          <li>
            Add <Term>Get Dictionary Value</Term> for the key <Term>spoken</Term> from Contents of
            URL, then <Term>Speak Text</Term>. Dash answers every request with a sentence there,
            including when something went wrong.
          </li>
        </ol>

        <h3 className="mt-5 text-ui font-semibold text-ink">Options</h3>
        <ul className="mt-1 list-disc space-y-2 pl-5 text-ui text-ink marker:text-ink-muted">
          <li>
            To file in one place, add a Text field named <Term>place</Term> with <Term>todo</Term>,{' '}
            <Term>goals</Term>, <Term>jobs</Term> or <Term>vault</Term>. Without it Dash decides,
            and keeps anything it is unsure of as a to-do for today.
          </li>
          <li>
            To share a link from Safari, open the shortcut&rsquo;s details and turn on Show in Share
            Sheet. Add a Text field named <Term>url</Term> set to Shortcut Input. The{' '}
            <Term>text</Term> field can then be empty.
          </li>
        </ul>

        <h3 className="mt-5 text-ui font-semibold text-ink">If it does not work</h3>
        <p className="mt-1 text-ui text-ink">
          Siri reads out what Dash said. If it says the token is not one Dash knows, or was revoked,
          make a new one and paste it in again. If it says there were too many captures, wait the
          time it names. A filing you did not want can be undone from Home.
        </p>
      </Disclosure>
    </section>
  );
}

/**
 * How to build the Siri Shortcut that asks Dash a question through an ask
 * token. The address is the app's own origin, read on the server. The request
 * and its replies are described in docs/INPUT-CHANNELS.md.
 */
export function AskShortcutSection({ address }: { address: string }) {
  return (
    <section>
      <Disclosure
        title={<h3 className="text-ui font-semibold">Ask Dash with Siri</h3>}
        meta="Six steps"
        remember="account-siri-ask-shortcut"
        bodyClassName="mt-3"
      >
        <p className="text-ui text-ink-muted">
          Build this once in the Shortcuts app on your iPhone. Then say &ldquo;Hey Siri, ask
          Dash&rdquo;, wait for Siri to listen, and say what you want: a question such as &ldquo;how
          many jobs did I apply to today?&rdquo;, or something to do, such as &ldquo;add call the
          dentist to my todos.&rdquo; Make an Asks Dash token above first and keep it copied.
        </p>

        <ol className="mt-4 list-decimal space-y-3 pl-5 text-ui text-ink marker:text-ink-muted">
          <li>
            Open Shortcuts, tap +, and name the shortcut <Term>Ask Dash</Term>. Siri answers to that
            name.
          </li>
          <li>
            Add <Term>Dictate Text</Term>. To type instead of speaking, add{' '}
            <Term>Ask for Input</Term>.
          </li>
          <li>
            Add <Term>Get Contents of URL</Term> and set its URL to:
            <Code>{address}</Code>
          </li>
          <li>
            Tap Show More, set Method to <Term>POST</Term>, and add two headers.
            <Code>Authorization: Bearer your token</Code>
            <Code>Content-Type: application/json</Code>
            <span className="mt-1.5 block">
              Replace <Term>your token</Term> with the whole Asks Dash token, including the{' '}
              <Term>dash_</Term> at its start.
            </span>
          </li>
          <li>
            Set Request Body to <Term>JSON</Term> and add one Text field named{' '}
            <Term>question</Term>. Tap its value and choose Dictated Text, or Provided Input if you
            used Ask for Input.
          </li>
          <li>
            Add <Term>Get Dictionary Value</Term> for the key <Term>spoken</Term> from Contents of
            URL, then <Term>Speak Text</Term>. Dash answers every request with something to say
            there, including when something went wrong.
          </li>
        </ol>

        <h3 className="mt-5 text-ui font-semibold text-ink">What to expect</h3>
        <ul className="mt-1 list-disc space-y-2 pl-5 text-ui text-ink marker:text-ink-muted">
          <li>
            Most answers take a few seconds. One that needs several lookups can take up to forty,
            and Shortcuts waits for it.
          </li>
          <li>
            Dash does what it would do in Ask: it looks things up, adds todos and quick notes, and
            makes the other changes it can make there. Each change is kept in Ask with an Undo.
            Anything Ask would show you to confirm first, Dash says it cannot do by voice.
          </li>
          <li>
            Each request is kept in Ask, with the whole answer. A long answer is cut short when it
            is read out, and the rest is there.
          </li>
          <li>
            To open the answer afterwards, add <Term>Get Dictionary Value</Term> for the key{' '}
            <Term>href</Term> from Contents of URL, then <Term>Open URLs</Term>.
          </li>
        </ul>

        <h3 className="mt-5 text-ui font-semibold text-ink">If it does not work</h3>
        <p className="mt-1 text-ui text-ink">
          Siri reads out what Dash said. If it says the token is a capture token, make an Asks Dash
          token and paste that in. If it says the token is not one Dash knows, or was revoked, make
          a new one. If it says there were too many questions, wait the time it names.
        </p>
      </Disclosure>
    </section>
  );
}

function Term({ children }: { children: ReactNode }) {
  return <span className="font-medium">{children}</span>;
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="mt-1.5 block rounded-control bg-sunken px-3 py-2 font-mono text-small text-ink select-all [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}
