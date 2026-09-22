-- The areas: a fixed two-level grid every subject and theme is placed in.
--
-- Specified in docs/LEARN-AREAS-SPEC.md. The learn graph starts empty and grows
-- a goal at a time, so on its own it can show strength inside a subject you
-- started and nothing about a field you never touched. A dashboard that says
-- "strong in economics, nothing yet in chemistry" needs a fixed list of fields
-- to count against, and this is that list.
--
-- Two decisions are made here rather than left to the application.
--
--   **Exactly two levels, as two tables.** Ten domains, each holding three to
--   six fields. Everything below a field is the learn graph, which stays loose.
--   Two tables with a plain foreign key make a third level impossible to add by
--   accident; one self-referencing table would need a trigger to say the same.
--
--   **The grid belongs to nobody and changes only by migration.** Like the
--   catalogue, these tables carry no `user_id` and signed-in accounts can read
--   them but not write them. A field that one account could rename would stop
--   being a fixed denominator, which is the only reason the grid exists.
--
-- Every field is exclusive: a subject or theme is placed in one field and one
-- only, which is what lets the counts on the dashboard add up. The `scope`
-- column carries the boundary rule for the overlaps a placement pass will meet,
-- so the model doing the placing reads the same rule the spec states.
--
-- Nothing is placed here. Placing subjects and themes is the next step in that
-- document's build order.

set search_path = learn, public, extensions;

-- ---------------------------------------------------------------------------
-- Domains: the ten at the top.
--
-- `slug` is the stable handle code refers to; `name` is what a screen shows and
-- may be reworded by a later migration without breaking anything that points
-- here. `position` is display order, fixed rather than alphabetical because the
-- order runs from the formal sciences to the arts on purpose.
-- ---------------------------------------------------------------------------
create table if not exists learn.area_domains (
  id uuid primary key default gen_random_uuid(),

  slug text not null,
  name text not null,
  -- What the domain covers, in a sentence. Not optional, for the reason
  -- `obsidian.themes.about` is not: an unexplained label is one nobody can
  -- argue with, and a placement pass has nothing to reason from.
  scope text not null,
  position smallint not null,

  created_at timestamptz not null default now(),

  constraint area_domains_slug_uq unique (slug),
  constraint area_domains_position_uq unique (position),
  constraint area_domains_slug_ck check (slug ~ '^[a-z0-9-]{2,64}$'),
  constraint area_domains_name_ck check (btrim(name) <> ''),
  constraint area_domains_scope_ck check (btrim(scope) <> ''),
  constraint area_domains_position_ck check (position > 0)
);

-- ---------------------------------------------------------------------------
-- Fields: the second level, and the unit everything is placed in.
--
-- `on delete restrict` because a domain with fields under it being removed is a
-- mistake in a migration, and the database should say so rather than take the
-- fields and every placement pointing at them along with it.
-- ---------------------------------------------------------------------------
create table if not exists learn.area_fields (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references learn.area_domains (id) on delete restrict,

  -- Unique across all fields, not only within a domain, so a slug alone names
  -- a field wherever it is written down.
  slug text not null,
  name text not null,
  -- What belongs here, and where the nearest thing that does not belong here
  -- goes instead.
  scope text not null,
  position smallint not null,

  created_at timestamptz not null default now(),

  constraint area_fields_slug_uq unique (slug),
  constraint area_fields_domain_position_uq unique (domain_id, position),
  constraint area_fields_slug_ck check (slug ~ '^[a-z0-9-]{2,64}$'),
  constraint area_fields_name_ck check (btrim(name) <> ''),
  constraint area_fields_scope_ck check (btrim(scope) <> ''),
  constraint area_fields_position_ck check (position > 0)
);

create index if not exists area_fields_domain_idx on learn.area_fields (domain_id, position);

-- ---------------------------------------------------------------------------
-- RLS.
--
-- Reference data in the catalogue's shape: readable by any signed-in account,
-- with no insert, update or delete policy and a `select`-only grant, so a write
-- through the API has nothing to pass and is refused.
-- ---------------------------------------------------------------------------
alter table learn.area_domains enable row level security;
alter table learn.area_fields enable row level security;

drop policy if exists area_domains_select on learn.area_domains;
create policy area_domains_select on learn.area_domains for select to authenticated
  using (true);

drop policy if exists area_fields_select on learn.area_fields;
create policy area_fields_select on learn.area_fields for select to authenticated
  using (true);

grant select on learn.area_domains to authenticated;
grant select on learn.area_fields to authenticated;

grant all on learn.area_domains to service_role;
grant all on learn.area_fields to service_role;

revoke all on table learn.area_domains from anon;
revoke all on table learn.area_fields from anon;

