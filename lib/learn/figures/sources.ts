/**
 * The data sources a chart may name (plan #2321.3).
 *
 * A chart in a lesson shows numbers fetched from one of these, never numbers
 * the model wrote. Each source says how a series is named, which is what the
 * writer is told, and how one is fetched. A fetch is cached in
 * learn.figure_series (`./series-store.ts`), so a series is pulled once.
 *
 * Every source here is free to read without a key: FRED through its graph
 * CSV, the World Bank through its open API, Our World in Data through its
 * chart CSVs. Points are by year; a monthly or daily series is averaged over
 * each year it has.
 */

export const DATA_SOURCE_IDS = ['fred', 'worldbank', 'owid'] as const;
export type DataSourceId = (typeof DATA_SOURCE_IDS)[number];

/** A series as a chart names it. `place` is a country code for the sources that need one. */
export type SeriesRef = { source: DataSourceId; id: string; place?: string | null };

export type SeriesPoint = { year: number; value: number };

/** A fetched series, as the cache keeps it. */
export type Series = {
  source: DataSourceId;
  id: string;
  /** Upper-cased code, or '' for a source with no places. */
  place: string;
  /** What the source calls the series. */
  title: string;
  unit: string | null;
  /** What the source calls the place, such as "United Kingdom". */
  placeName: string | null;
  /** The series' own page, linked from the figure's foot. */
  url: string;
  /** One value a year, oldest first. */
  points: SeriesPoint[];
};

/**
 * What a fetch found. `missing` is an answer (no such series, or no data for
 * that place) and is cached like a hit; a network failure or a server error
 * throws instead, so a bad minute is never remembered as a series that does
 * not exist.
 */
export type FetchedSeries = { found: true; series: Series } | { found: false };

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export type DataSource = {
  id: DataSourceId;
  /** Named in the figure's foot. */
  label: string;
  /** The licence the foot names after the label, where the source asks for attribution. */
  licence: string | null;
  needsPlace: boolean;
  /** How the writer names a series from this source; joined into the chart kind's writer line. */
  writerLine: string;
  fetch(ref: SeriesRef, fetchImpl: FetchLike, signal?: AbortSignal): Promise<FetchedSeries>;
};

const MISSING: FetchedSeries = { found: false };

/** The place as the cache keys it. */
export function placeKey(ref: SeriesRef): string {
  return (ref.place ?? '').trim().toUpperCase();
}

/** Averages a dated series to one point a year, rounded to four significant figures. */
export function yearly(dated: readonly { year: number; value: number }[]): SeriesPoint[] {
  const sums = new Map<number, { total: number; count: number }>();
  for (const { year, value } of dated) {
    if (!Number.isFinite(value) || !Number.isInteger(year)) continue;
    const sum = sums.get(year) ?? { total: 0, count: 0 };
    sum.total += value;
    sum.count += 1;
    sums.set(year, sum);
  }
  return [...sums.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, { total, count }]) => ({ year, value: Number((total / count).toPrecision(4)) }));
}

async function get(fetchImpl: FetchLike, url: string, signal?: AbortSignal): Promise<Response | null> {
  const response = await fetchImpl(url, { signal });
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response;
}

/** Splits one CSV line, keeping commas inside quotes. */
export function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else cell += char;
  }
  cells.push(cell);
  return cells;
}

function csvRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map(csvCells);
}

// ---- FRED -------------------------------------------------------------------------

