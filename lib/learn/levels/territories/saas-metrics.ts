import type { Territory } from '@/lib/learn/levels/territory';

/**
 * The SaaS metrics territory (plan #2172.6): the first territory drafted the
 * slow way, from sources rather than a model's guess.
 *
 * The sources were read on 16 October 2026 and are copied here as published,
 * headings in order:
 *
 * - David Skok, "SaaS Metrics 2.0: A Guide to Measuring and Improving what
 *   Matters" (forentrepreneurs.com/saas-metrics-2), a practitioner text.
 * - Jeff Jordan, Anu Hariharan, Frank Chen and Preethi Kasireddy, "16 Startup
 *   Metrics" (a16z.com/16-startup-metrics, 2015), a practitioner text.
 * - Pavilion's SaaS Metrics Fundamentals course, session 1, "SaaS Metrics
 *   Definitions" (joinpavilion.com), the course syllabus.
 * - Growth Equity Interview Guide's "SaaS Metrics & Financial Modeling Deep
 *   Dive" (growthequityinterviewguide.com), its eight modules: a second
 *   syllabus, for the accounting and modelling half that Pavilion's first
 *   session does not reach.
 *
 * The roles' requirement lines are read from job_search when the territory is
 * drafted, so they are the person's roles as they stand then: titles with
 * FP&A, and titles with Strategic Finance, which is what the person pursued
 * (no role in job_search has SaaS in its title).
 *
 * The performances are the goal "SaaS and subscription business metrics"
 * (learn aim fecbf23f, depth solid) made into things to do: its about-line
 * names ARR, net revenue retention, CAC payback, cohort analysis, gross
 * margin structure and how these drive valuation.
 *
 * Each topic names the source lines that put it on the list (`from`), as
 * `<source key>: <line>`, and a test holds every one of them to a line that
 * is really there. The frame topic each refines is a Level 4 article in
 * learn.area_check_articles, by title. Order matters: the drafter goes down
 * the list, and a later topic can link to an earlier one only once it is on
 * the map, so the list runs from the ledger outwards.
 */