-- ---------------------------------------------------------------------------
-- The seed.
--
-- Derived from the section structure of Wikipedia's Level 3 vital articles and
-- reworked onto one axis, field of study. People, Geography and Everyday life
-- are gone as sections: a subject or theme about a person or place is placed
-- by what it covers, physical geography moved to Earth sciences, and the
-- everyday-life topics went to the fields that study them. The reasoning for
-- each move is in the spec.
--
-- `on conflict (slug) do nothing`, matching the catalogue providers: this is a
-- first seed, and a later change to the grid is its own migration.
-- ---------------------------------------------------------------------------
insert into learn.area_domains (slug, name, scope, position)
values
  ('mathematics', 'Mathematics and logic',
   'Formal reasoning: logic, number, structure, space, change and chance.', 1),
  ('physical-sciences', 'Physical sciences',
   'Matter, energy and the non-living universe, from particles to planets and stars.', 2),
  ('life-sciences', 'Life sciences',
   'Living things and how they work, change and relate to each other, when healthy.', 3),
  ('health', 'Health and medicine',
   'Disease, its treatment and prevention, in bodies and in minds.', 4),
  ('technology', 'Technology and engineering',
   'Making and running things: machines, computers, energy, transport and food production.', 5),
  ('social-sciences', 'Social sciences',
   'How people think, behave, trade, govern and organise themselves, studied as they are.', 6),
  ('history', 'History',
   'Events, states, wars and eras. The history of a particular field belongs to that field.', 7),
  ('philosophy-religion', 'Philosophy and religion',
   'What exists, what can be known, what ought to be done, and what people believe about the sacred.', 8),
  ('language-literature', 'Language and literature',
   'Language itself, written works as texts, and the news and publishing that carry them.', 9),
  ('arts-culture', 'Arts and culture',
   'Things made or done for expression or enjoyment: art, music, performance, buildings, sport and food.', 10)
on conflict (slug) do nothing;

