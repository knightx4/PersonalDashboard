-- Mark the stub sections and link lists written after 0069 as not searchable
-- (plan #1133).
--
-- Migration 0069 marked every article section that was stored before the
-- cutter knew the rule in lib/learn/catalogue/searchable.ts. Forty-one more
-- were written on 27 September 2026 by a deployment still running the older
-- cutter, which left `searchable` at its default of true: "See also" lists and
-- sections under 300 characters. None of them had a vector. The passage cut
-- (lib/learn/catalogue/passages.ts) gives such a section no passages, so while
-- the flag was wrong the passage backfill of #1133 kept finding them as
-- searchable sections with nothing cut.
--
-- This is 0069's update again, word for word, so it only touches rows that
-- break the rule, and running it a second time changes nothing.

set search_path = learn, public, extensions;

update learn.catalogue_segments s
   set searchable = false,
       embedding = null,
       embedding_model = null,
       embedded_at = null
  from learn.catalogue_items i
 where i.id = s.item_id
   and i.kind = 'article'
   and s.searchable
   and (
     char_length(btrim(s.text)) < 300
     or lower(regexp_replace(btrim(coalesce(s.heading, '')), '\s+', ' ', 'g')) in (
       'see also', 'external links', 'references', 'further reading', 'notes',
       'bibliography', 'sources', 'works cited'
     )
   );
