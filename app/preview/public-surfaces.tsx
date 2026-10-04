import FrontPage from '@/app/page';
import AuthLayout from '@/app/(auth)/layout';
import LoginPage from '@/app/(auth)/login/page';
import SignupPage from '@/app/(auth)/signup/page';
import ResetPasswordPage from '@/app/(auth)/reset-password/page';
import { ConsentRequest } from '@/app/(auth)/oauth/consent/consent-view';
import AuthCodeErrorPage from '@/app/auth/auth-code-error/page';
import LegalLayout from '@/app/(legal)/layout';
import PrivacyPage from '@/app/(legal)/privacy/page';
import TermsPage from '@/app/(legal)/terms/page';
import { OnboardingFrame } from '@/app/(onboarding)/frame';
import { OnboardingSteps } from '@/app/(onboarding)/onboarding/onboarding-steps';
import { ShareForm } from '@/app/s/[token]/share-form';
import type { ShareGroup, SharePage } from '@/lib/share/read/load-disposition';
import { NoLongerThere } from '@/app/open/[ref]/no-longer-there';

/**
 * The pages a visitor reaches before signing in, or outside the app's shell,
 * in the surface gallery (plan #1599): the front door, the sign-in cards, the
 * legal pages, the first-run steps, the shared keep-or-sell form, and the page
 * a ref that opens nothing lands on.
 *
 * Each draws its own whole screen, so most are `screen` surfaces. The pages
 * that read nothing are rendered as they are, inside their own layouts; the
 * ones that read a session or a database draw the view the page hands its
 * data to.
 */

export function FrontDoorSurface() {
  return <FrontPage />;
}

export function LoginSurface() {
  return (
    <AuthLayout>
      <LoginPage searchParams={Promise.resolve({ error: 'oauth' })} />
    </AuthLayout>
  );
}

export function SignupSurface() {
  return (
    <AuthLayout>
      <SignupPage searchParams={Promise.resolve({})} />
    </AuthLayout>
  );
}

export function ResetPasswordSurface() {
  return (
    <AuthLayout>
      <ResetPasswordPage />
    </AuthLayout>
  );
}

export function AuthCodeErrorSurface() {
  return <AuthCodeErrorPage />;
}

/** Claude asking to connect, with the longest address the allow-list lets through. */
export function ConsentSurface() {
  return (
    <AuthLayout>
      <ConsentRequest
        name="Claude"
        redirectUri="https://claude.ai/api/mcp/auth_callback?connector=personal-dashboard"
        email="christopher.kloughton.long-address@example.com"
        authorizationId="preview"
        failed={false}
      />
    </AuthLayout>
  );
}

export function PrivacySurface() {
  return (
    <LegalLayout>
      <PrivacyPage />
    </LegalLayout>
  );
}

export function TermsSurface() {
  return (
    <LegalLayout>
      <TermsPage />
    </LegalLayout>
  );
}

export function OnboardingWelcomeSurface() {
  return (
    <OnboardingFrame>
      <OnboardingSteps step="welcome" inbox={undefined} configured />
    </OnboardingFrame>
  );
}

/** The Gmail step after Google came back without read access. */
export function OnboardingGmailSurface() {
  return (
    <OnboardingFrame>
      <OnboardingSteps step="gmail" inbox="scope_denied" configured />
    </OnboardingFrame>
  );
}

function group(over: Partial<ShareGroup> & Pick<ShareGroup, 'groupKey' | 'name'>): ShareGroup {
  const g = {
    familyKey: null,
    familyLabel: null,
    quantity: 1,
    imageUrl: null,
    unitPriceCents: null,
    keepQty: 0,
    sellQty: 0,
    giveawayQty: 0,
    note: null,
    answeredAt: null,
    ...over,
  };
  return { ...g, undecided: g.quantity - g.keepQty - g.sellQty - g.giveawayQty };
}

const catan = [
  group({
    groupKey: 'g1',
    familyKey: 'catan',
    familyLabel: 'Catan',
    name: 'Catan: Cities & Knights Expansion (5th Edition, with the 5-6 player extension)',
    unitPriceCents: 4499,
    keepQty: 1,
    answeredAt: '2026-10-01T10:00:00Z',
  }),
  group({ groupKey: 'g2', familyKey: 'catan', familyLabel: 'Catan', name: 'Catan', quantity: 3, unitPriceCents: 3999, keepQty: 1, sellQty: 1 }),
];
const loose = [
  group({ groupKey: 'g3', name: 'Azul', unitPriceCents: 2999 }),
  group({ groupKey: 'g4', name: 'Ticket to Ride: Europe', sellQty: 1, answeredAt: '2026-10-02T09:00:00Z', note: 'Missing two train cars' }),
];

const sharePage: SharePage = {
  title: 'Board games before the move',
  intro: 'We are moving at the end of the month and these will not all fit. Say what should happen to each one.',
  kind: 'disposition',
  canRespond: true,
  groups: [...catan, ...loose],
  families: [
    { key: 'catan', label: 'Catan', groups: catan },
    { key: null, label: null, groups: loose },
  ],
  totals: { products: 4, units: 6, decided: 4 },
};

export function ShareFormSurface() {
  return <ShareForm token="preview" page={sharePage} />;
}

/** A ref whose row has been deleted, in the shell's box as /open draws it. */
export function OpenMissingSurface() {
  return (
    <div className="mx-auto max-w-3xl">
      <NoLongerThere />
    </div>
  );
}
