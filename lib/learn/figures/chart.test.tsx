import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Figure } from '@/components/learn/figure';
import { chartKind } from './kinds/chart';
import { chartData, compactNumber, plotGroups } from './kinds/chart-data';
import { readWrittenFigures } from './registry';
import { resolveFigures } from './resolve';
import { seriesLoader, type SeriesCache } from './series-store';
import {
  csvCells,
  parseFredCsv,
  parseFredPage,
  parseOwidCsv,
  parseOwidMeta,
  parseWorldBank,
  type FetchLike,
  type FetchedSeries,
  type Series,
  type SeriesRef,
} from './sources';

const block = (spec: unknown) => ({ kind: 'chart', caption: 'Unemployment in the US since 2000.', spec });

function memoryCache(): SeriesCache & { rows: Map<string, FetchedSeries> } {
  const rows = new Map<string, FetchedSeries>();
  const key = (ref: SeriesRef) => `${ref.source}:${ref.id}:${ref.place ?? ''}`;
  return {
    rows,
    read: async (ref) => rows.get(key(ref)),
    write: async (ref, fetched) => void rows.set(key(ref), fetched),
  };
}

function fakeFetch(answers: Record<string, { status: number; body: string }>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const hit = Object.entries(answers).find(([prefix]) => url.startsWith(prefix));
    const { status, body } = hit?.[1] ?? { status: 404, body: '' };
    return new Response(body, { status });
  }) as FetchLike & { calls: string[] };
  impl.calls = calls;
  return impl;
}

const FRED_CSV = 'observation_date,UNRATE\n2000-01-01,4.0\n2000-07-01,4.0\n2001-01-01,4.2\n2001-07-01,4.6\n2002-01-01,.\n2002-07-01,5.8\n';
const FRED_PAGE = '<meta property="og:title" content="Unemployment Rate"><span class="series-meta-value-units">\nPercent</span>';

describe('the data sources (plan #2321.3)', () => {
  it('reads FRED by year, skipping its missing values', () => {
    expect(parseFredCsv(FRED_CSV)).toEqual([
      { year: 2000, value: 4 },
      { year: 2001, value: 4.4 },
      { year: 2002, value: 5.8 },
    ]);
    expect(parseFredPage(FRED_PAGE)).toEqual({ title: 'Unemployment Rate', unit: 'Percent' });
  });

  it('reads the World Bank, and its answer for an unknown indicator as nothing', () => {
    const body = [
      { page: 1 },
      [
        { indicator: { value: 'Life expectancy at birth, total (years)' }, country: { value: 'United Kingdom' }, date: '2024', value: 81.39 },
        { indicator: { value: 'Life expectancy at birth, total (years)' }, country: { value: 'United Kingdom' }, date: '2025', value: null },
        { indicator: { value: 'Life expectancy at birth, total (years)' }, country: { value: 'United Kingdom' }, date: '2023', value: 81.24 },
      ],
    ];
    expect(parseWorldBank(body)).toMatchObject({
      title: 'Life expectancy at birth, total (years)',
      placeName: 'United Kingdom',
      points: [
        { year: 2023, value: 81.24 },
        { year: 2024, value: 81.39 },
      ],
    });
    expect(parseWorldBank([{ message: [{ id: '120' }] }])).toBeNull();
  });

  it('reads an Our World in Data chart for one country, quoted names and all', () => {
    const csv = 'entity,code,year,life_expectancy_0\n"Korea, South",KOR,2000,76.0\nUnited Kingdom,GBR,2000,77.7\nUnited Kingdom,GBR,2001,78.0\n';
    expect(csvCells('"Korea, South",KOR,2000')).toEqual(['Korea, South', 'KOR', '2000']);
    expect(parseOwidCsv(csv, 'GBR')).toEqual({
      placeName: 'United Kingdom',
      points: [
        { year: 2000, value: 77.7 },
        { year: 2001, value: 78 },
      ],
    });
    expect(parseOwidCsv('entity,code,day,cases\nX,GBR,2020-01-01,3\n', 'GBR').points).toEqual([]);
    expect(parseOwidMeta({ chart: { title: 'Life expectancy' }, columns: { a: { unit: 'years' } } })).toEqual({
      title: 'Life expectancy',
      unit: 'years',
    });
  });
});

