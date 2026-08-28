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
  description: 'What Shopping Manager reads, what it stores, and what it never keeps.',
};

const LAST_UPDATED = '26 July 2026';

export default function PrivacyPage() {
  return (
    <article>
      <h1>Privacy Policy</h1>
      <p className="!text-ink-faint">Last updated {LAST_UPDATED}</p>

      <p>
        Shopping Manager helps you see what you already own and what you spend. To do that it
        can, with your permission, read purchase-related messages in your email. This page
        explains exactly what it reads, what it keeps, and what it never keeps.
      </p>

      <h2>Who we are</h2>
      <p>
        {/* TODO: replace with the real legal entity and address before verification. */}
        Shopping Manager is operated by <strong>[TODO: legal entity name]</strong>. You can
        reach us at <strong>[TODO: contact email]</strong>.
      </p>

      <h2>Google user data we access</h2>
      <p>
        If you choose to connect a Gmail account, we request the{' '}
        <code>https://www.googleapis.com/auth/gmail.readonly</code> scope. This is a restricted
        scope and it is read-only: we can never send, modify, or delete anything in your
        mailbox.
      </p>
      <p>We use it for one purpose only:</p>
      <ul>
        <li>
          To find messages that are order confirmations, shipping and delivery notices,
          cancellations, and return or refund confirmations, and to extract the purchase
          details from them.
        </li>
      </ul>
      <p>
        To limit what we look at, we do not download your mailbox. We ask Google for messages
        matching a narrow search — purchase-related subject lines and sender patterns, within
        the time window you choose when connecting (30 days to 2 years, 180 days by default).
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
        <li>Attachments, contacts, or calendar data.</li>
      </ul>

      <h2>Automated processing</h2>
      <p>
        To read a purchase email we may send the message text to a large language model
        provider, which returns the structured order details. We send only what is needed to
        read that one message, we do not send your identity along with it, and we disable
        provider-side retention where the provider supports it. The provider does not use this
        content to train models.
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
            className="text-brand hover:underline"
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
          Names of interviewers may be extracted from a scheduling email, because that is what the
          email is about. Nothing else about them is extracted.
        </li>
      </ul>

      <h2>Limited Use</h2>
      <p>
        Shopping Manager&rsquo;s use and transfer of information received from Google APIs
        adheres to the{' '}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          className="text-brand hover:underline"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>Changes</h2>
      <p>
        If we change how we handle your data we will update this page and the date at the top.
      </p>

      <p className="!mt-8 !text-[13px]">
        <Link href="/terms" className="text-brand hover:underline">
          Terms of Service
        </Link>
      </p>
    </article>
  );
}
