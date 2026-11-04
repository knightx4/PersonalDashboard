/**
 * Reference designs, kept by gallery surface (docs/UI-QUALITY-SPEC.md, Part 2
 * and rule R18).
 *
 * A reference is a design the person prefers for one screen. The design
 * critic is shown it on every round for that surface, in this step and every
 * later one, and judges the screen against it as well as against the laws: a
 * screen that keeps every law but reads worse than its reference fails, and
 * where the reference breaks a law, the law wins.
 *
 * A step names a reference on a `Reference:` line of its detail, as pictures,
 * a link, or both. The builder registers it here under the surface it is for.
 * Pictures live in the repository under `docs/references/<surface>/`. A link
 * with no pictures yet is photographed by the builder the first time it is
 * used, and the shots are saved there and listed, so later rounds and later
 * steps send the same pictures rather than whatever the page shows by then.
 */

/** Where a reference's pictures are kept, one folder per surface. */
export const REFERENCE_DIR = 'docs/references';

export type Reference = {
  /**
   * Pictures of the design, as paths from the repository root, normally under
   * `docs/references/<surface>/`. Empty only while a link waits to be
   * photographed.
   */
  pictures: readonly string[];
  /** The page the design came from, or null when it was only ever pictures. */
  link: string | null;
  /**
   * The design's own HTML, saved beside its pictures, for a mockup made in a
   * chat (a claude.ai artifact). The builder and the critic read exact sizes,
   * colours and spacing from it instead of estimating them from pixels; the
   * builder still builds from the app's own parts and never pastes it in.
   */
  source?: string;
  /** What the person prefers about it, in a sentence, for the critic. */
  why: string;
  /** The step that registered it, by outline, such as "1891.2". */
  from: string;
};

/**
 * The registered references, by gallery surface id. Every key must be a
 * surface in the gallery (tests/preview-routes.test.ts).
 */
