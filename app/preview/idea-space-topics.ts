import type { IdeaOnMap, FieldOnMap } from '@/lib/learn/map/load';
import { buildTopicFrame, type TopicFrame, type TopicRows } from '@/lib/learn/map/topics';

/**
 * Wikipedia's topics for the Idea Space fixtures (plan #2016.5).
 *
 * Every field carries Level 3 topics as the live catalogue does (about twenty
 * each), the first one or two holding the field's ideas through Level 4
 * topics. Economics holds twenty-two unlocked Level 4 topics, more than a
 * screen may name, some reached by ideas and the rest by notes alone, so the
 * "+15 more" count shows when the map is flown into it.
 */

/** What each field's ideas sit under: its first Level 3 topic's Level 4 topics, in order. */
const SEEDS: Record<string, { level3: string[]; level4: string[] }> = {
  'f-econ': {
    level3: ['Economics', 'Money', 'Trade'],
    level4: [
      'Comparative advantage',
      'Opportunity cost',
      'Elasticity (economics)',
      'Marginal utility',
      'Sunk cost',
      'Moral hazard',
      'Adverse selection',
      'Supply and demand',
      'Inflation',
      'Interest',
      'Monopoly',
      'Externality',
      'Game theory',
      'Unemployment',
      'Gross domestic product',
      'Tax',
      'Market failure',
      'Public good',
      'Price discrimination',
      'Behavioral economics',
      'Keynesian economics',
      'Labour economics',
    ],
  },
  'f-business': { level3: ['Business', 'Accounting', 'Management'], level4: ['Revenue', 'Customer', 'Valuation (finance)', 'Cash flow', 'Network effect'] },
  'f-psych': { level3: ['Psychology', 'Memory', 'Learning'], level4: ['Spacing effect', 'Cognitive bias', 'Habit', 'Motivation'] },
  'f-politics': { level3: ['Political science', 'Democracy', 'State (polity)'], level4: ['Separation of powers', 'Federalism', 'Voting'] },
  'f-history': { level3: ['History', 'Industrial Revolution', 'Cold War'], level4: ['Treaty of Versailles', 'Decolonization', 'Great Depression'] },
  'f-computing': { level3: ['Computer science', 'Algorithm', 'Internet'], level4: ['Big O notation', 'Hash table', 'Recursion', 'Database'] },
  'f-biology': { level3: ['Biology', 'Evolution', 'Cell (biology)'], level4: ['Natural selection', 'Symbiogenesis', 'Sarcomere', 'Mitochondrion'] },
  'f-philosophy': { level3: ['Philosophy', 'Ethics', 'Logic'], level4: ["Russell's paradox", 'Stoicism', 'Utilitarianism'] },
  'f-literature': { level3: ['Literature', 'Poetry', 'Novel'], level4: ['Narrative', 'Metaphor'] },
  'f-medicine': { level3: ['Medicine', 'Disease', 'Immune system'], level4: ['Vaccine', 'Antibiotic'] },
  'f-physics': { level3: ['Physics', 'Energy', 'Gravity'], level4: ['Entropy', 'Momentum'] },
  'f-maths': { level3: ['Mathematics', 'Probability', 'Statistics'], level4: ['Bayes’ theorem', 'Variance', 'Set theory'] },
};

/** Level 3 topics nothing touches, laid as landmarks round every field. */
const LANDMARKS = [
  'Agriculture', 'Architecture', 'Astronomy', 'Atom', 'Bacteria', 'Bank', 'Bible', 'Brain', 'Calendar', 'Capitalism',
  'Chemical element', 'Child', 'City', 'Climate', 'Communication', 'Communism', 'Continent', 'Culture', 'Dance', 'Death',
  'Desert', 'Earth', 'Ecology', 'Education', 'Electricity', 'Empire', 'Engineering', 'Family', 'Film', 'Fire',
  'Food', 'Forest', 'Game', 'Genetics', 'Geography', 'Geology', 'Glass', 'God', 'Government', 'Health',
  'Heart', 'Human', 'Ice age', 'Island', 'Justice', 'Knowledge', 'Language', 'Law', 'Light', 'Machine',
  'Magnetism', 'Map', 'Marriage', 'Matter', 'Measurement', 'Metal', 'Military', 'Mind', 'Moon', 'Mountain',
  'Music', 'Myth', 'Nation', 'Nature', 'Ocean', 'Painting', 'Peace', 'Photography', 'Planet', 'Plant',
  'Population', 'Printing press', 'Religion', 'Renaissance', 'River', 'Science', 'Sculpture', 'Sea', 'Sleep', 'Society',
  'Soil', 'Sound', 'Space', 'Sport', 'Sun', 'Technology', 'Television', 'Theatre', 'Time', 'Tool',
  'Transport', 'Tree', 'Universe', 'University', 'Urbanization', 'Volcano', 'War', 'Water', 'Weather', 'Wheel',
  'Wind', 'Wine', 'Woman', 'Wood', 'Work (human activity)', 'Writing', 'Year', 'Zoology', 'Chemistry', 'Linguistics',
];

const AS_LINKS = new Set(['Supply and demand', 'Inflation', 'Interest', 'Externality', 'Game theory', 'Tax', 'Network effect']);

export function topicsFor(ideas: readonly IdeaOnMap[], fields: readonly FieldOnMap[], asOf: string): TopicFrame {
  const rows: TopicRows = { level3: [], level4: [], level4Total: 9022, parents: [], links: [] };
  let landmark = 0;
  const found = new Date(Date.parse(asOf) - 6 * 86_400_000).toISOString();
  fields.forEach((field, f) => {
    const seed = SEEDS[field.id];
    const own = seed?.level3 ?? [];
    own.forEach((title, i) => rows.level3.push({ id: `t3-${field.id}-${i}`, title, field_id: field.id }));
    // About twenty Level 3 topics a field, as the live catalogue has.
    for (let i = own.length; i < 9; i++) {
      rows.level3.push({ id: `t3-${field.id}-x${i}`, title: LANDMARKS[landmark++ % LANDMARKS.length]!, field_id: field.id });
    }
    if (!seed) return;
    const parent = `t3-${field.id}-0`;
    const fieldIdeas = ideas.filter((idea) => idea.field?.id === field.id);
    const ideaTopics = seed.level4.filter((title) => !AS_LINKS.has(title));
    seed.level4.forEach((title, i) => {
      const id = `t4-${field.id}-${i}`;
      rows.level4.push({ id, title, parent_id: parent });
      if (AS_LINKS.has(title) || i >= fieldIdeas.length + 7) {
        rows.links.push({ target_id: id, weight: 1, similarity: 0.5 + ((i * 7 + f) % 5) / 10, found_at: found, matched_by: 'name' });
      }
    });
    fieldIdeas.forEach((idea, i) => {
      const title = ideaTopics[i % ideaTopics.length]!;
      rows.parents.push({ concept_id: idea.id, topic_id: `t4-${field.id}-${seed.level4.indexOf(title)}` });
    });
    // A Level 4 topic that no idea and no note reaches stays hidden.
    seed.level4.forEach((_, i) => {
      const id = `t4-${field.id}-${i}`;
      if (!rows.parents.some((p) => p.topic_id === id) && !rows.links.some((l) => l.target_id === id)) {
        rows.links.push({ target_id: id, weight: 0.4, similarity: 0.3, found_at: found, matched_by: 'similarity' });
      }
    });
  });
  return buildTopicFrame(
    rows,
    ideas.map((idea) => ({ id: idea.id, pca: idea.pca, neighbourMap: idea.neighbourMap, stateRow: idea.stateRow })),
    fields,
    new Date(asOf),
  );
}
