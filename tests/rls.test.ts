/**
 * Cross-user isolation.
 *
 * This is the test that actually matters for multi-tenancy, and it is
 * deliberately written before any feature code. Two users, both seeded, then
 * every assertion runs as user B against user A's data.
 *
 * The loop is driven by a list built from the database itself, so adding a
 * table without an RLS policy fails here rather than in production months
 * later. `seedEverything` must cover every table in `public`; the coverage
 * test below fails if it doesn't, which is what forces this file to be updated
 * whenever the schema grows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db';

// `categories` and `merchants` are the only tables with rows shared by design.
// They get their own describe block below rather than a flag here, because the
// assertion for them is different: B may see the shared rows, never A's.

type SeedIds = Record<string, string>;

async function listPublicTables(): Promise<string[]> {
  const rows = await admin<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public' order by tablename
  `;
  return rows.map((r) => r.tablename);
}

/** One row per table, all owned by `userId`. Returns table -> row id. */
async function seedEverything(userId: string, tag: string): Promise<SeedIds> {
  const ids: SeedIds = {};

  // profiles already exists via the on_auth_user_created trigger
  ids.profiles = userId;

  const [category] = await admin<{ id: string }[]>`
    insert into categories (user_id, name, slug, color)
    values (${userId}, ${`${tag} category`}, ${`${tag}-category`}, '#000000')
    returning id`;
  ids.categories = category.id;

  const [merchant] = await admin<{ id: string }[]>`
    insert into merchants (name, slug, domains, created_by_user_id, is_global)
    values (${`${tag} Shop`}, ${`${tag}-shop`}, array[${`${tag}.example`}], ${userId}, false)
    returning id`;
  ids.merchants = merchant.id;

  const [account] = await admin<{ id: string }[]>`
    insert into core.email_accounts (user_id, provider, email_address)
    values (${userId}, 'gmail', ${`${tag}@example.com`})
    returning id`;

  const [order] = await admin<{ id: string }[]>`
    insert into orders (user_id, merchant_id, order_date, external_order_number,
                        subtotal_cents, total_cents)
    values (${userId}, ${merchant.id}, current_date, ${`${tag}-0001`}, 1000, 1000)
    returning id`;
  ids.orders = order.id;

  const [orderItem] = await admin<{ id: string }[]>`
    insert into order_items (order_id, name, quantity, unit_price_cents)
    values (${order.id}, ${`${tag} widget`}, 1, 1000)
    returning id`;
  ids.order_items = orderItem.id;

  const [inventoryItem] = await admin<{ id: string }[]>`
    insert into inventory_items (user_id, order_item_id, name, cost_cents, acquired_at, source)
    values (${userId}, ${orderItem.id}, ${`${tag} widget`}, 1000, current_date, 'manual')
    returning id`;
  ids.inventory_items = inventoryItem.id;

  const [bookDetails] = await admin<{ id: string }[]>`
    insert into book_details (
      inventory_item_id, isbn_13, authors, resolution_source, match_confidence, needs_confirmation
    )
    values (
      ${inventoryItem.id}, ${'9780735211292'}, array['James Clear'], 'manual', 0.9, false
    )
    returning id`;
  ids.book_details = bookDetails.id;

  const [gameDetails] = await admin<{ id: string }[]>`
    insert into game_details (
      inventory_item_id, bgg_id, year_published, publisher, condition, resolution_source
    )
    values (
      ${inventoryItem.id}, ${tag === 'alice' ? 13 : 822}, 2000,
      ${`${tag} games`}, 'complete_used', 'manual'
    )
    returning id`;
  ids.game_details = gameDetails.id;

  const [attributeTemplate] = await admin<{ id: string }[]>`
    insert into category_attribute_templates (user_id, category_id, fields)
    values (
      ${userId}, ${category.id},
      ${admin.json([{ key: 'brand', label: 'Brand', type: 'text' }])}::jsonb
    )
    returning id`;
  ids.category_attribute_templates = attributeTemplate.id;

  const [feedback] = await admin<{ id: string }[]>`
    insert into feedback_items (user_id, kind, body, page_path)
    values (${userId}, 'bug', ${`${tag} found a bug`}, '/shopping/dashboard')
    returning id`;
  ids.feedback_items = feedback.id;

  const [idea] = await admin<{ id: string }[]>`
    insert into ideas (user_id, body, module)
    values (${userId}, ${`${tag} had an idea`}, 'learn')
    returning id`;
  ids.ideas = idea.id;

  const [raised] = await admin<{ id: string }[]>`
    insert into raised_items (user_id, module, title, detail, source)
    values (
      ${userId}, 'dev', ${`${tag} needs an answer`},
      ${`${tag} found something while building`}, ${`${tag}'s routine, plan #1`}
    )
    returning id`;
  ids.raised_items = raised.id;

  // dev_comments refuses writes since plan #1470, which copied its threads
  // into core.conversations; it still holds the old rows, so it is still
  // checked. The seed goes in past the trigger.
  const [raisedComment] = await admin.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    return tx<{ id: string }[]>`
      insert into dev_comments (user_id, raised_item_id, author, body)
      values (${userId}, ${raised.id}, 'me', ${`${tag} answered it`})
      returning id`;
  });
  ids.dev_comments = raisedComment.id;

  const [specSection] = await admin<{ id: string }[]>`
    insert into spec_sections (user_id, slug, anchor, heading, position)
    values (${userId}, 'learn-map', ${`${tag}-what-an-edge-is`}, 'What an edge is', 10)
    returning id`;
  ids.spec_sections = specSection.id;

  // Keyed by (user_id, module) rather than an id of its own, so what goes in
  // `ids` is the owner and ROW_KEY below reads that column. Asking "how many of
  // A's visions can B see" is the isolation question anyway.
  await admin`
    insert into module_visions (user_id, module, body)
    values (${userId}, 'learn', ${`${tag} wants Learn to know what it does not know`})`;
  ids.module_visions = userId;

  // A pending edit, one per user and workspace, so seeding A and B each once
  // stays inside the one-pending index.
  const [visionReview] = await admin<{ id: string }[]>`
    insert into vision_reviews (
      user_id, module, review_id, outcome, vision_body, proposed_body, note, status
    )
    values (
      ${userId}, 'learn', gen_random_uuid(), 'edit',
      ${`${tag} wants Learn to know what it does not know`},
      ${`${tag} wants Learn to say what to read next`},
      ${`${tag} filed two notes asking what to read next`}, 'pending'
    )
    returning id`;
  ids.vision_reviews = visionReview.id;

  const [specChange] = await admin<{ id: string }[]>`
    insert into spec_changes (user_id, spec, title, why, diff)
    values (
      ${userId}, 'spec-layer', ${`${tag} adds a rule`}, ${`${tag} filed three notes asking for it`},
      ${'--- a/docs/X.md\n+++ b/docs/X.md\n@@ -1 +1,2 @@\n context\n+a rule'}
    )
    returning id`;
  ids.spec_changes = specChange.id;

  // One open interview per user and workspace, so seeding A and B each once
  // stays inside the one-open index.
  const [specInterview] = await admin<{ id: string }[]>`
    insert into spec_interviews (user_id, module, vision_review_id, spec_change_id)
    values (${userId}, 'learn', ${visionReview.id}, ${specChange.id})
    returning id`;
  ids.spec_interviews = specInterview.id;

  const [specFinding] = await admin<{ id: string }[]>`
    insert into spec_findings (user_id, spec, kind, finding, proposal, spec_change_id)
    values (${userId}, 'spec-layer', 'missing_rule', ${`${tag} notes ask for a rule`}, 'change_spec', ${specChange.id})
    returning id`;
  ids.spec_findings = specFinding.id;

  // Keyed by (user_id, target, row_id) rather than an id of its own, so what
  // goes in `ids` is the row the thread hangs off -- see ROW_KEY below.
  await admin`
    insert into dev_comment_reads (user_id, target, row_id)
    values (${userId}, 'idea', ${idea.id})`;
  ids.dev_comment_reads = idea.id;

  const [uiReview] = await admin<{ id: string }[]>`
    insert into ui_reviews (user_id, module, commit_sha, violations, note)
    values (
      ${userId}, 'vault', ${`${tag}c0ffee`}, 0,
      ${`${tag} left the settings page alone`}
    )
    returning id`;
  ids.ui_reviews = uiReview.id;

  const [uiFinding] = await admin<{ id: string }[]>`
    insert into ui_findings (user_id, review_id, file, line, law, surface, body)
    values (
      ${userId}, ${uiReview.id}, 'app/vault/page.tsx', 12, '11', 'vault-note',
      ${`${tag} saw a frame around a frame`}
    )
    returning id`;
  ids.ui_findings = uiFinding.id;

  const [uiCheck] = await admin<{ id: string }[]>`
    insert into ui_checks (user_id, step, surface, round, verdict, fixes)
    values (
      ${userId}, 1533, 'vault-note', 1, 'fix',
      ${admin.json([{ shot: 'phone-light', where: 'the header', problem: `${tag} crowded`, breaks: 'law 1', change: 'space it' }])}::jsonb
    )
    returning id`;
  ids.ui_checks = uiCheck.id;

  const [tasteRemoval] = await admin<{ id: string }[]>`
    insert into ui_taste_removals (user_id, taste_id)
    values (${userId}, 'twelve-hour-times')
    returning id`;
  ids.ui_taste_removals = tasteRemoval.id;

  const [planItem] = await admin<{ id: string }[]>`
    insert into plan_items (user_id, module, title, detail, status, position)
    values (
      ${userId}, 'learn', ${`${tag} planned a step`},
      ${`${tag} wrote down what it involves`}, 'in_progress', 10
    )
    returning id`;
  ids.plan_items = planItem.id;

  const [planStep] = await admin<{ id: string }[]>`
    insert into plan_items (user_id, module, title, parent_id)
    values (${userId}, 'learn', ${`${tag} planned a sub-step`}, ${planItem.id})
    returning id`;

  const [planDependency] = await admin<{ id: string }[]>`
    insert into plan_dependencies (user_id, item_id, depends_on_id)
    values (${userId}, ${planStep.id}, ${planItem.id})
    returning id`;
  ids.plan_dependencies = planDependency.id;

  const [planRun] = await admin<{ id: string }[]>`
    insert into plan_runs (user_id, plan_item_id, job, routine_id, external_id, http_status, response)
    values (
      ${userId}, ${planItem.id}, 'step', ${`trig_${tag}`}, ${`run_${tag}`}, 200,
      ${admin.json({ run_id: `run_${tag}` })}::jsonb
    )
    returning id`;
  ids.plan_runs = planRun.id;

  const [checkBack] = await admin<{ id: string }[]>`
    insert into check_backs (user_id, title, detail, due_at, plan_item_id, source, woke_run_id)
    values (
      ${userId}, ${`${tag} wants another look`}, ${`${tag} started something slow`},
      now() + interval '2 hours', ${planItem.id}, ${`${tag}'s routine, plan #1`}, ${planRun.id}
    )
    returning id`;
  ids.check_backs = checkBack.id;

  // The Inspiration tab's rows. Settings are keyed by the owner and the
  // video links by their takeaway: see ROW_KEY below.
  await admin`
    insert into inspiration_settings (user_id, youtube_playlist_id)
    values (${userId}, 'PLIBpAG8AqHoE')`;
  ids.inspiration_settings = userId;

  const [inspirationVideo] = await admin<{ id: string }[]>`
    insert into inspiration_videos (user_id, video_id, title)
    values (${userId}, 'dQw4w9WgXcQ', ${`${tag} saved a talk`})
    returning id`;
  ids.inspiration_videos = inspirationVideo.id;

  const [takeaway] = await admin<{ id: string }[]>`
    insert into inspiration_takeaways (user_id, title, body, module, status, plan_item_id)
    values (
      ${userId}, ${`${tag} heard an idea`}, ${`${tag} thinks it would help here`}, 'dev',
      'covered', ${planItem.id}
    )
    returning id`;
  ids.inspiration_takeaways = takeaway.id;

  await admin`
    insert into inspiration_takeaway_videos (takeaway_id, video_id, user_id, quote, start_seconds)
    values (${takeaway.id}, ${inspirationVideo.id}, ${userId}, ${`${tag} said so`}, 42)`;
  ids.inspiration_takeaway_videos = takeaway.id;

  const [socialPost] = await admin<{ id: string }[]>`
    insert into social_posts (user_id, angle, draft, body, source_plan_item_ids, run_id)
    values (
      ${userId}, ${`${tag} shipped a thing`}, ${admin.json([`${tag} drafted`])}::jsonb,
      ${admin.json([`${tag} edited`])}::jsonb, ${[planItem.id]}::uuid[], ${planRun.id}
    )
    returning id`;
  ids.social_posts = socialPost.id;

  const [commitCheck] = await admin<{ id: string }[]>`
    insert into plan_commit_checks (user_id, commit_sha, merge_sha, conclusion)
    values (${userId}, ${'abc1234'}, ${'def5678'}, 'passed')
    returning id`;
  ids.plan_commit_checks = commitCheck.id;

  const [overnight] = await admin<{ id: string }[]>`
    insert into plan_overnight_runs (
      user_id, running, paused, features_budget, features_left, stop_by, started_at
    )
    values (${userId}, true, false, 6, 6, now() + interval '8 hours', now())
    returning id`;
  ids.plan_overnight_runs = overnight.id;

  const [seedImport] = await admin<{ id: string }[]>`
    insert into plan_seed_imports (user_id, step_key)
    values (${userId}, ${`learn:${tag} already offered this step`})
    returning id`;
  ids.plan_seed_imports = seedImport.id;

  const [digest] = await admin<{ id: string }[]>`
    insert into dev_digests (user_id, day, since, happened, attention)
    values (
      ${userId}, current_date, now() - interval '1 day',
      ${admin.json([
        {
          kind: 'step',
          title: `${tag} shipped a step`,
          ref: '#1',
          commit: null,
          note: null,
          at: '2026-03-02T09:00:00Z',
        },
      ])}::jsonb,
      '[]'::jsonb
    )
    returning id`;
  ids.dev_digests = digest.id;

  const [bookQuote] = await admin<{ id: string }[]>`
    insert into book_price_quotes (isbn_13, source, quoted_cents, vendor_name)
    values (
      ${tag === 'alice' ? '9780735211292' : '9780143127550'},
      'buyback',
      ${tag === 'alice' ? 500 : 200},
      ${`${tag} books`}
    )
    returning id`;
  ids.book_price_quotes = bookQuote.id;

  const [gameQuote] = await admin<{ id: string }[]>`
    insert into game_price_quotes (bgg_id, source, quoted_cents, vendor_name)
    values (
      ${tag === 'alice' ? 13 : 822},
      'buyback',
      ${tag === 'alice' ? 1500 : 900},
      ${`${tag} games`}
    )
    returning id`;
  ids.game_price_quotes = gameQuote.id;

  // Unlike the two above this one is NOT shared reference data: it is keyed by
  // the item, so the row is as private as the item it prices.
  const [itemQuote] = await admin<{ id: string }[]>`
    insert into item_price_quotes (inventory_item_id, source, quoted_cents)
    values (${inventoryItem.id}, 'web_estimate', ${tag === 'alice' ? 2500 : 1100})
    returning id`;
  ids.item_price_quotes = itemQuote.id;

  const [use] = await admin<{ id: string }[]>`
    insert into item_uses (inventory_item_id, used_on)
    values (${inventoryItem.id}, current_date) returning id`;
  ids.item_uses = use.id;

  const [shipment] = await admin<{ id: string }[]>`
    insert into shipments (order_id, carrier, tracking_number, status)
    values (${order.id}, 'UPS', ${`${tag}-TRACK`}, 'in_transit') returning id`;
  ids.shipments = shipment.id;

  // The envelope is core's; ingested_messages is now only this app's verdict
  // about it, keyed by the same id.
  const [message] = await admin<{ id: string }[]>`
    insert into core.ingested_messages (email_account_id, provider_message_id, received_at,
                                        from_address, subject)
    values (${account.id}, ${`${tag}-msg-1`}, now(), ${`orders@${tag}.example`},
            ${`Your ${tag} order`})
    returning id`;

  await admin`
    insert into ingested_messages (id, classification, parse_status)
    values (${message.id}, 'order_confirmation', 'parsed')`;
  ids.ingested_messages = message.id;

  const [ret] = await admin<{ id: string }[]>`
    insert into returns (user_id, order_id, inventory_item_id, initiated_at,
                         refund_amount_cents, status, source_message_id)
    values (${userId}, ${order.id}, ${inventoryItem.id}, current_date, 500,
            'initiated', ${message.id})
    returning id`;
  ids.returns = ret.id;

  const [saved] = await admin<{ id: string }[]>`
    insert into saved_items (user_id, merchant_id, url, title, price_cents)
    values (${userId}, ${merchant.id}, ${`https://${tag}.example/p/1`}, ${`${tag} thing`}, 2000)
    returning id`;
  ids.saved_items = saved.id;

  const [check] = await admin<{ id: string }[]>`
    insert into price_checks (saved_item_id, price_cents, in_stock)
    values (${saved.id}, 1800, true) returning id`;
  ids.price_checks = check.id;

  await admin`
    insert into core.sync_jobs (email_account_id, type, status)
    values (${account.id}, 'backfill', 'completed') returning id`;

  const [exclusion] = await admin<{ id: string }[]>`
    insert into merchant_exclusions (user_id, merchant_id, match_domain)
    values (${userId}, ${merchant.id}, ${`${tag}.example`})
    returning id`;
  ids.merchant_exclusions = exclusion.id;

  const [itemList] = await admin<{ id: string }[]>`
    insert into item_lists (user_id, name, slug, color)
    values (${userId}, ${`${tag} list`}, ${`${tag}-list`}, '#6A82FB')
    returning id`;
  ids.item_lists = itemList.id;

  const [membership] = await admin<{ id: string }[]>`
    insert into inventory_item_lists (inventory_item_id, list_id)
    values (${inventoryItem.id}, ${itemList.id})
    returning id`;
  ids.inventory_item_lists = membership.id;

  const [itemGroup] = await admin<{ id: string }[]>`
    insert into item_groups (user_id, name, group_key)
    values (${userId}, ${`${tag} group`}, ${`item:title:${tag}-group`})
    returning id`;
  ids.item_groups = itemGroup.id;

  const [policy] = await admin<{ id: string }[]>`
    insert into merchant_return_policies (user_id, merchant_id, return_window_days)
    values (${userId}, ${merchant.id}, 30)
    returning id`;
  ids.merchant_return_policies = policy.id;

  const [itemTag] = await admin<{ id: string }[]>`
    insert into item_tags (user_id, name, slug)
    values (${userId}, ${`${tag} shoes`}, ${`${tag}-shoes`})
    returning id`;
  ids.item_tags = itemTag.id;

  const [orderItemTag] = await admin<{ id: string }[]>`
    insert into order_item_tags (order_item_id, tag_id)
    values (${orderItem.id}, ${itemTag.id})
    returning id`;
  ids.order_item_tags = orderItemTag.id;

  const [family] = await admin<{ id: string }[]>`
    insert into item_families (user_id, name, slug)
    values (${userId}, ${`${tag} monopoly`}, ${`${tag}-monopoly`})
    returning id`;
  ids.item_families = family.id;

  const [familyMember] = await admin<{ id: string }[]>`
    insert into inventory_item_families (inventory_item_id, family_id, role, confirmed_at)
    values (${inventoryItem.id}, ${family.id}, 'base', now())
    returning id`;
  ids.inventory_item_families = familyMember.id;

  const [inventoryTag] = await admin<{ id: string }[]>`
    insert into inventory_item_tags (inventory_item_id, tag_id)
    values (${inventoryItem.id}, ${itemTag.id})
    returning id`;
  ids.inventory_item_tags = inventoryTag.id;

  const [share] = await admin<{ id: string }[]>`
    insert into share_links (user_id, title, intro)
    values (${userId}, ${`${tag} keep or sell`}, 'Pick what stays.')
    returning id`;
  ids.share_links = share.id;

  const [shareToken] = await admin<{ id: string }[]>`
    insert into share_link_tokens (share_link_id, token)
    values (${share.id}, ${`${tag}-token-with-plenty-of-entropy-0001`})
    returning id`;
  ids.share_link_tokens = shareToken.id;

  const [shareItem] = await admin<{ id: string }[]>`
    insert into share_link_items (share_link_id, subject_id, group_key, family_key)
    values (${share.id}, ${inventoryItem.id}, ${`game:bgg:${tag === 'alice' ? 13 : 822}`},
            ${`${tag}-monopoly`})
    returning id`;
  ids.share_link_items = shareItem.id;

  const [shareResponse] = await admin<{ id: string }[]>`
    insert into share_link_responses (share_link_id, group_key, keep_qty, answered_by_token)
    values (${share.id}, ${`game:bgg:${tag === 'alice' ? 13 : 822}`}, 1, ${shareToken.id})
    returning id`;
  ids.share_link_responses = shareResponse.id;

  const [shareEvent] = await admin<{ id: string }[]>`
    insert into share_link_events (share_link_id, token_id, kind, group_key)
    values (${share.id}, ${shareToken.id}, 'responded',
            ${`game:bgg:${tag === 'alice' ? 13 : 822}`})
    returning id`;
  ids.share_link_events = shareEvent.id;

  const [fxRate] = await admin<{ id: string }[]>`
    insert into fx_rates (rate_date, base_currency, quote_currency, rate, source)
    values (
      current_date,
      'USD',
      ${tag === 'alice' ? 'EUR' : 'HKD'},
      ${tag === 'alice' ? 0.92 : 7.8},
      'test'
    )
    returning id`;
  ids.fx_rates = fxRate.id;

  const [payment] = await admin<{ id: string }[]>`
    insert into recurring_payments (user_id, payee, payee_key, kind, amount_cents, period)
    values (${userId}, ${`${tag} Streaming`}, ${`${tag}streaming`}, 'subscription', 1299, 'month')
    returning id`;
  ids.recurring_payments = payment.id;

  const [payeeAlias] = await admin<{ id: string }[]>`
    insert into recurring_payee_aliases (user_id, payee_key, payment_id)
    values (${userId}, ${`${tag}streamingplus`}, ${payment.id})
    returning id`;
  ids.recurring_payee_aliases = payeeAlias.id;

  const [billMessage] = await admin<{ id: string }[]>`
    insert into core.ingested_messages (email_account_id, provider_message_id, subject)
    values (${account.id}, ${`${tag}-bill-1`}, 'Your receipt')
    returning id`;

  const [recurringCharge] = await admin<{ id: string }[]>`
    insert into recurring_charges (user_id, payment_id, message_id, event, amount_cents, occurred_on)
    values (${userId}, ${payment.id}, ${billMessage.id}, 'charge', 1299, current_date)
    returning id`;
  ids.recurring_charges = recurringCharge.id;

  const [recurringVerdict] = await admin<{ id: string }[]>`
    insert into recurring_messages (id, user_id, claimed, parse_status, charge_id)
    values (${billMessage.id}, ${userId}, true, 'parsed', ${recurringCharge.id})
    returning id`;
  ids.recurring_messages = recurringVerdict.id;

  // Not anybody's row: whether main is green is a fact about the repository,
  // so there is one reading per repository and every signed-in user reads the
  // same one. Tagged per seed because `repo` is the primary key and the two
  // calls would otherwise collide on it.
  const [mainCheck] = await admin<{ repo: string }[]>`
    insert into plan_main_checks (repo, head_sha, conclusion)
    values (${`${tag}/PersonalDashboard`}, ${`${tag}-head-sha`}, 'passed')
    returning repo`;
  ids.plan_main_checks = mainCheck.repo;

  return ids;
}

let userA: string;
let userB: string;
let seedA: SeedIds;
let tables: string[];

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('alice@example.com');
  userB = await createUser('bob@example.com');
  seedA = await seedEverything(userA, 'alice');
  await seedEverything(userB, 'bob');
  tables = await listPublicTables();
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('RLS coverage', () => {
  it('has row level security enabled on every table in public', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('has at least one policy on every table in public', async () => {
    const rows = await admin<{ tablename: string }[]>`
      select t.tablename
      from pg_tables t
      where t.schemaname = 'public'
        and not exists (
          select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = t.tablename
        )
      order by 1`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('seeds every table, so a new table cannot skip the isolation check', () => {
    // If this fails, a table was added to the schema without being added to
    // seedEverything(). Add it there rather than deleting it from here.
    expect(Object.keys(seedA).sort()).toEqual([...tables].sort());
  });
});

describe('cross-user reads', () => {
  /**
   * Tables holding no user's rows: every authenticated user may read every
   * row. The first three are cached market data. `plan_main_checks` is the
   * same shape for a different reason -- the status line draws what CI said
   * about main, and that is one fact about one branch, not a fact per account.
   */
  const SHARED_REFERENCE_TABLES = new Set([
    'fx_rates',
    'book_price_quotes',
    'game_price_quotes',
    'plan_main_checks',
  ]);

  /**
   * Where a table's identity is not an `id` column, the column that stands in
   * for one. `dev_comment_reads` is a primary key of (user_id, target,
   * row_id) -- one row per conversation per person -- so the question "can B
   * see A's row" is asked of the row the thread hangs off.
   */
  const ROW_KEY: Record<string, string> = {
    dev_comment_reads: 'row_id',
    inspiration_settings: 'user_id',
    inspiration_takeaway_videos: 'takeaway_id',
    module_visions: 'user_id',
  };

  it('shows user B zero rows belonging to user A, in every table', async () => {
    const leaks: string[] = [];

    for (const table of tables) {
      if (SHARED_REFERENCE_TABLES.has(table)) continue;
      const id = seedA[table];
      const key = ROW_KEY[table] ?? 'id';
      const [row] = await asUser(userB, (tx) =>
        tx.unsafe<{ count: string }[]>(
          `select count(*)::int as count from ${table} where ${key} = $1`,
          [id],
        ),
      );
      if (Number(row.count) !== 0) leaks.push(table);
    }

    expect(leaks).toEqual([]);
  });

  it('still shows user B their own rows, so the policies are not just deny-all', async () => {
    const empty: string[] = [];

    for (const table of tables) {
      const [row] = await asUser(userB, (tx) =>
        tx.unsafe<{ count: string }[]>(`select count(*)::int as count from ${table}`),
      );
      if (Number(row.count) === 0) empty.push(table);
    }

    expect(empty).toEqual([]);
  });

  it('lets every authenticated user read cached FX rates', async () => {
    const rows = await asUser(userB, (tx) =>
      tx<{ id: string }[]>`select id from fx_rates where id = ${seedA.fx_rates}`,
    );
    expect(rows).toHaveLength(1);
  });

  it('lets every authenticated user read cached book price quotes', async () => {
    const rows = await asUser(userB, (tx) =>
      tx<{ id: string }[]>`select id from book_price_quotes where id = ${seedA.book_price_quotes}`,
    );
    expect(rows).toHaveLength(1);
  });

  it('lets every authenticated user read cached game price quotes', async () => {
    const rows = await asUser(userB, (tx) =>
      tx<{ id: string }[]>`select id from game_price_quotes where id = ${seedA.game_price_quotes}`,
    );
    expect(rows).toHaveLength(1);
  });

  it("lets every authenticated user read what CI said about main", async () => {
    const rows = await asUser(userB, (tx) =>
      tx<{ repo: string }[]>`
        select repo from plan_main_checks where repo = ${seedA.plan_main_checks}`,
    );
    expect(rows).toHaveLength(1);
  });

  it('lets no authenticated user write what CI said about main', async () => {
    // The status line draws this row on every page. A browser that could write
    // it could paint main green while it is red, for the one reader who most
    // needs to know otherwise.
    await expect(
      asUser(userB, (tx) =>
        tx`update plan_main_checks set conclusion = 'passed' where repo = ${seedA.plan_main_checks}`,
      ),
    ).rejects.toThrow();
  });
});

describe('shared tables leak nothing user-scoped', () => {
  it('lets user B read system categories but not user A categories', async () => {
    const rows = await asUser(userB, (tx) =>
      tx<{ user_id: string | null }[]>`select user_id from categories`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.user_id === null)).toBe(true);
    expect(rows.some((r) => r.user_id === userA)).toBe(false);
  });

  it('lets user B read global merchants but not user A merchants', async () => {
    const rows = await asUser(userB, (tx) =>
      tx<{ is_global: boolean; created_by_user_id: string | null }[]>`
        select is_global, created_by_user_id from merchants`,
    );
    expect(rows.some((r) => r.is_global)).toBe(true);
    expect(rows.some((r) => r.created_by_user_id === userA)).toBe(false);
  });
});

describe('cross-user writes', () => {
  it('does not let user B update user A rows', async () => {
    // email_accounts moved to core; its isolation is covered in rls-core.
    for (const table of ['orders', 'inventory_items', 'saved_items']) {
      const affected = await asUser(userB, (tx) =>
        tx.unsafe(`update ${table} set updated_at = now() where id = $1 returning id`, [
          seedA[table],
        ]),
      );
      expect(affected.length, `${table} was writable by another user`).toBe(0);
    }
  });

  it("does not let user B move user A's recurring charges", async () => {
    const affected = await asUser(userB, (tx) =>
      tx`update recurring_charges set payment_id = payment_id
         where id = ${seedA.recurring_charges} returning id`,
    );
    expect(affected.length).toBe(0);
  });

  it('does not let user B create a recurring payment for user A', async () => {
    await expect(
      asUser(userB, (tx) =>
        tx`insert into recurring_payments (user_id, payee, payee_key)
           values (${userA}, 'Not yours', 'notyours')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('does not let user B delete user A rows', async () => {
    for (const table of ['orders', 'inventory_items', 'saved_items']) {
      const affected = await asUser(userB, (tx) =>
        tx.unsafe(`delete from ${table} where id = $1 returning id`, [seedA[table]]),
      );
      expect(affected.length, `${table} was deletable by another user`).toBe(0);
    }
  });

  it('does not let user B insert a row owned by user A', async () => {
    await expect(
      asUser(userB, (tx) =>
        tx`insert into saved_items (user_id, url) values (${userA}, 'https://x.example/1')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('does not let a user edit a system category', async () => {
    const affected = await asUser(userB, (tx) =>
      tx`update categories set name = 'hijacked' where user_id is null returning id`,
    );
    expect(affected.length).toBe(0);
  });

  it('does not let a user create a global merchant', async () => {
    await expect(
      asUser(userB, (tx) =>
        tx`insert into merchants (name, slug, is_global) values ('Evil', 'evil', true)`,
      ),
    ).rejects.toThrow(/row-level security|violates check constraint/i);
  });

  it('does not let a user attach a child row to another user parent', async () => {
    await expect(
      asUser(userB, (tx) =>
        tx`insert into order_items (order_id, name, quantity, unit_price_cents)
           values (${seedA.orders}, 'smuggled', 1, 100)`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('privacy constraints', () => {
  it('refuses to store a subject or sender on a not_relevant message', async () => {
    // The row constraint that used to enforce this is gone, and could not have
    // survived: "not relevant" is one workspace's opinion now, and the message
    // this app discards may be the one the job side is keeping. The rule moved
    // to core.scrub_unclaimed_messages(), which is covered in rls-core.
    const [account] = await admin<{ id: string }[]>`
      insert into core.email_accounts (user_id, provider, email_address)
      values (${await createUser('bare@example.com')}, 'gmail', 'bare@example.com')
      returning id`;
    const [msg] = await admin<{ id: string }[]>`
      insert into core.ingested_messages (email_account_id, provider_message_id, subject)
      values (${account.id}, 'bare-1', 'Dinner on Friday?')
      returning id`;
    await admin`insert into ingested_messages (id, classification) values (${msg.id}, 'not_relevant')`;

    // One workspace alone cannot cause a scrub.
    const [{ scrubbed }] = await admin<{ scrubbed: number }[]>`
      select core.scrub_unclaimed_messages() as scrubbed`;
    expect(scrubbed).toBe(0);
    const [kept] = await admin<{ subject: string | null }[]>`
      select subject from core.ingested_messages where id = ${msg.id}`;
    expect(kept.subject).toBe('Dinner on Friday?');
  });
});