describe('the series cache (plan #2321.3)', () => {
  it('fetches a series once and reads it from the cache after', async () => {
    const cache = memoryCache();
    const fetchImpl = fakeFetch({
      'https://fred.stlouisfed.org/graph/fredgraph.csv': { status: 200, body: FRED_CSV },
      'https://fred.stlouisfed.org/series/UNRATE': { status: 200, body: FRED_PAGE },
    });
    const load = seriesLoader({ cache, fetchImpl });
    const first = await load({ source: 'fred', id: 'unrate' });
    const again = await load({ source: 'fred', id: 'unrate' });
    expect(first).toMatchObject({ id: 'UNRATE', title: 'Unemployment Rate', unit: 'Percent' });
    expect(again).toEqual(first);
    expect(fetchImpl.calls.filter((url) => url.includes('fredgraph'))).toHaveLength(1);
  });

  it('remembers a series that does not exist, and forgets a failed fetch', async () => {
    const cache = memoryCache();
    const missing = fakeFetch({});
    const load = seriesLoader({ cache, fetchImpl: missing });
    expect(await load({ source: 'fred', id: 'NOTASERIES' })).toBeNull();
    expect(await load({ source: 'fred', id: 'NOTASERIES' })).toBeNull();
    expect(missing.calls).toHaveLength(1);

    const down = fakeFetch({ 'https://fred.stlouisfed.org': { status: 503, body: '' } });
    const loadDown = seriesLoader({ cache, fetchImpl: down });
    expect(await loadDown({ source: 'fred', id: 'GDPC1' })).toBeNull();
    expect(cache.rows.size).toBe(1);
  });
});

describe('the chart kind (plan #2321.3)', () => {
  const series = (place: string, values: number[], id = 'SP.DYN.LE00.IN'): Series => ({
    source: 'worldbank',
    id,
    place,
    title: 'Life expectancy at birth, total (years)',
    unit: null,
    placeName: place === 'GBR' ? 'United Kingdom' : 'India',
    url: `https://data.worldbank.org/indicator/${id}?locations=${place}`,
    points: values.map((value, index) => ({ year: 2000 + index, value })),
  });

  it('needs a place for the sources that have them, and keeps the writer to real ids only by name', () => {
    expect(readWrittenFigures([block({ series: [{ source: 'worldbank', id: 'SP.DYN.LE00.IN' }] })])).toEqual([]);
    expect(readWrittenFigures([block({ series: [{ source: 'fred', id: 'UNRATE' }], points: [1, 2] })])[0].spec).toEqual({
      style: 'line',
      series: [{ source: 'fred', id: 'UNRATE' }],
    });
    expect(chartKind.writerLine).toContain('never written by you');
  });

  it('cuts its series to the years asked for and names them by place when they are one measure', () => {
    const data = chartData([series('GBR', [77, 78, 79, 80]), series('IND', [62, 63, 64, 65])], { from: 2001, to: 2002 });
    expect(data?.lines.map((line) => line.label)).toEqual(['United Kingdom', 'India']);
    expect(data?.lines[0].points).toHaveLength(2);
    expect(data && plotGroups(data)).toHaveLength(1);
    expect(chartData([series('GBR', [77, 78])], { from: 1950, to: 1960 })).toBeNull();
  });

  it('draws two measures as two plots, never on two axes', () => {
    const data = chartData([series('GBR', [77, 78]), { ...series('GBR', [1, 2], 'NY.GDP.PCAP.CD'), title: 'GDP per capita (current US$)' }], {});
    expect(data && plotGroups(data)).toHaveLength(2);
  });

  it('resolves through the context and draws its source and years in the foot', async () => {
    const [resolved] = await resolveFigures([{ kind: 'chart', ...chartKind.example, resolved: undefined }], {
      series: async (ref) => series(ref.place ?? '', [70, 71, 72]),
    });
    expect(resolved.resolved).toMatchObject({ from: 2000, to: 2002 });
    const html = renderToStaticMarkup(<Figure figure={resolved} />);
    expect(html).toContain('World Bank (CC BY 4.0)');
    expect(html).toContain('2000 to 2002');
    expect(html).not.toContain('was not found');
  });

  it('degrades to its caption when a series cannot be found, without dropping the figure', async () => {
    const [resolved] = await resolveFigures([block({ series: [{ source: 'fred', id: 'NOTASERIES' }] })], {
      series: async () => null,
    });
    expect(resolved.resolved).toBeNull();
    const html = renderToStaticMarkup(<Figure figure={resolved} />);
    expect(html).toContain('Unemployment in the US since 2000.');
    expect(html).toContain('The data for this figure was not found.');
    expect(html).not.toContain('Source:');
  });

  it('formats its axis numbers compactly', () => {
    expect([compactNumber(81.39), compactNumber(1234), compactNumber(45_600), compactNumber(12_345_678)]).toEqual([
      '81.4',
      '1,234',
      '45.6k',
      '12.3m',
    ]);
  });
});
