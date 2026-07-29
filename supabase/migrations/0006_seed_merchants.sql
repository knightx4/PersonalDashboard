-- Global merchant seed.
--
-- `domains` maps sender domains to a merchant and is what Tier A of the
-- classifier uses to discard unknown senders for free, before any LLM call.
-- Include the transactional subdomains retailers actually send from, not just
-- the marketing domain.
--
-- IMPORTANT on default_return_window_days: this column drives the return
-- deadline shown to the user, and a wrong deadline is worse than no deadline.
-- A window is seeded only where the retailer's standard policy is stable and
-- well documented; everything else is left null and the UI shows nothing.
-- Retailers change these, so treat the values as a starting point to verify,
-- not as fact. Holiday extensions and membership tiers are deliberately not
-- modelled.

set search_path = public, extensions;

insert into merchants (name, slug, domains, default_return_window_days, is_global) values
  -- Marketplaces and big box
  ('Amazon',            'amazon',            array['amazon.com','order-update.amazon.com','marketplace.amazon.com'], 30,   true),
  ('Target',            'target',            array['target.com','oe.target.com','em.target.com'],                    90,   true),
  ('Walmart',           'walmart',           array['walmart.com','email.walmart.com'],                               90,   true),
  ('Costco',            'costco',            array['costco.com','online.costco.com'],                                null, true),
  ('eBay',              'ebay',              array['ebay.com','reply.ebay.com'],                                     null, true),
  ('Etsy',              'etsy',              array['etsy.com','mail.etsy.com'],                                      null, true),
  ('Best Buy',          'best-buy',          array['bestbuy.com','emailinfo.bestbuy.com'],                           15,   true),
  ('Costco Wholesale',  'costco-wholesale',  array['costcobusinesscentre.com'],                                      null, true),

  -- Apparel and footwear
  ('Nike',              'nike',              array['nike.com','order.nike.com','notifications.nike.com'],             60,   true),
  ('Adidas',            'adidas',            array['adidas.com','news.adidas.com'],                                   30,   true),
  ('Lululemon',         'lululemon',         array['lululemon.com','info.lululemon.com'],                             30,   true),
  ('Uniqlo',            'uniqlo',            array['uniqlo.com'],                                                     30,   true),
  ('Zara',              'zara',              array['zara.com'],                                                       30,   true),
  ('H&M',               'hm',                array['hm.com','info.hm.com'],                                           30,   true),
  ('Gap',               'gap',               array['gap.com','email.gap.com'],                                        30,   true),
  ('Old Navy',          'old-navy',          array['oldnavy.com','email.oldnavy.com'],                                30,   true),
  ('Banana Republic',   'banana-republic',   array['bananarepublic.com'],                                             30,   true),
  ('J.Crew',            'jcrew',             array['jcrew.com','e.jcrew.com'],                                        30,   true),
  ('Madewell',          'madewell',          array['madewell.com','e.madewell.com'],                                  30,   true),
  ('Everlane',          'everlane',          array['everlane.com'],                                                   30,   true),
  ('ASOS',              'asos',              array['asos.com'],                                                       28,   true),
  ('Revolve',           'revolve',           array['revolve.com','email.revolve.com'],                                30,   true),
  ('Anthropologie',     'anthropologie',     array['anthropologie.com'],                                              30,   true),
  ('Urban Outfitters',  'urban-outfitters',  array['urbanoutfitters.com'],                                            30,   true),
  ('Free People',       'free-people',       array['freepeople.com'],                                                 30,   true),
  ('Nordstrom',         'nordstrom',         array['nordstrom.com','email.nordstrom.com'],                            null, true),
  ('Macys',             'macys',             array['macys.com','email.macys.com'],                                    30,   true),
  ('Bloomingdales',     'bloomingdales',     array['bloomingdales.com'],                                              30,   true),
  ('Saks Fifth Avenue', 'saks',              array['saksfifthavenue.com','saks.com'],                                 null, true),
  ('Zappos',            'zappos',            array['zappos.com'],                                                     365,  true),
  ('Allbirds',          'allbirds',          array['allbirds.com'],                                                   30,   true),
  ('New Balance',       'new-balance',       array['newbalance.com'],                                                 30,   true),
  ('Converse',          'converse',          array['converse.com'],                                                   30,   true),
  ('Vans',              'vans',              array['vans.com'],                                                       30,   true),
  ('Dr. Martens',       'dr-martens',        array['drmartens.com'],                                                  null, true),
  ('Birkenstock',       'birkenstock',       array['birkenstock.com'],                                                null, true),
  ('On',                'on-running',        array['on-running.com','on.com'],                                        30,   true),
  ('Hoka',              'hoka',              array['hoka.com'],                                                       30,   true),
  ('Under Armour',      'under-armour',      array['underarmour.com'],                                                60,   true),
  ('Warby Parker',      'warby-parker',      array['warbyparker.com'],                                                30,   true),

  -- Outdoor
  ('REI',               'rei',               array['rei.com','notices.rei.com'],                                      90,   true),
  ('Patagonia',         'patagonia',         array['patagonia.com'],                                                  null, true),
  ('The North Face',    'the-north-face',    array['thenorthface.com'],                                               60,   true),
  ('Columbia',          'columbia',          array['columbia.com'],                                                   60,   true),
  ('Arcteryx',          'arcteryx',          array['arcteryx.com'],                                                   45,   true),
  ('Backcountry',       'backcountry',       array['backcountry.com'],                                                30,   true),
  ('L.L.Bean',          'llbean',            array['llbean.com'],                                                     365,  true),
  ('Dicks Sporting Goods','dicks',           array['dickssportinggoods.com'],                                         90,   true),

  -- Electronics
  ('Apple',             'apple',             array['apple.com','email.apple.com','insideapple.apple.com'],            14,   true),
  ('Samsung',           'samsung',           array['samsung.com','email.samsung.com'],                                15,   true),
  ('Sony',              'sony',              array['sony.com','electronics.sony.com'],                                30,   true),
  ('Bose',              'bose',              array['bose.com'],                                                       90,   true),
  ('Sonos',             'sonos',             array['sonos.com'],                                                      45,   true),
  ('Dell',              'dell',              array['dell.com'],                                                       30,   true),
  ('Lenovo',            'lenovo',            array['lenovo.com'],                                                     30,   true),
  ('HP',                'hp',                array['hp.com'],                                                         30,   true),
  ('Logitech',          'logitech',          array['logitech.com'],                                                   30,   true),
  ('Anker',             'anker',             array['anker.com'],                                                      45,   true),
  ('B&H Photo',         'bh-photo',          array['bhphotovideo.com'],                                               30,   true),
  ('Newegg',            'newegg',            array['newegg.com'],                                                     30,   true),

  -- Home
  ('IKEA',              'ikea',              array['ikea.com'],                                                       365,  true),
  ('Wayfair',           'wayfair',           array['wayfair.com'],                                                    30,   true),
  ('Crate & Barrel',    'crate-and-barrel',  array['crateandbarrel.com'],                                             30,   true),
  ('CB2',               'cb2',               array['cb2.com'],                                                        30,   true),
  ('West Elm',          'west-elm',          array['westelm.com'],                                                    30,   true),
  ('Pottery Barn',      'pottery-barn',      array['potterybarn.com'],                                                30,   true),
  ('Williams Sonoma',   'williams-sonoma',   array['williams-sonoma.com'],                                            30,   true),
  ('Article',           'article',           array['article.com'],                                                    30,   true),
  ('Home Depot',        'home-depot',        array['homedepot.com','order.homedepot.com'],                            90,   true),
  ('Lowes',             'lowes',             array['lowes.com'],                                                      90,   true),
  ('Casper',            'casper',            array['casper.com'],                                                     null, true),
  ('Away',              'away',              array['awaytravel.com'],                                                 100,  true),

  -- Beauty and health
  ('Sephora',           'sephora',           array['sephora.com','email.sephora.com'],                                30,   true),
  ('Ulta Beauty',       'ulta',              array['ulta.com'],                                                       60,   true),
  ('Glossier',          'glossier',          array['glossier.com'],                                                   30,   true),
  ('Aesop',             'aesop',             array['aesop.com'],                                                      null, true),
  ('The Ordinary',      'the-ordinary',      array['theordinary.com','deciem.com'],                                   30,   true),
  ('CVS',               'cvs',               array['cvs.com'],                                                        60,   true),
  ('Walgreens',         'walgreens',         array['walgreens.com'],                                                  30,   true),

  -- Pet, grocery, other
  ('Chewy',             'chewy',             array['chewy.com'],                                                      365,  true),
  ('Petco',             'petco',             array['petco.com'],                                                      30,   true),
  ('Whole Foods Market','whole-foods',       array['wholefoodsmarket.com'],                                           null, true),
  ('Instacart',         'instacart',         array['instacart.com'],                                                  null, true),
  ('Nespresso',         'nespresso',         array['nespresso.com'],                                                  30,   true),
  ('Peloton',           'peloton',           array['onepeloton.com'],                                                 30,   true),
  ('Blue Bottle Coffee','blue-bottle',       array['bluebottlecoffee.com'],                                           null, true),
  ('Shopify',           'shopify',           array['shopify.com','shopifyemail.com'],                                 null, true);
