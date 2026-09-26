-- A picture for each catalogue item, for the Learn now cards made from it.
--
-- Wikipedia names a lead image for many of its articles (the PageImages
-- extension; 93 of the 168 stored here on 26 September 2026) and hands it back
-- in the same request that fetches the article's text. Asked with
-- `pilicense=free`, it names only freely licensed images, so a card can show
-- one without a licence check of its own. One article is one item, so the picture is
-- fetched once and every card from that article, and every lesson citing one
-- of its sections, shares it. Nothing is copied: the card loads the thumbnail
-- from Wikimedia's own servers.
--
-- `image_url` is the thumbnail, `image_file` the file's name, whose page
-- on Wikipedia or Commons carries its author and licence. `image_checked_at`
-- says the question was asked, so an article with no image is not asked about again
-- every hour; the backfill in lib/learn/catalogue/images.ts reads it.

set search_path = learn, public;

alter table learn.catalogue_items
  add column if not exists image_url text,
  add column if not exists image_file text,
  add column if not exists image_checked_at timestamptz;

alter table learn.catalogue_items
  drop constraint if exists catalogue_items_image_ck;
alter table learn.catalogue_items
  add constraint catalogue_items_image_ck check (
    (image_url is null) = (image_file is null)
    and (image_url is null or image_url like 'https://%')
  );

-- The backfill's queue: articles never asked about.
create index if not exists catalogue_items_image_unchecked_idx
  on learn.catalogue_items (created_at)
  where image_checked_at is null and kind = 'article';
