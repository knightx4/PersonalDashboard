import Link from 'next/link';

/**
 * Terms of service.
 *
 * Required alongside the privacy policy before Google will brand-verify a
 * restricted-scope app. Plain-language and deliberately short.
 *
 * TODO before launch: have someone qualified review this, and fill in the
 * legal entity, contact address and governing jurisdiction.
 */
export const metadata = { title: 'Terms' };

const LAST_UPDATED = '26 July 2026';

export default function TermsPage() {
  return (
    <article>
      <h1>Terms of Service</h1>
      <p className="!text-ink-faint">Last updated {LAST_UPDATED}</p>

      <p>
        These terms cover your use of Shopping Manager. By creating an account you agree to
        them.
      </p>

      <h2>What the service does</h2>
      <p>
        Shopping Manager collects your purchase records — from your email if you connect an
        inbox, or from what you enter yourself — and presents them as an inventory and a
        spending summary. It does not sell anything, does not process payments, and never has
        access to your payment methods.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be old enough to form a binding contract where you live.</li>
        <li>Keep your password to yourself; you are responsible for activity on your account.</li>
        <li>Do not use the service to break the law or to access anyone else&rsquo;s data.</li>
      </ul>

      <h2>Your data is yours</h2>
      <p>
        You keep all rights to the information you give us. You grant us only the permission
        needed to operate the service for you. You can delete your account at any time from
        Settings, which removes your data permanently.
      </p>

      <h2>Accuracy</h2>
      <p>
        Order details are read automatically from email and can be wrong or incomplete. Amounts
        we could not read confidently are flagged for your review rather than guessed at, but
        the figures shown are a convenience, not a financial record. Do not rely on them for
        accounting or tax purposes. Return deadlines are estimates based on a merchant&rsquo;s
        general policy and may not match the terms of your particular order — always check with
        the merchant.
      </p>

      <h2>Availability</h2>
      <p>
        The service is provided as is, without warranties. We may change or discontinue
        features. We will give reasonable notice before any change that would delete your data.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect or consequential losses, or
        for any loss arising from reliance on figures the service displays, including a missed
        return window.
      </p>

      <h2>Ending it</h2>
      <p>
        You can stop using the service and delete your account at any time. We may suspend an
        account that is being used abusively or unlawfully.
      </p>

      <h2>Contact</h2>
      <p>
        {/* TODO: fill in before launch. */}
        <strong>[TODO: contact email]</strong>
      </p>

      <p className="!mt-8 !text-[13px]">
        <Link href="/privacy" className="text-brand hover:underline">
          Privacy Policy
        </Link>
      </p>
    </article>
  );
}
