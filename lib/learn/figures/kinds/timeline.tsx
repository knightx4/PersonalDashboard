import { z } from 'zod';
import type { FigureKind } from '../types';
import { DiagramSvg, LINE, Lines, PHONE_WIDTH, PhoneAndWide, WIDE_WIDTH, LARGE_WIDTH, charsIn, label, wrap } from './diagram';

/**
 * A timeline: dated events on a line, in order, for a sequence in time or an
 * era (plan #2321.2). The events are spaced evenly in the order given, since
 * a date is the writer's words ("1950s", "Spring 1871") and not always a
 * number. Wide, the line runs across with the events above and below it in
 * turn; on a phone it runs down, dates on the left of each event.
 */

const MAX_EVENTS = 7;
const MAX_DATE_CHARS = 14;
const MAX_EVENT_CHARS = 60;

const timelineSpec = z.object({
  events: z
    .array(z.object({ date: label(MAX_DATE_CHARS), label: label(MAX_EVENT_CHARS) }))
    .min(2)
    .max(MAX_EVENTS),
});

export type TimelineSpec = z.infer<typeof timelineSpec>;

const DOT = 4;

function WideTimeline({ spec, width }: { spec: TimelineSpec; width: number }) {
  const n = spec.events.length;
  const spacing = (width - 2 * (DOT + 1)) / (n - 1);
  // Neighbours sit on opposite sides, so each label has two spaces of room.
  const labelW = Math.min(220, 2 * spacing - 12);
  const perLine = charsIn(labelW);
  const texts = spec.events.map((event) => wrap(event.label, perLine, 3));
  const blockH = (index: number) => (1 + texts[index].length) * LINE;
  const above = Math.max(...spec.events.map((_, i) => (i % 2 === 0 ? blockH(i) : 0)));
  const belowH = Math.max(0, ...spec.events.map((_, i) => (i % 2 === 1 ? blockH(i) : 0)));
  const stem = 10;
  const lineY = above + stem + 2;
  const height = lineY + stem + belowH + 2;
  // A label never runs off the drawing: the first and last align to the ends.
  const align = (index: number) => (index === 0 ? 'start' : index === n - 1 ? 'end' : 'middle') as 'start' | 'end' | 'middle';
  const xOf = (index: number) => DOT + 1 + index * spacing;
  return (
    <DiagramSvg width={width} height={height} title={spec.events.map((e) => `${e.date}: ${e.label}`).join('; ')}>
      <line x1={DOT + 1} y1={lineY} x2={width - DOT - 1} y2={lineY} className="stroke-border-strong" strokeWidth={2} />
      {spec.events.map((event, index) => {
        const x = xOf(index);
        const up = index % 2 === 0;
        const lines = [event.date, ...texts[index]];
        const top = up ? lineY - stem - lines.length * LINE : lineY + stem;
        const tx = align(index) === 'start' ? x - DOT : align(index) === 'end' ? x + DOT : x;
        return (
          <g key={index}>
            <line x1={x} y1={up ? lineY - stem : lineY} x2={x} y2={up ? lineY : lineY + stem} className="stroke-border-strong" strokeWidth={1} />
            <circle cx={x} cy={lineY} r={DOT} className="fill-accent" />
            <Lines lines={[event.date]} x={tx} y={top + LINE / 2} align={align(index)} className="fill-ink font-semibold" />
            <Lines lines={texts[index]} x={tx} y={top + LINE + (texts[index].length * LINE) / 2} align={align(index)} className="fill-ink" />
          </g>
        );
      })}
    </DiagramSvg>
  );
}

function PhoneTimeline({ spec }: { spec: TimelineSpec }) {
  const lineX = DOT + 1;
  const dateX = lineX + DOT + 10;
  const dateW = Math.max(...spec.events.map((e) => e.date.length)) * 7.6 + 10;
  const textX = dateX + Math.min(dateW, 110);
  const perLine = charsIn(PHONE_WIDTH - textX - 1);
  const rows = spec.events.map((event) => {
    const lines = wrap(event.label, perLine, 4);
    const dateLines = wrap(event.date, charsIn(textX - dateX - 6), 2);
    return { event, lines, dateLines, h: Math.max(lines.length, dateLines.length) * LINE };
  });
  const gap = 14;
  const height = rows.reduce((sum, row) => sum + row.h, 0) + gap * (rows.length - 1) + 2;
  const tops = rows.map((_, index) => 1 + rows.slice(0, index).reduce((sum, row) => sum + row.h + gap, 0));
  return (
    <DiagramSvg width={PHONE_WIDTH} height={height} title={spec.events.map((e) => `${e.date}: ${e.label}`).join('; ')}>
      <line x1={lineX} y1={1 + LINE / 2} x2={lineX} y2={height - 1 - LINE / 2} className="stroke-border-strong" strokeWidth={2} />
      {rows.map((row, index) => {
        const top = tops[index];
        return (
          <g key={index}>
            <circle cx={lineX} cy={top + LINE / 2} r={DOT} className="fill-accent" />
            <Lines lines={row.dateLines} x={dateX} y={top + (row.dateLines.length * LINE) / 2} align="start" className="fill-ink font-semibold" />
            <Lines lines={row.lines} x={textX} y={top + (row.lines.length * LINE) / 2} align="start" className="fill-ink" />
          </g>
        );
      })}
    </DiagramSvg>
  );
}

export const timelineKind: FigureKind<TimelineSpec> = {
  id: 'timeline',
  label: 'Timeline',
  schema: timelineSpec,
  writerLine: `timeline: dated events in order on a line, for a sequence in time or an era: how a city grew or declined, the steps of a reform, a period told through its turning points. Drawn evenly spaced in the order given. spec is {"events": [2 to ${MAX_EVENTS} of {"date": a year or short date in at most ${MAX_DATE_CHARS} characters, "label": what happened in at most ${MAX_EVENT_CHARS} characters}]}, earliest first. Only dates you are sure of.`,
  example: {
    caption: 'How Americans moved from cities to suburbs over the twentieth century.',
    spec: {
      events: [
        { date: '1908', label: 'The Model T puts a car within reach of many' },
        { date: '1934', label: 'Federal insurance makes mortgages cheaper' },
        { date: '1947', label: 'Building starts on Levittown, New York' },
        { date: '1956', label: 'The Interstate highways are funded' },
        { date: '1970', label: 'More Americans live in suburbs than cities' },
      ],
    },
  },
  Render: ({ spec }) => <PhoneAndWide phone={<PhoneTimeline spec={spec} />} wide={<WideTimeline spec={spec} width={WIDE_WIDTH} />} large={<WideTimeline spec={spec} width={LARGE_WIDTH} />} />,
  data: 'none',
};
