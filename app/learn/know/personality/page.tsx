import { redirect } from 'next/navigation';

/**
 * The personality test was here, under Learn's Know page, until plan #1991.2
 * moved it to You's Personality tab. Nothing is rendered; a link to the old
 * route opens the test in its new place.
 */
export default function PersonalityRedirect() {
  redirect('/you/personality/test');
}
