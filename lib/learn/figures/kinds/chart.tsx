import { z } from 'zod';
import type { FigureKind } from '../types';
import { DATA_SOURCES, DATA_SOURCE_IDS, dataSource } from '../sources';
import { ChartPlot } from './chart-plot';
import { predictDirectionForm } from '../questions/predict-direction';
import { chartData, chartSummary, plotGroups, plotRows, sourceNames, yearRange, compactNumber, type ChartData } from './chart-data';

/**
 * A chart of a real published series (plan #2321.3): a line or bar chart of
 * one or two series from a registered data source (`../sources.ts`), with
 * the source and the years in its foot. The block names the series; the
 * numbers are fetched by `resolve` on the server and never come from the
 * writer.
 */

const EARLIEST_YEAR = 1700;
const LATEST_YEAR = 2100;
const year = z.number().int().min(EARLIEST_YEAR).max(LATEST_YEAR);

const seriesRef = z
  .object({
    source: z.enum(DATA_SOURCE_IDS),
    id: z.string().trim().min(1).max(120),
    place: z.string().trim().min(2).max(12).nullish(),
  })
  .refine((ref) => !dataSource(ref.source).needsPlace || Boolean(ref.place), {
    message: 'This source needs a place.',
    path: ['place'],
  });

const chartSpec = z
  .object({
    style: z.enum(['line', 'bar']).default('line'),
    series: z.array(seriesRef).min(1).max(2),
    from: year.nullish(),
    to: year.nullish(),
  })
  .refine((spec) => spec.from == null || spec.to == null || spec.from < spec.to, {
    message: 'from comes before to.',
    path: ['from'],
  });

export type ChartSpec = z.infer<typeof chartSpec>;

const sourceLines = DATA_SOURCES.map((source) => source.writerLine).join(' ');

/** India's and the UK's life expectancy at birth from the World Bank, 1990 to 2023, as fetched on 18 October 2026. */
const UK = [75.9, 76.1, 76.4, 76.4, 76.9, 76.8, 77.1, 77.2, 77.2, 77.4, 77.7, 78, 78.1, 78.4, 78.7, 79, 79.2, 79.4, 79.6, 80.1, 80.4, 81, 80.9, 81, 81.3, 81, 81.2, 81.3, 81.3, 81.4, 80.3, 80.6, 81, 81.2];
const INDIA = [58.6, 59, 59.4, 59.8, 60.2, 60.6, 61, 61.4, 61.9, 62.3, 62.7, 63.2, 63.6, 64.1, 64.5, 64.9, 65.4, 65.8, 66.2, 66.7, 67.2, 67.6, 68.1, 68.5, 68.9, 69.3, 69.7, 70.1, 70.4, 70.7, 70.2, 67.3, 71.7, 72];
const MEASURE = 'Life expectancy at birth, total (years)';
const points = (values: number[]) => values.map((value, index) => ({ year: 1990 + index, value }));

export const chartKind: FigureKind<ChartSpec, ChartData> = {
  id: 'chart',
  label: 'Chart',
  schema: chartSpec,
  writerLine: `chart: a line or bar chart of a real published series, for an idea about how a quantity moved over the years or how two places compare on it. The numbers are fetched from the source, never written by you, so name only a series you are sure exists under that exact id. spec is {"style": "line" or "bar", "series": [1 or 2 of {"source": "fred", "worldbank" or "owid", "id": the series id, "place": a country code where the source needs one}], "from": first year, "to": last year}. The first series is drawn in the highlight colour, so put first the one the caption is about. Two series are either one measure in two places (one chart) or two measures (drawn as two charts, one above the other). Bar for a few years, line for many. The sources: ${sourceLines}`,
  example: {
    caption: 'Life expectancy at birth in India and the UK since 1990: India has closed much of the gap.',
    spec: {
      style: 'line',
      series: [
        { source: 'worldbank', id: 'SP.DYN.LE00.IN', place: 'IND' },
        { source: 'worldbank', id: 'SP.DYN.LE00.IN', place: 'GBR' },
      ],
      from: 1990,
      to: 2023,
    },
    resolved: {
      from: 1990,
      to: 2023,
      lines: [
        { label: 'India', measure: MEASURE, source: 'worldbank', url: 'https://data.worldbank.org/indicator/SP.DYN.LE00.IN?locations=IND', points: points(INDIA) },
        { label: 'United Kingdom', measure: MEASURE, source: 'worldbank', url: 'https://data.worldbank.org/indicator/SP.DYN.LE00.IN?locations=GBR', points: points(UK) },
      ],
    },
  },
  async resolve(spec, context) {
    const series = await Promise.all(spec.series.map((ref) => context.series(ref)));
    if (series.some((one) => one === null)) return null;
    return chartData(series as NonNullable<(typeof series)[number]>[], { from: spec.from ?? undefined, to: spec.to ?? undefined });
  },
  Render: ({ spec, resolved }) => <ChartFigure style={spec.style} data={resolved} />,
  questions: [predictDirectionForm<ChartSpec>()],
  data: 'series',
};

/** The plot or plots, the legend, a table for screen readers and the source line. */
function ChartFigure({ style, data }: { style: ChartSpec['style']; data: ChartData }) {
  const groups = plotGroups(data);
  const sources = sourceNames(data);
  return (
    <div>
      {groups.map((lines, index) => {
        const colourFrom = data.lines.indexOf(lines[0]);
        return (
          <div key={index} className={index > 0 ? 'mt-4' : undefined}>
            {(groups.length > 1 || lines.length > 1) && (
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small text-ink">
                {lines.map((line, at) => (
                  <li key={at} className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={`h-0.5 w-4 rounded-full ${(colourFrom + at) % 2 === 0 ? 'bg-accent' : 'bg-ink-muted'}`}
                    />
                    {line.label}
                  </li>
                ))}
              </ul>
            )}
            {lines.length === 1 && groups.length === 1 && <p className="text-small text-ink-muted">{lines[0].measure}</p>}
            {lines.length > 1 && <p className="mt-0.5 text-small text-ink-muted">{lines[0].measure}</p>}
            <div role="img" aria-label={chartSummary({ ...data, lines })} className="mt-2">
              <ChartPlot style={style} lines={lines} colourFrom={colourFrom} />
            </div>
            <table className="sr-only">
              <thead>
                <tr>
                  <th>Year</th>
                  {lines.map((line, at) => (
                    <th key={at}>{line.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plotRows(lines).map((row) => (
                  <tr key={row.year}>
                    <td>{row.year}</td>
                    {lines.map((_, at) => (
                      <td key={at}>{row[`s${at}`] === undefined ? '' : compactNumber(row[`s${at}`])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className="mt-2 text-small text-ink-muted">
        Source:{' '}
        {sources.map((source, index) => (
          <span key={source.name}>
            {index > 0 && '; '}
            <a href={source.url} target="_blank" rel="noreferrer" className="underline decoration-border-strong underline-offset-2 hover:text-ink">
              {source.name}
            </a>
          </span>
        ))}
        , {yearRange(data)}.
      </p>
    </div>
  );
}
