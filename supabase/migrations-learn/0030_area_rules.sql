-- The areas, revised from the first run of the Level 3 check.
--
-- docs/LEARN-AREAS-SPEC.md, "What the first run found". The check placed all
-- 1,001 Level 3 articles: 620 clearly, 358 with a runner-up nearly as good,
-- and 23 into no field that fit. This migration makes the three changes that
-- run pointed at.
--
--   1. A fifth History field, World and regional history, for histories that
--      span more than one era. Seven of the 23 were histories of a continent
--      or of humanity, which the four era fields cannot hold whole.
--   2. Boundary rules for the eight pairs the check most often could not
--      choose between, written into the scope of each field involved, and
--      scope lines for the small gaps (libraries, instruments, clothing,
--      calendars, life stages).
--   3. A way to place an umbrella article at the level of its domain. Eight of
--      the 23 were the whole of a domain (Technology, The arts, Nature). The
--      check table gains `domain_id` for them; subjects and themes get the
--      same choice when placement is built.

set search_path = learn, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. World and regional history.
-- ---------------------------------------------------------------------------
insert into learn.area_fields (domain_id, slug, name, scope, position)
select d.id, 'world-regional-history', 'World and regional history',
  'Histories that span more than one era: of the world, a continent, a region or a people across time. A history that fits inside one era belongs to that era.',
  5
from learn.area_domains d
where d.slug = 'history'
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Boundary rules and gaps, as scope text.
--
-- Each update replaces the whole scope, so the sentence a placement pass reads
-- is the one written here. The first sentence of each is the scope from 0027,
-- kept where it still holds.
-- ---------------------------------------------------------------------------
update learn.area_fields set scope = v.scope
from (values
  ('earth-sciences',
   'Geology, oceans, atmosphere, weather and physical climate, and natural features: seas, rivers, lakes, mountains and deserts. Continents and world regions belong to Human geography. Effects on living things belong to Ecology.'),
  ('human-geography',
   'Population, migration, cities, countries, continents and world regions as places people live, and writing about a particular place in general. Natural features such as seas, rivers and mountains belong to Earth sciences. A place''s history belongs to History, its government to Politics.'),
  ('politics',
   'How government actually works: states, political systems, parties, elections and international relations. An ideology as a body of ideas (liberalism, socialism, fascism) belongs to Political and social philosophy. Historical leaders and events belong to the era they happened in.'),
  ('political-philosophy',
   'What government, justice and society ought to be, including ideologies as bodies of ideas: liberalism, conservatism, socialism, anarchism, fascism, nationalism. How states and parties actually work belongs to Politics.'),
  ('agriculture',
   'Farming, livestock, fishing and producing food at scale, including domesticated plants and animals (wheat, maize, cattle, chickens). A food or drink as eaten belongs to Food and cuisine; a wild species to Organisms and evolution.'),
  ('food-cuisine',
   'Foods and drinks as eaten, and cooking and cuisines: rice, milk, cheese, coffee, spices. Growing or raising them belongs to Agriculture; eating well to Public health, nutrition and fitness.'),
  ('organisms-evolution',
   'Wild animals, plants, fungi and microbes, and how life diversified through evolution. Domesticated crops and livestock belong to Agriculture.'),
  ('psychology',
   'The individual mind: cognition, perception, emotion, learning and behaviour. Relationships, family and life stages belong to Sociology and anthropology; mental disorders to Mental health.'),
  ('sociology-anthropology',
   'Society and culture as studied: relationships, friendship, love, family, childhood, parenting, old age, disability as a social experience, class, gender, ethnicity, education and customs. How the individual mind works belongs to Psychology.'),
  ('chemistry',
   'Elements, compounds, substances and reactions. A material as made and used (steel, glass, plastic) belongs to Mechanical engineering, construction and materials. The chemistry of living things belongs to Molecular and cell biology.'),
  ('mechanical-construction',
   'Machines, tools, manufacturing, materials as made and used (metals, alloys, glass, plastics, explosives), building methods and weapons. Substances and reactions belong to Chemistry; wars to History; building design to Architecture.'),
  ('physics',
   'Mechanics, electromagnetism, thermodynamics, relativity and quantum theory, and measurement and scientific instruments (units, microscopes, telescopes as instruments). What telescopes observe belongs to Astronomy.'),
  ('astronomy',
   'Planets, stars, galaxies and cosmology: what is out there, and the timekeeping it gives (day, year, calendars). Spacecraft belong to Transport.'),
  ('media-journalism',
   'News, publishing, broadcasting, libraries and information as something recorded and kept.'),
  ('visual-arts',
   'Painting, sculpture, photography and design, including clothing and fashion.'),
  ('medieval-early-modern',
   'About 500 to 1800. An empire, war or movement that crosses 1800 belongs to the era it began in.'),
  ('modern',
   '1800 to 1945, including both world wars. An empire, war or movement that crosses 1945 belongs to the era it began in.')
) as v (slug, scope)
where learn.area_fields.slug = v.slug;

-- ---------------------------------------------------------------------------
-- 3. Umbrella articles in the check: placed at a domain rather than a field.
--
-- A placed row now names exactly one of a field or a domain. The runner-up
-- stays a field, since an article that is close to a whole domain is close to
-- none of its fields in particular.
-- ---------------------------------------------------------------------------
alter table learn.area_check_articles
  add column if not exists domain_id uuid references learn.area_domains (id) on delete set null;

alter table learn.area_check_articles drop constraint if exists area_check_articles_placed_ck;
alter table learn.area_check_articles add constraint area_check_articles_placed_ck check (
  (placed_at is null and kind is null and confidence is null and field_id is null and domain_id is null)
  or (placed_at is not null and kind is not null and confidence is not null
      and (field_id is null) <> (domain_id is null)
      and btrim(coalesce(basis, '')) <> '')
);
