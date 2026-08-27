-- A price source for the wait between requesting eBay API access and getting
-- it: Claude's web search reads what a used copy currently goes for. Softer
-- than sold comps, so it is cached under its own source and labelled as an
-- estimate wherever it is shown.

set search_path = public, extensions;

alter type book_price_quote_source add value if not exists 'web_estimate';