/** FRED's graph CSV: a date column and the series' column, "." where a value is missing. */
export function parseFredCsv(text: string): SeriesPoint[] {
  const rows = csvRows(text);
  if (rows.length < 2 || rows[0].length < 2) return [];
  return yearly(
    rows.slice(1).flatMap(([date, raw]) => {
      const value = Number(raw);
      const year = Number(date?.slice(0, 4));
      return raw && raw !== '.' && Number.isFinite(value) ? [{ year, value }] : [];
    }),
  );
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** The title and units from a FRED series page, which the graph CSV does not carry. */
export function parseFredPage(html: string): { title: string | null; unit: string | null } {
  const title = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/)?.[1] ?? null;
  const unit = html.match(/series-meta-value-units">\s*([^<]+?)\s*</)?.[1] ?? null;
  return { title: title && decodeEntities(title).trim(), unit: unit && decodeEntities(unit).trim() };
}

const fred: DataSource = {
  id: 'fred',
  label: 'FRED, Federal Reserve Bank of St. Louis',
  licence: null,
  needsPlace: false,
  writerLine:
    'fred: id is the FRED series id, such as UNRATE (US unemployment rate), CPIAUCSL (US consumer prices) or GDPC1 (US real GDP); no place.',
  async fetch(ref, fetchImpl, signal) {
    const id = ref.id.trim().toUpperCase();
    const csv = await get(fetchImpl, `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`, signal);
    if (!csv) return MISSING;
    const points = parseFredCsv(await csv.text());
    if (points.length === 0) return MISSING;
    const url = `https://fred.stlouisfed.org/series/${encodeURIComponent(id)}`;
    // The page only adds the name and units; the series stands without them.
    const page = await get(fetchImpl, url, signal).catch(() => null);
    const meta = page ? parseFredPage(await page.text()) : { title: null, unit: null };
    return { found: true, series: { source: 'fred', id, place: '', title: meta.title ?? id, unit: meta.unit, placeName: null, url, points } };
  },
};

// ---- World Bank ---------------------------------------------------------------------

/** The World Bank API's answer: [paging, rows], or [{message}] for an indicator it does not have. */
export function parseWorldBank(body: unknown): Omit<Series, 'source' | 'id' | 'place' | 'url'> | null {
  if (!Array.isArray(body) || !Array.isArray(body[1])) return null;
  const rows = body[1] as { indicator?: { value?: string }; country?: { value?: string }; date?: string; value?: number | null }[];
  const points = yearly(
    rows.flatMap((row) => (typeof row.value === 'number' ? [{ year: Number(row.date), value: row.value }] : [])),
  );
  if (points.length === 0) return null;
  return {
    title: rows[0]?.indicator?.value?.trim() || 'World Bank series',
    unit: null,
    placeName: rows[0]?.country?.value?.trim() || null,
    points,
  };
}

const worldBank: DataSource = {
  id: 'worldbank',
  label: 'World Bank',
  licence: 'CC BY 4.0',
  needsPlace: true,
  writerLine:
    'worldbank: id is the World Development Indicators code, such as NY.GDP.PCAP.CD (GDP per person, US$), SP.DYN.LE00.IN (life expectancy) or FP.CPI.TOTL.ZG (inflation); place is an ISO 3166 three-letter country code such as GBR, or WLD for the world.',
  async fetch(ref, fetchImpl, signal) {
    const id = ref.id.trim().toUpperCase();
    const place = placeKey(ref);
    if (!place) return MISSING;
    const response = await get(
      fetchImpl,
      `https://api.worldbank.org/v2/country/${encodeURIComponent(place)}/indicator/${encodeURIComponent(id)}?format=json&per_page=500`,
      signal,
    );
    if (!response) return MISSING;
    const parsed = parseWorldBank(await response.json());
    if (!parsed) return MISSING;
    const url = `https://data.worldbank.org/indicator/${encodeURIComponent(id)}?locations=${encodeURIComponent(place)}`;
    return { found: true, series: { source: 'worldbank', id, place, url, ...parsed } };
  },
};

// ---- Our World in Data ----------------------------------------------------------------

/**
 * A grapher chart's CSV (entity, code, year, then the value column first),
 * kept to one country code. A chart by day rather than year has no year
 * column and reads as missing.
 */
export function parseOwidCsv(text: string, place: string): { placeName: string | null; points: SeriesPoint[] } {
  const rows = csvRows(text);
  const head = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const [entity, code, year] = [head.indexOf('entity'), head.indexOf('code'), head.indexOf('year')];
  if (entity < 0 || code < 0 || year < 0 || head.length <= Math.max(entity, code, year) + 1) return { placeName: null, points: [] };
  const valueAt = Math.max(entity, code, year) + 1;
  const mine = rows.slice(1).filter((row) => row[code]?.trim().toUpperCase() === place);
  return {
    placeName: mine[0]?.[entity]?.trim() || null,
    points: yearly(
      mine.flatMap((row) => {
        const value = row[valueAt] === '' ? NaN : Number(row[valueAt]);
        return Number.isFinite(value) ? [{ year: Number(row[year]), value }] : [];
      }),
    ),
  };
}

/** The chart's title and its value column's unit, from the grapher's metadata. */
export function parseOwidMeta(body: unknown): { title: string | null; unit: string | null } {
  if (!body || typeof body !== 'object') return { title: null, unit: null };
  const { chart, columns } = body as { chart?: { title?: string }; columns?: Record<string, { unit?: string; shortUnit?: string }> };
  const first = columns ? Object.values(columns)[0] : undefined;
  return { title: chart?.title?.trim() || null, unit: first?.unit?.trim() || first?.shortUnit?.trim() || null };
}

const owid: DataSource = {
  id: 'owid',
  label: 'Our World in Data',
  licence: 'CC BY 4.0',
  needsPlace: true,
  writerLine:
    'owid: id is the chart slug from ourworldindata.org/grapher/<slug>, such as life-expectancy, co-emissions-per-capita or share-of-population-in-extreme-poverty; place is an ISO 3166 three-letter country code such as GBR, or OWID_WRL for the world.',
  async fetch(ref, fetchImpl, signal) {
    const slug = ref.id.trim().toLowerCase();
    const place = placeKey(ref);
    if (!place || !/^[a-z0-9-]+$/.test(slug)) return MISSING;
    const base = `https://ourworldindata.org/grapher/${slug}`;
    const csv = await get(fetchImpl, `${base}.csv?csvType=full&useColumnShortNames=true&country=~${encodeURIComponent(place)}`, signal);
    if (!csv) return MISSING;
    const { placeName, points } = parseOwidCsv(await csv.text(), place);
    if (points.length === 0) return MISSING;
    const metaResponse = await get(fetchImpl, `${base}.metadata.json`, signal).catch(() => null);
    const meta = metaResponse ? parseOwidMeta(await metaResponse.json().catch(() => null)) : { title: null, unit: null };
    return {
      found: true,
      series: { source: 'owid', id: slug, place, title: meta.title ?? slug, unit: meta.unit, placeName, url: base, points },
    };
  },
};

export const DATA_SOURCES: readonly DataSource[] = [fred, worldBank, owid];

export function dataSource(id: DataSourceId): DataSource {
  const source = DATA_SOURCES.find((each) => each.id === id);
  if (!source) throw new Error(`No data source ${id}`);
  return source;
}

/** The series id as the cache keys it, the case each source uses. */
export function seriesIdKey(ref: SeriesRef): string {
  return ref.source === 'owid' ? ref.id.trim().toLowerCase() : ref.id.trim().toUpperCase();
}