export const REFERENCES: Readonly<Record<string, Reference>> = {
  // The "Dash Chat Workspace" mockup the person chose on 15 October 2026 ("go
  // with B"), replacing the one from decision #1899.1. Its saved copy names
  // made-up people and companies, since the repository is public.
  'ask-page': {
    pictures: ['docs/references/ask-page/workspace-laptop.png', 'docs/references/ask-page/workspace-phone.png'],
    link: 'https://claude.ai/artifact/D6FHNYY3HdyaWCXt2U2yQU',
    source: 'docs/references/ask-page/workspace.html',
    why: 'Glass panes over a moving glow: the chats on their own pane with search and area chips, the open chat at reading width with the question in a filled bubble on the right, and a Context pane of the sources behind each answer and the changes waiting for approval. The person asked for no Ask and Do switch (Dash tells which on its own) and said their chats do not carry charts like the mockup\'s, so the chart is not something to copy.',
    from: '2215.9',
  },
  'ask-page-at-work': {
    pictures: ['docs/references/ask-page/workspace-laptop.png', 'docs/references/ask-page/workspace-phone.png'],
    link: 'https://claude.ai/artifact/D6FHNYY3HdyaWCXt2U2yQU',
    source: 'docs/references/ask-page/workspace.html',
    why: 'The same mockup, for the open chat while Dash answers: the question in its bubble, Dash\'s answer under its mark with a fold for what it searched, and the box docked at the foot of the chat. No Ask and Do switch.',
    from: '2215.9',
  },
  'ask-page-used': {
    pictures: ['docs/references/ask-page/workspace-laptop.png', 'docs/references/ask-page/workspace-phone.png'],
    link: 'https://claude.ai/artifact/D6FHNYY3HdyaWCXt2U2yQU',
    source: 'docs/references/ask-page/workspace.html',
    why: 'The same mockup, for its Context pane: Sources and Changes as two tabs with counts, each source numbered to match the marks in the answer, and a change waiting for approval shown as what it adds.',
    from: '2215.9',
  },
  // The "Step attachments" mockups the person chose option A and D from on
  // 17 October 2026 for a goal's lists (plan #2330). Drawn at laptop width
  // only; the boards have no phone layout.
  'goals-lists': {
    pictures: ['docs/references/goals-lists/chip-laptop.png', 'docs/references/goals-lists/two-chips-laptop.png'],
    link: 'https://claude.ai/artifact/KtUUbM5HzUsBKaokYiNqLN',
    source: 'docs/references/goals-lists/chip.html',
    why: 'Each list is one chip on the goal, in the row of facts under the done-when: a picture or a mark, the list name, then the count and the one thing that stands out ("2 · HOMCOM 72 inch leading"), so a goal with several lists stays one row tall.',
    from: '2330.3',
  },
  'goals-lists-panel': {
    pictures: ['docs/references/goals-lists/panel-laptop.png'],
    link: 'https://claude.ai/artifact/KtUUbM5HzUsBKaokYiNqLN',
    source: 'docs/references/goals-lists/panel.html',
    why: 'The chip opens the list in a panel over the right of the page with the goal dimmed behind it: "On <goal>" above the list name, the view switch and a close button on one line, the add box for a pasted link, the rows, and the ruled-out count at the foot. The Compare cards are #2330.4\'s; here the table is the view.',
    from: '2330.3',
  },
  'goals-lists-tab': {
    pictures: ['docs/references/goals-lists/tab-laptop.png'],
    link: 'https://claude.ai/artifact/KtUUbM5HzUsBKaokYiNqLN',
    source: 'docs/references/goals-lists/tab.html',
    why: 'A list as its own tab beside Steps, carrying its count: the add action on the toolbar line, then a table with a thumbnail column, the name in heavier type, the list\'s own columns with numbers lined up, a status in colour, and "Ruled out" folded at the foot.',
    from: '2330.3',
  },
  // The goal page, which the person pointed at for a step's page (plan
  // #2373). Photographed from its gallery drawings, one tab to each of the
  // step's tabs, since the live page shows the person's own goals and the
  // repository is public.
  'goals-step': {
    pictures: ['docs/references/goals-step/overview-laptop.png', 'docs/references/goals-step/overview-phone.png'],
    link: '/preview?s=goals-page-top',
    why: 'A step\'s page should read as a goal\'s does: the path, then the status mark and title with the menu on the same line and one quiet line under it, then the tabs, with the facts in a card in a column on the right from laptop width and the first few in one row on a phone. The Overview tab puts the done-when and the rest of the content on cards, each section headed in small type on the page.',
    from: '2373.3',
  },
  'goals-step-substeps': {
    pictures: ['docs/references/goals-step/steps-laptop.png', 'docs/references/goals-step/steps-phone.png'],
    link: '/preview?s=goals-page-steps',
    why: 'A step\'s Sub-steps tab should read as a goal\'s Steps tab: the same header and properties column, then the rows on one card under the column header, with the finished ones folded and the add line at the foot of the card.',
    from: '2373.3',
  },
  // The thread moved to the Overview tab (note 42b3d858), so its surface
  // reads against the Overview reference: the comments are one more part
  // headed in small type on the page, on a card of its own.
  'goals-step-comments': {
    pictures: ['docs/references/goals-step/overview-laptop.png', 'docs/references/goals-step/overview-phone.png'],
    link: '/preview?s=goals-page-top',
    why: 'A step\'s Overview should read as a goal\'s: the same header and properties column, then each part headed in small type on the page and on its own card, with the comments the last of them.',
    from: '2373.3',
  },
  // The loans and apartment goal pages the person approved for #2778
  // (https://claude.ai/artifact/MxXPr3jk1E46bXFnwBfXuH and
  // https://claude.ai/artifact/FA35FjHtscwvUWtugSqAgZ). The saved copies,
  // apartment.html beside loans.html, carry made-up names, lender and amounts,
  // since the repository is public. Later steps of #2778 reuse them.
  'goal-dashboard-tiles': {
    pictures: [
      'docs/references/goal-dashboard/loans-laptop.png',
      'docs/references/goal-dashboard/loans-phone.png',
      'docs/references/goal-dashboard/apartment-laptop.png',
      'docs/references/goal-dashboard/apartment-phone.png',
    ],
    link: 'https://claude.ai/artifact/MxXPr3jk1E46bXFnwBfXuH',
    source: 'docs/references/goal-dashboard/loans.html',
    why: 'The two goal pages the person approved on 3 and 4 November 2026 for #2778, drawn as dashboards: small tiles three to a row on a laptop, each a card with a small label, one big figure in the display face and a muted line saying where it comes from, and a quiet \'+ Log balances\' under it; then wide cards for a line chart of the balance with its legend and a table of the loans with the numbers lined up right. On a phone every tile is one column. The person turned down the apartment page\'s \'Right now\' focus switch, so it is not something to copy, and the tiles this step draws are the number, countdown, chart and table ones.',
    from: '2778.2',
  },
  'goal-dashboard-tiles-add': {
    pictures: [
      'docs/references/goal-dashboard/loans-laptop.png',
      'docs/references/goal-dashboard/loans-phone.png',
      'docs/references/goal-dashboard/apartment-laptop.png',
      'docs/references/goal-dashboard/apartment-phone.png',
    ],
    link: 'https://claude.ai/artifact/MxXPr3jk1E46bXFnwBfXuH',
    source: 'docs/references/goal-dashboard/loans.html',
    why: 'The two goal pages the person approved on 3 and 4 November 2026 for #2778, drawn as dashboards: small tiles three to a row on a laptop, each a card with a small label, one big figure in the display face and a muted line saying where it comes from, and a quiet \'+ Log balances\' under it; then wide cards for a line chart of the balance with its legend and a table of the loans with the numbers lined up right. On a phone every tile is one column. The person turned down the apartment page\'s \'Right now\' focus switch, so it is not something to copy, and the tiles this step draws are the number, countdown, chart and table ones. Here the quick add is open, which the mockups draw only as the \'+ Log balances\' line, so it should open in place inside its card as quietly.',
    from: '2778.2',
  },
  'goal-dashboard-tiles-menu': {
    pictures: [
      'docs/references/goal-dashboard/loans-laptop.png',
      'docs/references/goal-dashboard/loans-phone.png',
      'docs/references/goal-dashboard/apartment-laptop.png',
      'docs/references/goal-dashboard/apartment-phone.png',
    ],
    link: 'https://claude.ai/artifact/MxXPr3jk1E46bXFnwBfXuH',
    source: 'docs/references/goal-dashboard/loans.html',
    why: 'The two goal pages the person approved on 3 and 4 November 2026 for #2778, drawn as dashboards: small tiles three to a row on a laptop, each a card with a small label, one big figure in the display face and a muted line saying where it comes from, and a quiet \'+ Log balances\' under it; then wide cards for a line chart of the balance with its legend and a table of the loans with the numbers lined up right. On a phone every tile is one column. The person turned down the apartment page\'s \'Right now\' focus switch, so it is not something to copy, and the tiles this step draws are the number, countdown, chart and table ones. Here a tile\'s menu is open; the mockups draw no menu, so it should sit at the card\'s top right and not disturb the card.',
    from: '2778.2',
  },
  'goal-dashboard-tiles-empty': {
    pictures: [
      'docs/references/goal-dashboard/loans-laptop.png',
      'docs/references/goal-dashboard/loans-phone.png',
      'docs/references/goal-dashboard/apartment-laptop.png',
      'docs/references/goal-dashboard/apartment-phone.png',
    ],
    link: 'https://claude.ai/artifact/MxXPr3jk1E46bXFnwBfXuH',
    source: 'docs/references/goal-dashboard/loans.html',
    why: 'The two goal pages the person approved on 3 and 4 November 2026 for #2778, drawn as dashboards: small tiles three to a row on a laptop, each a card with a small label, one big figure in the display face and a muted line saying where it comes from, and a quiet \'+ Log balances\' under it; then wide cards for a line chart of the balance with its legend and a table of the loans with the numbers lined up right. On a phone every tile is one column. The person turned down the apartment page\'s \'Right now\' focus switch, so it is not something to copy, and the tiles this step draws are the number, countdown, chart and table ones. Here every tile is empty, which the chart card in the loans mockup shows in one line (\'No balances logged yet. Each one you log draws here as a dot against the line.\').',
    from: '2778.2',
  },
  'goal-dashboard-tiles-broken': {
    pictures: [
      'docs/references/goal-dashboard/loans-laptop.png',
      'docs/references/goal-dashboard/loans-phone.png',
      'docs/references/goal-dashboard/apartment-laptop.png',
      'docs/references/goal-dashboard/apartment-phone.png',
    ],
    link: 'https://claude.ai/artifact/MxXPr3jk1E46bXFnwBfXuH',
    source: 'docs/references/goal-dashboard/loans.html',
    why: 'The two goal pages the person approved on 3 and 4 November 2026 for #2778, drawn as dashboards: small tiles three to a row on a laptop, each a card with a small label, one big figure in the display face and a muted line saying where it comes from, and a quiet \'+ Log balances\' under it; then wide cards for a line chart of the balance with its legend and a table of the loans with the numbers lined up right. On a phone every tile is one column. The person turned down the apartment page\'s \'Right now\' focus switch, so it is not something to copy, and the tiles this step draws are the number, countdown, chart and table ones. Here every tile names what is missing; the mockups draw no broken tile, so it should keep the card\'s shape and say it in one line.',
    from: '2778.2',
  },
  // Plan #2778.3's parts, slots, tracker and grid tiles, judged against the
  // same two approved pages; the apartment one draws the rooms.
  'goal-dashboard-tiles-apartment': {
    pictures: [
      'docs/references/goal-dashboard/apartment-laptop.png',
      'docs/references/goal-dashboard/apartment-phone.png',
      'docs/references/goal-dashboard/loans-laptop.png',
      'docs/references/goal-dashboard/loans-phone.png',
    ],
    link: 'https://claude.ai/artifact/FA35FjHtscwvUWtugSqAgZ',
    source: 'docs/references/goal-dashboard/apartment.html',
    why: 'The apartment goal page the person approved on 4 November 2026 for #2778: a Rooms card holding a card per room, three to a row on a laptop, two on a tablet and one on a phone, each with a 40-pixel ring of its steps done and the percent inside, the room\'s name and \'7 of 12 done · last 27 Oct\', then a hairline and a small NEXT label over its next step; a room not started sits on a faintly sunken card. The tags, photos and \'Right now\' switch of that mockup belong to other steps or were turned down, so they are not to copy.',
    from: '2778.3',
  },
  'goal-dashboard-tiles-apartment-open': {
    pictures: [
      'docs/references/goal-dashboard/apartment-laptop.png',
      'docs/references/goal-dashboard/apartment-phone.png',
    ],
    link: 'https://claude.ai/artifact/FA35FjHtscwvUWtugSqAgZ',
    source: 'docs/references/goal-dashboard/apartment.html',
    why: 'The apartment goal page the person approved on 4 November 2026 for #2778, whose room cards say \'tap a room for its steps\'. Here one room is pressed and lists its open steps in place, with no drawer; the mockup draws no open card, so it should keep the card grid calm and read as that room\'s steps.',
    from: '2778.3',
  },
  'goal-dashboard-tiles-programs': {
    pictures: [
      'docs/references/goal-dashboard/loans-laptop.png',
      'docs/references/goal-dashboard/loans-phone.png',
      'docs/references/goal-dashboard/apartment-laptop.png',
      'docs/references/goal-dashboard/apartment-phone.png',
    ],
    link: 'https://claude.ai/artifact/MxXPr3jk1E46bXFnwBfXuH',
    source: 'docs/references/goal-dashboard/loans.html',
    why: 'The two goal pages the person approved on 3 and 4 November 2026 for #2778: small tiles three to a row on a laptop, each a card with a small label, one big figure in the display face and a muted line saying where it comes from, and wide cards for a table with its numbers lined up right. The slots and the grid of programs are new kinds of tile, so they should read as members of the same family: a slots tile like a number tile with its row of slots under the figure, and the grid like the loans table with yes/no columns as marks.',
    from: '2778.3',
  },
  'goal-dashboard-page': {
    pictures: [
      'docs/references/goal-dashboard/loans-laptop.png',
      'docs/references/goal-dashboard/loans-phone.png',
      'docs/references/goal-dashboard/apartment-laptop.png',
      'docs/references/goal-dashboard/apartment-phone.png',
    ],
    link: 'https://claude.ai/artifact/MxXPr3jk1E46bXFnwBfXuH',
    source: 'docs/references/goal-dashboard/loans.html',
    why: 'The two goal pages the person approved on 3 and 4 November 2026 for #2778, as a whole page: the Dashboard, Plan, Work & files and History tabs, then a row of three Now, Next and Later cards (Now faintly tinted, each with a small label, the step and a muted line with See the plan), then the tiles on the left with a column on the right holding a Dash is on card (what Dash is working on, the last thing it finished, and an Ask Dash box) and a Recent files card of three files with All files. On a phone it is one column: the strip, the tiles, Dash\'s card, the files. The mockup has no properties column; this page keeps the tabbed detail pattern\'s, so Dash\'s card and the files sit between the tiles and it.',
    from: '2778.4',
  },
  'goal-dashboard-page-ask': {
    pictures: [
      'docs/references/goal-dashboard/loans-laptop.png',
      'docs/references/goal-dashboard/loans-phone.png',
    ],
    link: 'https://claude.ai/artifact/MxXPr3jk1E46bXFnwBfXuH',
    source: 'docs/references/goal-dashboard/loans.html',
    why: 'The loans goal page the person approved on 3 November 2026 for #2778, whose Dash is on card ends with an Ask Dash box (\'Ask Dash to figure something out…\' and an Ask button). Here that box is open inside the card, as quietly as the mockup draws it.',
    from: '2778.4',
  },
  'goal-dashboard-page-answer': {
    pictures: [
      'docs/references/goal-dashboard/loans-laptop.png',
      'docs/references/goal-dashboard/loans-phone.png',
    ],
    link: 'https://claude.ai/artifact/MxXPr3jk1E46bXFnwBfXuH',
    source: 'docs/references/goal-dashboard/loans.html',
    why: 'The loans goal page the person approved on 3 November 2026 for #2778, whose Dash is on card holds what Dash is working on and the last thing it finished. Here a question handed from Ask Dash has finished and the page is opened at its answer, which the mockup does not draw: it should read as one more card of the same family above the tiles, with the question, the answer in a sentence or two and the suggested changes, each waiting on Add and No, as quietly as the rest of the page.',
    from: '2778.8',
  },
  'goals-page-top': {
    pictures: [
      'docs/references/goal-dashboard/loans-laptop.png',
      'docs/references/goal-dashboard/loans-phone.png',
    ],
    link: 'https://claude.ai/artifact/MxXPr3jk1E46bXFnwBfXuH',
    source: 'docs/references/goal-dashboard/loans.html',
    why: 'The loans goal page the person approved on 3 November 2026 for #2778: the strip of Now, Next and Later, then the goal\'s parts on the left with Dash is on and Recent files in a column on the right. Here the goal has no tiles laid out yet, so one card says so and offers Dash lay it out where the tiles would be.',
    from: '2778.4',
  },
};