export const SAAS_METRICS: Territory = {
  key: 'saas-metrics',
  name: 'SaaS metrics',
  subjectLens: 'SaaS and subscription business metrics',
  // The learn aim this territory serves, and the kind classified for it
  // (plan #2247.2), which names the providers a first draft pulls from.
  goal: {
    name: 'SaaS and subscription business metrics',
    about: 'ARR, net revenue retention, CAC payback, cohort analysis, gross margin structure and how these drive valuation',
  },
  kind: 'practical_skill',
  performances: [
    'Build an ARR bridge from a customer list for a quarter and explain each movement: new, expansion, contraction and churn',
    'Compute gross and net revenue retention from cohort data and say what drives the gap between them',
    'Work out CAC, LTV, LTV to CAC and CAC payback for a business and judge whether its growth is efficient',
    "Forecast a SaaS company's next-year revenue and cash burn from its bookings, retention and pipeline",
    "Explain to an investor how gross margin, retention and growth set a software company's valuation multiple",
  ],
  roles: ['FP&A', 'Strategic Finance'],
  texts: [
    {
      key: 'skok',
      label: 'David Skok, SaaS Metrics 2.0: A Guide to Measuring and Improving what Matters (forentrepreneurs.com)',
      items: [
        "What's so different about SaaS?",
        'The SaaS P&L / Cash Flow Trough',
        'Why is growth important?',
        'A Powerful Tool: Unit Economics',
        'Is your SaaS business viable?',
        'Three uses for the SaaS Guidelines',
        'Unit Economics in Action: HubSpot Example',
        'Two kinds of SaaS business',
        'SaaS Bookings: Three Contributing Elements',
        'The Importance of Customer Retention (Churn)',
        'The Power of Negative Churn',
        'Defining a Dashboard for a SaaS Company',
        'Detailed definitions of the various metrics used',
        'Revenue Churn vs Customer Churn: why are they different?',
        'Getting paid in advance',
        'Calculating CAC and LTV',
        'More on Churn: Cohort Analysis',
        'Two ways to run Cohort Analysis',
        'Predicting Churn: Customer Engagement Score',
        'NPS: Net Promoter Score',
        'Guidelines for Churn',
        'The Importance of Customer Segmentation',
        'Funnel Metrics',
        'Using Funnel Metrics in Forward Planning',
        'Sales Capacity',
        'Understanding the ROI for different Lead Sources',
        'What Levers are available to drive Growth',
        'Sales Metrics',
        'Pricing/Upsell/Cross Sell',
        'International Markets',
        'Plan ahead',
        'The High Level Picture: How to Run a SaaS Business',
      ],
    },
    {
      key: 'a16z',
      label: 'Jordan, Hariharan, Chen and Kasireddy, 16 Startup Metrics (a16z.com, 2015)',
      items: [
        'Bookings vs. revenue',
        'Recurring revenue vs. Total revenue',
        'Gross profit',
        'Total contract value (TCV) vs. annual contract value (ACV)',
        'LTV (lifetime value)',
        'Gross merchandise value (GMV) vs. revenue',
        'Unearned or deferred revenue, and billings',
        'CAC (customer acquisition cost): blended vs. paid, organic vs. inorganic',
        'Active users',
        'Month-on-month (MoM) growth',
        'Churn',
        'Burn rate',
        'Downloads',
        'Cumulative charts (vs. growth metrics)',
        'Chart tricks',
        'Order of operations',
      ],
    },
    {
      key: 'pavilion',
      label: 'Pavilion, SaaS Metrics Fundamentals Course, session 1: SaaS Metrics Definitions (syllabus)',
      items: [
        'The basics of recurring revenue: MRR and ARR',
        'Expansion, contraction, and reactivation',
        'Churn rate (customer churn, gross revenue churn, net revenue churn)',
        'Negative churn rates',
        'Lifetime value',
        'Cost of acquisition, and LTV:CAC ratio',
        'Cohorts',
      ],
    },
    {
      key: 'geig',
      label: 'Growth Equity Interview Guide, SaaS Metrics & Financial Modeling Deep Dive: modules (syllabus)',
      items: [
        'SaaS Contracts',
        'ARR Waterfalls',
        'SaaS Metrics & Benchmarking',
        'Revenue Modeling',
        'Expense & Costs Modeling',
        'Cohort & Retention Analysis',
        'Software Accounting & Revenue Recognition',
        'Advanced SaaS Modeling Techniques',
      ],
    },
  ],
  topics: [
    {
      ask: 'Recurring revenue: MRR and ARR',
      scope: 'What counts as monthly and annual recurring revenue, and what is left out of it, as against total revenue.',
      frame: 'Accounting',
      target: 5,
      from: ['pavilion: The basics of recurring revenue: MRR and ARR', 'a16z: Recurring revenue vs. Total revenue'],
    },
    {
      ask: 'SaaS contracts: ACV and TCV',
      scope: 'How a subscription contract is valued per year and over its term, and what multi-year, ramped and discounted deals do to each.',
      frame: 'Sales',
      target: 4,
      from: ['geig: SaaS Contracts', 'a16z: Total contract value (TCV) vs. annual contract value (ACV)'],
    },
    {
      ask: 'Bookings, billings and revenue in SaaS',
      scope: 'The difference between signing, invoicing and earning in a subscription business, and how cash collected in advance moves between them.',
      frame: 'Accounting',
      target: 5,
      from: [
        'a16z: Bookings vs. revenue',
        'skok: SaaS Bookings: Three Contributing Elements',
        'skok: Getting paid in advance',
      ],
    },
    {
      ask: 'SaaS revenue recognition and deferred revenue',
      scope: 'How subscription revenue is recognised over the service period and how deferred revenue and billings tie to the income statement.',
      frame: 'Accounting',
      target: 5,
      from: ['geig: Software Accounting & Revenue Recognition', 'a16z: Unearned or deferred revenue, and billings'],
    },
    {
      ask: 'ARR bridge: new, expansion, contraction and churn',
      scope: 'The waterfall from opening to closing ARR, each movement in it and how it is built from a customer list.',
      frame: 'Accounting',
      target: 6,
      from: ['geig: ARR Waterfalls', 'pavilion: Expansion, contraction, and reactivation'],
    },
    {
      ask: 'Customer churn and revenue churn',
      scope: 'Logo churn as against gross revenue churn, how each is measured and why they diverge.',
      frame: 'Sales',
      target: 6,
      from: [
        'pavilion: Churn rate (customer churn, gross revenue churn, net revenue churn)',
        'skok: Revenue Churn vs Customer Churn: why are they different?',
        'skok: The Importance of Customer Retention (Churn)',
        'a16z: Churn',
      ],
    },
    {
      ask: 'Net revenue retention and negative churn',
      scope: 'Gross and net dollar retention, how expansion from existing customers can outrun churn, and what that does to growth.',
      frame: 'Sales',
      target: 6,
      from: ['skok: The Power of Negative Churn', 'pavilion: Negative churn rates'],
    },
    {
      ask: 'SaaS cohort analysis',
      scope: 'Grouping customers by start date to read retention and revenue over time, and the two ways of laying a cohort table out.',
      frame: 'Sales',
      target: 5,
      from: [
        'skok: More on Churn: Cohort Analysis',
        'skok: Two ways to run Cohort Analysis',
        'geig: Cohort & Retention Analysis',
        'pavilion: Cohorts',
      ],
    },
    {
      ask: 'Predicting churn: customer health and NPS',
      scope: 'Leading signals of churn such as engagement scores and Net Promoter Score, and how far they predict it.',
      frame: 'Sales',
      target: 4,
      from: ['skok: Predicting Churn: Customer Engagement Score', 'skok: NPS: Net Promoter Score', 'skok: Guidelines for Churn'],
    },
    {
      ask: 'Gross margin in software',
      scope: 'What goes into cost of revenue for a SaaS company, what gross margin it usually runs at and why that matters for its economics.',
      frame: 'Profit (economics)',
      target: 5,
      from: ['a16z: Gross profit', 'geig: Expense & Costs Modeling'],
    },
    {
      ask: 'Customer acquisition cost (CAC)',
      scope: 'The cost of winning a customer, blended as against paid, and which sales and marketing costs go into it.',
      frame: 'Sales',
      target: 5,
      from: ['a16z: CAC (customer acquisition cost): blended vs. paid, organic vs. inorganic', 'skok: Calculating CAC and LTV'],
    },
    {
      ask: 'Customer lifetime value (LTV)',
      scope: 'The gross profit a customer brings over its life, how churn sets that life and where the formula misleads.',
      frame: 'Profit (economics)',
      target: 5,
      from: ['a16z: LTV (lifetime value)', 'pavilion: Lifetime value', 'skok: Calculating CAC and LTV'],
    },
    {
      ask: 'SaaS unit economics: LTV to CAC and CAC payback',
      scope: 'Whether a customer pays back what it cost to win: the LTV to CAC ratio, the months to recover CAC and the thresholds practitioners use.',
      frame: 'Investment',
      target: 6,
      from: [
        'skok: A Powerful Tool: Unit Economics',
        'pavilion: Cost of acquisition, and LTV:CAC ratio',
        'skok: Is your SaaS business viable?',
        'skok: Unit Economics in Action: HubSpot Example',
      ],
    },
    {
      ask: 'SaaS sales funnel metrics and sales capacity',
      scope: 'Conversion through the funnel, ROI by lead source and how quota capacity limits bookings.',
      frame: 'Sales',
      target: 4,
      from: [
        'skok: Funnel Metrics',
        'skok: Sales Capacity',
        'skok: Understanding the ROI for different Lead Sources',
        'skok: Sales Metrics',
      ],
    },
    {
      ask: 'SaaS customer segmentation',
      scope: 'Splitting customers by size or kind so that churn, CAC and LTV are read for each segment rather than blended.',
      frame: 'Market (economics)',
      target: 4,
      from: ['skok: The Importance of Customer Segmentation', 'skok: Two kinds of SaaS business'],
    },
    {
      ask: 'SaaS pricing, upsell and cross-sell',
      scope: 'How price levels and expansion offers raise revenue per customer and feed net retention.',
      frame: 'Price',
      target: 4,
      from: ['skok: Pricing/Upsell/Cross Sell'],
    },
    {
      ask: 'SaaS growth rate',
      scope: 'Month-on-month and year-on-year growth in recurring revenue, why it matters so much for a SaaS company and how cumulative charts hide it.',
      frame: 'Company',
      target: 5,
      from: [
        'skok: Why is growth important?',
        'a16z: Month-on-month (MoM) growth',
        'a16z: Cumulative charts (vs. growth metrics)',
        'skok: What Levers are available to drive Growth',
      ],
    },
    {
      ask: 'Burn rate and the SaaS cash flow trough',
      scope: 'Why a growing subscription business loses cash before it earns it back, gross as against net burn, and runway.',
      frame: 'Capital (economics)',
      target: 5,
      from: ['skok: The SaaS P&L / Cash Flow Trough', 'a16z: Burn rate'],
    },
    {
      ask: 'SaaS revenue forecasting',
      scope: 'Building a forward revenue and cost model from bookings, retention and pipeline, and planning against it.',
      frame: 'Accounting',
      target: 6,
      from: [
        'geig: Revenue Modeling',
        'skok: Using Funnel Metrics in Forward Planning',
        'skok: Plan ahead',
        'geig: Advanced SaaS Modeling Techniques',
      ],
    },
    {
      ask: 'SaaS metrics dashboard and benchmarks',
      scope: 'Which metrics a SaaS company reports together, what good looks like against peers and the order to read them in.',
      frame: 'Company',
      target: 5,
      from: [
        'skok: Defining a Dashboard for a SaaS Company',
        'geig: SaaS Metrics & Benchmarking',
        'a16z: Order of operations',
        'skok: The High Level Picture: How to Run a SaaS Business',
      ],
    },
  ],
};