insert into learn.area_fields (domain_id, slug, name, scope, position)
select d.id, v.slug, v.name, v.scope, v.position
from (values
  -- Mathematics and logic
  ('mathematics', 'logic-foundations', 'Logic, foundations and discrete mathematics',
   'Proof, formal logic, set theory, combinatorics and graph theory. All formal logic belongs here, including the logic philosophers study.', 1),
  ('mathematics', 'algebra-number-theory', 'Algebra and number theory',
   'Numbers, equations, algebraic structures such as groups and rings, and linear algebra.', 2),
  ('mathematics', 'geometry-topology', 'Geometry and topology',
   'Shape, space and the properties that survive deformation.', 3),
  ('mathematics', 'analysis-calculus', 'Analysis and calculus',
   'Limits, derivatives, integrals, series and differential equations.', 4),
  ('mathematics', 'probability-statistics', 'Probability and statistics',
   'Chance, randomness and inference from data. Econometrics belongs to Economics.', 5),

  -- Physical sciences
  ('physical-sciences', 'physics', 'Physics',
   'Mechanics, electromagnetism, thermodynamics, relativity and quantum theory.', 1),
  ('physical-sciences', 'chemistry', 'Chemistry',
   'Elements, compounds and reactions. The chemistry of living things belongs to Molecular and cell biology.', 2),
  ('physical-sciences', 'astronomy', 'Astronomy and space science',
   'Planets, stars, galaxies and cosmology: what is out there. Spacecraft belong to Transport.', 3),
  ('physical-sciences', 'earth-sciences', 'Earth sciences',
   'Geology, oceans, atmosphere, weather and physical climate, and physical geography such as continents and rivers. Effects on living things belong to Ecology.', 4),

  -- Life sciences
  ('life-sciences', 'molecular-cell-biology', 'Molecular and cell biology',
   'Cells, biochemistry, DNA, genes and heredity.', 1),
  ('life-sciences', 'organisms-evolution', 'Organisms and evolution',
   'Animals, plants, fungi and microbes, and how life diversified through evolution.', 2),
  ('life-sciences', 'anatomy-physiology', 'Anatomy and physiology',
   'How bodies are built and work when healthy. Disease belongs to Health and medicine.', 3),
  ('life-sciences', 'ecology-environment', 'Ecology and environment',
   'Ecosystems, biodiversity, conservation, and the effects of climate and pollution on living things.', 4),

  -- Health and medicine
  ('health', 'disease', 'Disease',
   'Infectious, chronic and genetic disease: causes, course and pathology.', 1),
  ('health', 'medical-practice', 'Treatment and medical practice',
   'Diagnosis, pharmacology, surgery and the practice of medicine.', 2),
  ('health', 'mental-health', 'Mental health',
   'Mental disorders and their treatment. How the healthy mind works belongs to Psychology.', 3),
  ('health', 'public-health', 'Public health, nutrition and fitness',
   'Epidemiology, prevention, diet and exercise. Cooking and cuisine belong to Food and cuisine.', 4),

  -- Technology and engineering
  ('technology', 'computing', 'Computing',
   'Computer science, software, the internet and artificial intelligence.', 1),
  ('technology', 'electrical-communications', 'Electrical engineering and communications',
   'Electricity in use, electronics and telecommunications.', 2),
  ('technology', 'mechanical-construction', 'Mechanical engineering, construction and materials',
   'Machines, tools, manufacturing, materials, building methods and weapons. Wars belong to History; building design to Architecture.', 3),
  ('technology', 'energy', 'Energy',
   'Power generation, fuels and energy storage.', 4),
  ('technology', 'transport', 'Transport',
   'Vehicles, roads, railways, shipping, aviation and spaceflight.', 5),
  ('technology', 'agriculture', 'Agriculture and food production',
   'Farming, livestock, fishing and producing food at scale.', 6),

  -- Social sciences
  ('social-sciences', 'psychology', 'Psychology',
   'Mind, cognition, emotion and behaviour. Mental disorders belong to Mental health.', 1),
  ('social-sciences', 'economics', 'Economics, business and finance',
   'Markets, money, trade, firms, finance and economic thought, including its history.', 2),
  ('social-sciences', 'politics', 'Politics and government',
   'How government actually works: political systems, parties, ideologies in practice, international relations. What government ought to be belongs to Political and social philosophy.', 3),
  ('social-sciences', 'law', 'Law, crime and justice',
   'Legal systems, rights, crime and punishment.', 4),
  ('social-sciences', 'sociology-anthropology', 'Sociology and anthropology',
   'Society and culture as studied: family, class, gender, ethnicity, education and customs.', 5),
  ('social-sciences', 'human-geography', 'Human geography',
   'Population, migration, cities and countries as a subject of study, and writing about a particular place in general. Its history belongs to an era, its government to Politics.', 6),

  -- History
  ('history', 'ancient', 'Prehistory and the ancient world',
   'From human origins to about 500 CE.', 1),
  ('history', 'medieval-early-modern', 'Medieval and early modern',
   'About 500 to 1800.', 2),
  ('history', 'modern', 'The modern era',
   '1800 to 1945, including both world wars.', 3),
  ('history', 'contemporary', 'The contemporary era',
   '1945 to the present.', 4),

  -- Philosophy and religion
  ('philosophy-religion', 'metaphysics-epistemology', 'Metaphysics, epistemology and philosophy of mind',
   'What exists, what can be known and how, and what minds are. Formal logic belongs to Mathematics and logic.', 1),
  ('philosophy-religion', 'ethics-aesthetics', 'Ethics and aesthetics',
   'What is right, good and beautiful, and why.', 2),
  ('philosophy-religion', 'political-philosophy', 'Political and social philosophy',
   'What government, justice and society ought to be. How they actually work belongs to Social sciences.', 3),
  ('philosophy-religion', 'religion-mythology', 'Religion and mythology',
   'Religions, their beliefs, texts and practices, and myth.', 4),

  -- Language and literature
  ('language-literature', 'linguistics', 'Linguistics and languages',
   'How language works, particular languages and writing systems.', 1),
  ('language-literature', 'literature', 'Literature',
   'Fiction, poetry and plays as written texts. Staging a play belongs to Performing arts and film.', 2),
  ('language-literature', 'media-journalism', 'Media and journalism',
   'News, publishing and broadcasting as ways of carrying information.', 3),

  -- Arts and culture
  ('arts-culture', 'visual-arts', 'Visual arts and design',
   'Painting, sculpture, photography and design.', 1),
  ('arts-culture', 'music', 'Music',
   'Music, its forms, instruments and theory.', 2),
  ('arts-culture', 'performing-arts-film', 'Performing arts and film',
   'Theatre, dance, film and television as made and performed.', 3),
  ('arts-culture', 'architecture', 'Architecture',
   'The design and styles of buildings. How they are built belongs to Mechanical engineering, construction and materials.', 4),
  ('arts-culture', 'sport-games', 'Sport and games',
   'Sports, games and recreation.', 5),
  ('arts-culture', 'food-cuisine', 'Food and cuisine',
   'Cooking, cuisines and drink. Growing food belongs to Agriculture; eating well to Public health, nutrition and fitness.', 6)
) as v (domain_slug, slug, name, scope, position)
join learn.area_domains d on d.slug = v.domain_slug
on conflict (slug) do nothing;
