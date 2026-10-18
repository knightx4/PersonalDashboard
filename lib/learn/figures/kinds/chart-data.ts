import { dataSource, type DataSourceId, type Series, type SeriesPoint } from '../sources';

/**
 * What a chart figure draws once its series are fetched (plan #2321.3), and
 * the pure reads the plot and the foot share. Kept apart from the plot so
 * the server can build it without loading recharts.
 */

export type ChartStyle = 'line' | 'bar';

/** One fetched series, cut to the chart's years and named for its legend. */
export type ChartLine = {
  /** The legend's name: the place when both lines are one measure, else the measure. */
  label: string;
  /** The measure the source names, with its unit. */
  measure: string;
  source: DataSourceId;
  url: string;
  points: SeriesPoint[];
};

export type ChartData = { lines: ChartLine[]; from: number; to: number };

/** The years a chart shows when the block names none: the last thirty the series have. */
export const DEFAULT_YEARS = 30;

function measureOf(series: Series): string {
  return series.unit && !series.title.toLowerCase().includes(series.unit.toLowerCase())
    ? `${series.title} (${series.unit})`
    : series.title;
}

/**
 * Cuts the fetched series to the years asked for and names them. Null when a
 * series has nothing in those years, which the page draws as not found.
 */
export function chartData(series: readonly Series[], years: { from?: number; to?: number }): ChartData | null {
  if (series.length === 0) return null;
  const latest = Math.max(...series.map((one) => one.points[one.points.length - 1]?.year ?? -Infinity));
  const to = years.to ?? latest;
  const from = years.from ?? to - DEFAULT_YEARS + 1;
  const samePlaceAcross = series.length > 1 && series.every((one) => one.id === series[0].id && one.source === series[0].source);
  const lines: ChartLine[] = [];
  for (const one of series) {
    const points = one.points.filter((point) => point.year >= from && point.year <= to);
    if (points.length < 2) return null;
    const measure = measureOf(one);
    lines.push({
      label: samePlaceAcross ? (one.placeName ?? one.place) : one.placeName && series.length > 1 ? `${measure}, ${one.placeName}` : measure,
      measure,
      source: one.source,
      url: one.url,
      points,
    });
  }
  return {
    lines,
    from: Math.min(...lines.map((line) => line.points[0].year)),
    to: Math.max(...lines.map((line) => line.points[line.points.length - 1].year)),
  };
}

/**
 * The plots a chart draws: one when its lines are one measure (or there is
 * one line), one each when they are two measures, since two scales on one
 * plot is a reading nobody can trust.
 */
export function plotGroups(data: ChartData): ChartLine[][] {
  const [first, ...rest] = data.lines;
  if (!first) return [];
  return rest.every((line) => line.measure === first.measure) ? [data.lines] : data.lines.map((line) => [line]);
}

/** The rows recharts draws: one per year, each line's value under `s<index>`. */
export function plotRows(lines: readonly ChartLine[]): Record<string, number>[] {
  const years = [...new Set(lines.flatMap((line) => line.points.map((point) => point.year)))].sort((a, b) => a - b);
  return years.map((year) => {
    const row: Record<string, number> = { year };
    lines.forEach((line, index) => {
      const point = line.points.find((each) => each.year === year);
      if (point) row[`s${index}`] = point.value;
    });
    return row;
  });
}

/** 1234 as 1,234; 12,345,678 as 12.3m; small values to three significant figures. */
export function compactNumber(value: number): string {
  const size = Math.abs(value);
  if (size >= 1e12) return `${Number((value / 1e12).toPrecision(3))}tn`;
  if (size >= 1e9) return `${Number((value / 1e9).toPrecision(3))}bn`;
  if (size >= 1e6) return `${Number((value / 1e6).toPrecision(3))}m`;
  if (size >= 1e4) return `${Number((value / 1e3).toPrecision(3))}k`;
  if (size >= 100) return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return String(Number(value.toPrecision(3)));
}

/** The foot's sources, each once, with its licence: "World Bank (CC BY 4.0)". */
export function sourceNames(data: ChartData): { name: string; url: string }[] {
  const seen = new Map<DataSourceId, { name: string; url: string }>();
  for (const line of data.lines) {
    if (seen.has(line.source)) continue;
    const source = dataSource(line.source);
    seen.set(line.source, { name: source.licence ? `${source.label} (${source.licence})` : source.label, url: line.url });
  }
  return [...seen.values()];
}

/** The years in the foot: "1990 to 2023". */
export function yearRange(data: ChartData): string {
  return data.from === data.to ? String(data.from) : `${data.from} to ${data.to}`;
}

/** One sentence a screen reader hears for the plot. */
export function chartSummary(data: ChartData): string {
  return data.lines
    .map((line) => {
      const first = line.points[0];
      const last = line.points[line.points.length - 1];
      return `${line.label}: ${compactNumber(first.value)} in ${first.year}, ${compactNumber(last.value)} in ${last.year}.`;
    })
    .join(' ');
}