/** The reference registered for a surface, or null for none. */
export function referenceFor(
  surface: string,
  references: Readonly<Record<string, Reference>> = REFERENCES,
): Reference | null {
  return Object.prototype.hasOwnProperty.call(references, surface) ? references[surface] : null;
}

/** What a step's `Reference:` line names: picture paths and links. */
export type ReferenceLine = {
  pictures: string[];
  links: string[];
};

/**
 * What a step's text says on its `Reference:` line, or null when there is no
 * such line. The line lists pictures and links, separated by commas or
 * spaces; a word starting `http://` or `https://` is a link, and anything
 * else is a picture path. The first such line wins.
 */
export function referenceNamed(text: string): ReferenceLine | null {
  const match = text.match(/^\s*(?:[-*]\s*)?\**references?\**\s*:\**\s*(.+)$/im);
  if (!match) return null;
  const words = match[1]
    .split(/[\s,]+/)
    .map((word) => word.replace(/^[<`"'(]+|[>`"').]+$/g, ''))
    .filter(Boolean);
  const links = words.filter((word) => /^https?:\/\//i.test(word));
  const pictures = words.filter((word) => !/^https?:\/\//i.test(word));
  if (links.length === 0 && pictures.length === 0) return null;
  return { pictures, links };
}

/** A mockup made in a chat, whose HTML can be read and saved: a claude.ai artifact link. */
export function isChatMockup(link: string): boolean {
  return /^https:\/\/claude\.ai\/(?:code\/)?artifact\//.test(link);
}

/**
 * What is wrong with a set of references: a surface the gallery does not
 * have, a reference with neither pictures nor a link, a picture or source
 * that is not in the repository, or a chat mockup registered without its
 * source. Empty when nothing is.
 */
export function referenceProblems(
  references: Readonly<Record<string, Reference>>,
  gallery: readonly string[],
  exists: (path: string) => boolean,
): string[] {
  const known = new Set(gallery);
  const problems: string[] = [];
  for (const [surface, reference] of Object.entries(references)) {
    if (!known.has(surface)) problems.push(`${surface}: not a gallery surface`);
    if (reference.pictures.length === 0 && !reference.link) {
      problems.push(`${surface}: neither pictures nor a link`);
    }
    for (const picture of reference.pictures) {
      if (!exists(picture)) problems.push(`${surface}: ${picture} is not in the repository`);
    }
    if (reference.source && !exists(reference.source)) {
      problems.push(`${surface}: ${reference.source} is not in the repository`);
    }
    if (!reference.source && reference.link && isChatMockup(reference.link)) {
      problems.push(`${surface}: a chat mockup with no source; save its HTML beside its pictures`);
    }
  }
  return problems;
}

/**
 * The reference as the critic's prompt gives it: the pictures to open, the
 * link, and what the person prefers about it. A link with no pictures yet
 * says it has to be photographed first.
 */
export function referenceForCritic(surface: string, reference: Reference): string {
  const parts = [`${surface}, registered by #${reference.from}: ${reference.why}`];
  if (reference.pictures.length > 0) parts.push(`Pictures: ${reference.pictures.join(', ')}.`);
  if (reference.source) {
    parts.push(
      `Source: ${reference.source}. Read sizes, colours and spacing from it rather than estimating them from the pictures.`,
    );
  }
  if (reference.link) {
    parts.push(
      reference.pictures.length > 0
        ? `From ${reference.link}.`
        : `From ${reference.link}, not yet photographed: shoot it into ${REFERENCE_DIR}/${surface}/ and list them in lib/preview/references.ts before the round.`,
    );
  }
  return parts.join(' ');
}
