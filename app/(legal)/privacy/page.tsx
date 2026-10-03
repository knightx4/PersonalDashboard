import Link from 'next/link';

/**
 * Privacy policy.
 *
 * Written against the actual retention behaviour in lib/email (Stage 5:
 * nothing but structured order data is persisted), not from a template. A
 * human Google reviewer reads this during brand verification, and a policy
 * that does not match what the app does is a common rejection reason.
 *
 * BEFORE SUBMITTING FOR VERIFICATION: re-read this against the shipped
 * ingestion code and correct anything that has drifted. Every claim below is a
 * commitment the code has to keep. The placeholders marked TODO must be filled
 * in with the real legal entity, contact address and domain.
 */
export const metadata = {
  title: 'Privacy',
  description: 'What Personal Dashboard reads, what it stores, and what it never keeps.',
};

const LAST_UPDATED = '1 October 2026';

export default function PrivacyPage() {
  return (
    <article>
      <h1>Privacy Policy</h1>
      <p className="!text-ink-muted">Last updated {LAST_UPDATED}</p>

      <p>
        Personal Dashboard helps you see what you already own and what you spend. To do that it
        can, with your permission, read purchase-related messages in your email. This page
        explains exactly what it reads, what it keeps, and what it never keeps.
      </p>
      <p>
        It can also send notes from your notes vault to a language model when you ask it to. The
        section on your notes says what is sent.
      </p>
      <p>
        And when you ask Dash, the app&rsquo;s assistant, a question, it can search your connected
        Gmail and read a message it finds. The section on asking Dash about your email says what
        that sends and what it keeps.
      </p>

      <h2>Who we are</h2>
      <p>
        {/* TODO: replace with the real legal entity and address before verification. */}
        Personal Dashboard is operated by <strong>[TODO: legal entity name]</strong>. You can
        reach us at <strong>[TODO: contact email]</strong>.
      </p>

      <h2>Google user data we access</h2>
      <p>
        If you choose to connect a Gmail account, we request the{' '}
        <code>https://www.googleapis.com/auth/gmail.readonly</code> scope. This is a restricted
        scope and it is read-only: we can never send, modify, or delete anything in your
        mailbox.
      </p>
      <p>We use it for two purposes:</p>
      <ul>
        <li>
          To find messages that are order confirmations, shipping and delivery notices,
          cancellations, and return or refund confirmations, and to extract the purchase
          details from them.
        </li>
        <li>
          To answer a question you ask Dash about your email, by searching your mailbox at the
          moment you ask and, when the question is about what a message says, reading that
          message. This is described in the section on asking Dash about your email.
        </li>
      </ul>
      <p>
        We do not download your mailbox for either. For purchases we ask Google for messages
        matching a narrow search: purchase-related subject lines and sender patterns, within
        the time window you choose when connecting (30 days to 2 years, 180 days by default).
        When you ask Dash, the search is built from the sender, words and dates your question
        names, and is run in Gmail itself across every mailbox you have connected.
      </p>

      <h2>What we store</h2>
      <p>From messages that turn out to be purchases, we keep the structured facts:</p>
      <ul>
        <li>Merchant, order number, order date, and currency</li>
        <li>Line items: product name, variant, quantity, and price</li>
        <li>Subtotal, tax, shipping, discount, and total</li>
        <li>Shipment status, tracking numbers, and delivery dates</li>
        <li>Return and refund status and refunded amounts</li>
        <li>
          The message identifier, its subject line, and the sender address, so we can show you
          where an order came from and correct it if we read it wrong
        </li>
      </ul>

      <h2>What we never store</h2>
      <ul>
        <li>
          <strong>The body of any email.</strong> Message content is held in memory only while
          a message is being read, and is never written to our database, our logs, or our error
          reports.
        </li>
        <li>
          <strong>Anything about your unrelated mail.</strong> Most messages we look at turn
          out not to be purchases. For those we record only the message identifier and the date,
          so we know to skip the message next time. We do not keep the subject line or the
          sender. This is enforced by a constraint in our database, not by convention.
        </li>
        <li>
          <strong>Attachments</strong>, with one exception described below: the calendar
          invite attached to an interview email.
        </li>
      </ul>

      <h2>Calendar invites</h2>
      <p>
        An interview email usually carries a calendar invite &mdash; the same attachment your
        mail app uses to offer you an &ldquo;add to calendar&rdquo; button. We read it, because
        it states the time of your interview precisely and the surrounding sentence rarely
        does.
      </p>
      <p>
        From that invite we keep <strong>the appointment and nothing else</strong>: the start
        time and time zone, how long it runs, the meeting link or the location as the organiser
        wrote it, the names and work addresses of the people invited, and the invite&rsquo;s own
        identifier so that a rescheduled interview updates the one already on your board instead
        of appearing twice. The invite&rsquo;s description text is read and discarded with the
        rest of the message body.
      </p>
      <p>
        This needs no access to your calendar. We do not connect to Google Calendar, we cannot
        see appointments that did not arrive by email, and we never write anything to a calendar
        of yours.
      </p>

      <h2>Automated processing</h2>
      <p>
        To read a purchase email we may send the message text to a large language model
        provider, which returns the structured order details. We send only what is needed to
        read that one message, we do not send your identity along with it, and we disable
        provider-side retention where the provider supports it. The provider does not use this
        content to train models.
      </p>
      <p>
        Asking Dash about your email also sends parts of your messages to a language model, as the
        next section describes.
      </p>

      <h2>Asking Dash about your email</h2>
      {/*
        Written against lib/inbox/search-mail.ts (searchMail, MAIL_SEARCH_LIMIT,
        format=metadata), lib/inbox/read-mail.ts (readMail, MAIL_TEXT_LIMIT,
        format=full), lib/ask/mail.ts (the rows the model reads, the citation
        kept, and `kept` replacing each result on the saved tool call) and
        keptResult in lib/dash/loop.ts, plans #1315 to #1317. IN_APP_ONLY_TOOLS in
        lib/ask/tools.ts keeps both tools off the connector (lib/connector/mcp.ts).
        A change to what either tool sends or keeps has to be made here too.
      */}
      <p>
        If a Gmail account is connected, Dash can answer questions such as &ldquo;when did Anthony
        last email me?&rdquo; or &ldquo;what did the landlord say about the deposit?&rdquo;. It
        works whichever parts of the app you have switched on, and only when you ask. Dash
        searches Gmail at that moment, through the read-only access described above, across every
        mailbox you have connected. Nothing is copied from your mailbox in advance, and the app
        builds no index of your mail.
      </p>
      <p>
        What Dash reads goes to Anthropic&rsquo;s Claude models, which write the answer. What is
        sent:
      </p>
      <ul>
        <li>
          <strong>For a search,</strong> up to 20 matching messages, newest first, across all your
          mailboxes. For each one: the sender, the recipients, the subject, the date and time it
          arrived, and Gmail&rsquo;s one-line preview of it. When more than one mailbox is
          connected, the address of the mailbox it is in is sent too. A search reads only these
          headers and the preview, and never fetches the message text.
        </li>
        <li>
          <strong>For a message Dash opens,</strong> the same details for that one message and its
          text, up to the first 8,000 characters. The text is the message&rsquo;s plain-text
          version, or its formatted version converted to plain text when there is no plain one.
          Attachments, including calendar invites, are not sent. Dash opens a message only when
          your question is about what it says, and only the messages the question is about.
        </li>
      </ul>
      <p>
        Because the recipients and the mailbox address are part of what is sent, your email
        address can be among it. Your question and the earlier turns of the same conversation are
        sent with it, so Dash can answer follow-ups.
      </p>
      <p>
        Nothing Dash reads from your mail is stored. The search results and the message text are
        held in memory for the one answer and then discarded. What is saved with the conversation
        is:
      </p>
      <ul>
        <li>Your question and Dash&rsquo;s answer.</li>
        <li>
          For each message Dash cites, a label naming the sender and the day it arrived, the link
          that opens it in Gmail, and the identifiers of the message and of the mailbox it is in.
        </li>
        <li>
          What Dash searched for (the sender, words and dates) and which message it opened, with
          the number of messages each search found.
        </li>
      </ul>
      <p>
        No subject line, preview or message text is saved, except where Dash quotes or describes
        it in the answer it writes. Dash&rsquo;s email search is available only inside the app,
        and is not offered to other assistants you connect to your dashboard.
      </p>

      <h2>Your notes and the language model</h2>
      {/*
        Written against lib/learn/quiz (generate.ts, grade.ts, plan.ts),
        lib/learn/vault/classify.ts with app/learn/know/actions.ts
        (proposeFromNote) and lib/learn/graph/from-brief.ts, and lib/vault/map
        (classify.ts, extract.ts, rules.ts) with app/vault/n/[...path]/actions.ts
        (proposeMap), and the sweep over the whole vault in lib/vault/map/sweep.ts
        with inngest/vault/map-sweep.ts (plan #757), and Maya in lib/vault/maya
        (retrieve.ts, thought-model.ts) with app/vault/n/[...path]/actions.ts
        (askMaya, plan #1285), and replies to Maya in lib/vault/maya/reply.ts with
        app/vault/maya/actions.ts (replyToMaya, plan #1286), both on Dash's loop
        in lib/dash/loop.ts in Maya's voice (lib/vault/maya/voice.ts, plan #1479),
        the reply with Dash's lookups (lib/ask/tools.ts, note_positions in
        lib/ask/positions.ts), and Maya's hourly
        job in lib/vault/maya/gate-run.ts with inngest/vault/maya-gate.ts (plan
        #1289), which asks Jev (lib/vault/maya/gate.ts) before Maya writes. The
        map sweep's first read also goes to Jev for an account that has opted in
        (lib/vault/map/jev-question.ts, lib/jev/enabled.ts). The sweep skips what
        rules.ts skips (the Me folder and notes with API keys), notes under 80
        characters, and text past MAX_NOTE_READ_CHARS in
        lib/learn/graph/note-chunks.ts. Any new path that sends note text to a
        model has to be added here before it ships, along with what it skips.
      */}
      <p>
        Four features send the text of your notes to Anthropic&rsquo;s Claude models: writing a
        quiz, reading a note for Learn, reading notes for the map of what you write about, and
        asking Maya for its thoughts on a note and replying to it. Writing a quiz, reading for
        Learn, asking Maya and replying to it run when you press their button, on the note or notes you picked. Maya can also write on a new note of yours without being asked, as described below. The map can also be filled by a sweep, which you start from the map page. The
        sweep sends every note in your vault, apart from those listed below, without you picking
        them. It runs in the background a few minutes at a time until it has reached every note or
        you stop it.
      </p>
      <p>What is sent:</p>
      <ul>
        <li>
          <strong>Writing a quiz.</strong> The title of each note you picked and the text the
          questions are written from. A short note is sent whole. A long one is split at its
          headings, and the sections the questions come from are sent. When you answer, the
          question, the answer the model expected, your answer and the note&rsquo;s title are
          sent so your answer can be marked.
        </li>
        <li>
          <strong>Reading a note for Learn.</strong> First the note&rsquo;s title and its first
          1,500 characters, to decide whether it argues anything. If it does, the note is sent
          again, section by section up to its first ten sections, with the name of the subject
          you chose and the names of the ideas already in that subject, so none is proposed
          twice.
        </li>
        <li>
          <strong>Reading notes for the map.</strong> First the note&rsquo;s title and its first
          1,500 characters, to decide whether it argues anything. If it does, the note is sent one
          section at a time, each with the note&rsquo;s title, the section&rsquo;s heading and the
          names of the themes already on your map. This happens to one note when you use its Map
          section, and to every note in turn while a sweep runs.
        </li>
        <li>
          <strong>Asking Maya about a note.</strong> The note&rsquo;s title and its first 12,000
          characters; the titles and first 1,500 characters of up to eight of your other notes
          whose meaning is closest to it; and the names and statements of up to sixteen positions
          from your map that come from those notes or share the note&rsquo;s themes, each with up
          to two sentences quoted from the notes they were read from. The model may also search
          the web for what others have written on the same question. Its searches are its own
          words, written from what it was sent, and go to Anthropic&rsquo;s web search.
        </li>
        <li>
          <strong>Replying to Maya.</strong> The note&rsquo;s title and its first 12,000
          characters, the thread&rsquo;s question, Maya&rsquo;s thought on the note (which carries
          the sentences it quoted from your other notes), the summary of where you have got to,
          and every reply in the thread, yours and Maya&rsquo;s. If the note has since moved into
          a folder that is never read, or now contains what looks like an API key, its text is
          left out and Maya answers from the thread alone. When your reply turns on something the
          thread does not hold, Maya can look it up with the same lookups Dash uses to answer a
          question, such as the notes and positions nearest the note, and what those return is
          sent too. Like a thought, a reply may also search the web for a source&rsquo;s exact words.
        </li>
        <li>
          <strong>Maya writing without being asked.</strong> Once an hour, the notes that are new
          or changed since the last day and a half are looked at, each version once. If Jev (below)
          judges that a note is working something out, Maya writes a thought on it and opens a
          thread marked &ldquo;Maya picked&rdquo;, at most three in a day. What is sent to write
          that thought is what is sent when you ask Maya about the note.
        </li>
      </ul>
      <p>
        Jev is a classifier run by TypeSafe, a company separate from Anthropic. It reads your
        notes only if Jev has been turned on for your account, which it is not by default. When it
        is on, two things send note text to TypeSafe. While a map sweep runs, the title and first
        1,500 characters of each note it reads go to Jev for the first read described above. And
        each hour, the title and first 4,000 characters of each new or changed note go to Jev with
        one question: whether the writer is working something out that a thoughtful partner could
        argue with. Only a note Jev is sure of gets a thought from Maya. When Jev is off for your
        account, nothing is sent to TypeSafe and Maya writes only when you ask.
      </p>
      <p>What is never sent:</p>
      <ul>
        <li>For a quiz or for Learn, a note you did not pick.</li>
        <li>
          Your name, email address or account. A request carries the note and the instructions,
          and nothing that says whose note it is.
        </li>
        <li>The folder or file path of a note. Only its title is sent.</li>
        <li>
          The rest of a note that the first read judges to be a record rather than an argument,
          such as a travel plan or a log of measurements. Only its first 1,500 characters were
          sent.
        </li>
        <li>
          For the map, from a sweep or from one note: any part of a note in your Me folder, which
          holds your journals, of a note in Career/Job Applications, of a note that contains what looks like an API key, or of a note
          under 80 characters. These are turned away before anything is sent.
        </li>
        <li>For the map, the part of a note past its first 400,000 characters.</li>
        <li>
          When asking Maya: any part of a note in your Me folder, of a note in Career/Job
          Applications, or of a note that contains what looks like an API key, whether it is the
          note you asked about or one of your other notes. Such a note shows no way to ask Maya
          at all.
        </li>
        <li>
          To Jev: the folder or file path of a note, or any part of a note in your Me folder, of a
          note in Career/Job Applications, of a note that contains what looks like an API key, or
          of a note under 80 characters. Maya does not write on such a note by itself.
        </li>
      </ul>
      <p>
        Nothing sent from your notes is used to train a model. Anthropic&rsquo;s{' '}
        <a
          href="https://www.anthropic.com/legal/commercial-terms"
          className="text-accent hover:underline"
        >
          commercial terms
        </a>{' '}
        do not allow it to train models on what is sent through its API, and this app does not
        train models of its own.
      </p>

      <h2>How your data is protected</h2>
      <ul>
        <li>
          The tokens that let us read your mailbox are encrypted before they are stored, with a
          key held separately from the database.
        </li>
        <li>All traffic is encrypted in transit.</li>
        <li>
          Every record is tied to your account and isolated at the database level, so one
          user&rsquo;s data cannot be read by another. We test this automatically on every
          change.
        </li>
        <li>Access to production systems is limited to what is needed to operate the service.</li>
      </ul>

      <h2>Sharing</h2>
      <p>
        We do not sell your data, and we do not share it for advertising. We use a small number
        of service providers to run the service — hosting, database, background job processing,
        and the language model provider described above — and they may process data only on our
        instructions.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>
          <strong>You never have to connect an inbox.</strong> The app works with orders you add
          by hand.
        </li>
        <li>
          <strong>Disconnect at any time</strong>, from Settings. Doing so revokes our access
          token with Google immediately and deletes the data we imported from that account.
        </li>
        <li>
          You can also revoke our access directly at{' '}
          <a
            href="https://myaccount.google.com/permissions"
            className="text-accent hover:underline"
          >
            myaccount.google.com/permissions
          </a>
          .
        </li>
        <li>
          <strong>Delete your account</strong>, from Settings. This revokes any Google tokens,
          removes every record we hold about you, and cannot be undone.
        </li>
      </ul>

      <h2>Retention</h2>
      <p>
        We keep your purchase records until you delete them or delete your account. Message
        identifiers for messages we skipped are kept so that re-syncing does not re-examine
        them, and are deleted when you disconnect the account they belong to.
      </p>

      <h2>Job descriptions are kept in full</h2>
      <p>
        The job search side of the app is a deliberate exception to the retention rule above, and
        it is worth being explicit about because it looks inconsistent otherwise.
      </p>
      <p>
        When you paste a job link or a description, the <strong>full text of the posting is
        stored</strong> and kept indefinitely. Three reasons: it is public information published on
        a public page, it is the input to the requirement extraction and to every draft the app
        writes, and refetching it later usually fails because the posting has been taken down. Job
        descriptions are the employer&rsquo;s text about a role, not your correspondence.
      </p>

      <h2>Looking a company up</h2>
      <p>
        On a company&rsquo;s page you can ask the app to fill in blank details &mdash; industry,
        headquarters, rough headcount, logo. That sends <strong>the company&rsquo;s name to
        Wikidata</strong> and may fetch the company&rsquo;s own public homepage to read its
        icon. Nothing about you is sent with either request, and neither happens unless you
        press the button.
      </p>
      <p>
        Separately, company logos on the board and in lists fall back to{' '}
        <strong>Google&rsquo;s public favicon endpoint</strong> when no logo has been stored yet.
        Your browser requests it directly, so what Google can see is the company&rsquo;s domain
        alongside your IP address &mdash; in aggregate, the list of companies you are looking at.
        No key, no account, and nothing about the role or the application is sent. If that trade
        is not one you want, set <code>USE_FAVICON_SERVICE</code> to false in{' '}
        <code>lib/jobs/companies/avatar.ts</code>: logos then come only from Wikidata and the
        company&rsquo;s own site, and everything else shows initials.
      </p>

      <h2>Information about other people</h2>
      <p>
        The contacts feature on the job search side stores information about third parties &mdash;
        recruiters, interviewers, people you want an introduction to. They have not agreed to
        anything, so the app is deliberately narrow about it.
      </p>
      <ul>
        <li>
          The schema has room for a <strong>name, job title, public professional profile URL and
          work email address</strong>, and nothing else. There is nowhere to put a personal phone
          number or a home address.
        </li>
        <li>
          Nothing is scraped. Contacts are typed in or pasted by you. The app does not read
          LinkedIn, and does not fetch anything behind a login.
        </li>
        <li>
          Names of interviewers may be extracted from a scheduling email, or read from the
          calendar invite attached to it, because that is what the email is about. Their work
          address is kept when the invite lists it, so the same person is recognised next time
          rather than added twice. Nothing else about them is extracted.
        </li>
      </ul>

      <h2>Limited Use</h2>
      <p>
        {/*
          Left as "Shopping Manager" deliberately: this is the app name Google
          has on file from OAuth consent screen registration and brand
          verification, and this clause is what a reviewer checks it against.
          Rename it here only after renaming the registration itself in
          Google Cloud Console -- changing the two independently is worse
          than the current name being stale.
        */}
        Shopping Manager&rsquo;s use and transfer of information received from Google APIs
        adheres to the{' '}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          className="text-accent hover:underline"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>Changes</h2>
      <p>
        If we change how we handle your data we will update this page and the date at the top.
      </p>

      <p className="!mt-8 !text-ui">
        <Link href="/terms" className="text-accent hover:underline">
          Terms of Service
        </Link>
      </p>
    </article>
  );
}
