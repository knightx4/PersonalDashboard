-- BoardGameGeek blocks datacenter IPs, so a deployed app cannot reach it.
-- Wikidata answers, and carries the BGG id (property P2339) on most games —
-- so a game resolved this way still ends up with the canonical id, plus the
-- Wikidata item it came from.

set search_path = public, extensions;

alter type game_resolution_source add value if not exists 'wikidata';

alter table game_details
  add column if not exists wikidata_id text;

create index if not exists game_details_wikidata_id_idx on game_details (wikidata_id)
  where wikidata_id is not null;
