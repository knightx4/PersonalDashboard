import type { ExplorableModel, ModelValues } from './types';
import { AgglomerationPlot } from './agglomeration-plot';
import {
  type AgglomerationValues,
  SIZE_MAX,
  bestSize,
  millions,
  outputAt,
  peak,
  thousands,
} from './agglomeration-curves';

/**
 * Agglomeration (plan #2321.8): output per worker against a city's size,
 * with sliders for the three gains of size (sharing, matching and learning)
 * and for congestion. The gains rise with size by less and less while
 * congestion grows steadily, so output per worker peaks at a size and falls
 * beyond it. For any lesson on why density pays, and why it stops paying.
 */

const GAIN = { min: 0, max: 4, step: 1, start: 3 } as const;

function strength(value: number): string {
  if (value === 0) return 'None';
  if (value <= 2) return 'Weak';
  if (value <= 4) return 'Moderate';
  return 'Strong';
}

function read(values: ModelValues): AgglomerationValues {
  return {
    sharing: values.sharing ?? 3,
    matching: values.matching ?? 3,
    learning: values.learning ?? 3,
    congestion: values.congestion ?? 4.5,
  };
}

function join(parts: string[]): string {
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function same(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.05;
}

/** Where output per worker peaks, as a phrase: "a city of 5 million". */
function peakWords(values: AgglomerationValues): string {
  const top = peak(values);
  if (top.past) return `a city of more than ${millions(SIZE_MAX)}`;
  if (top.size === 0) return 'the smallest town';
  return `a city of ${millions(top.size)}`;
}

const GAINS: Array<{ id: keyof AgglomerationValues; name: string }> = [
  { id: 'sharing', name: 'sharing' },
  { id: 'matching', name: 'matching' },
  { id: 'learning', name: 'learning' },
];

export const agglomerationModel: ExplorableModel = {
  id: 'agglomeration',
  field: 'Urban economics',
  label: 'Agglomeration',
  teaches:
    'output per worker against a city’s size: the gains of size (sharing suppliers and infrastructure, matching workers to jobs, learning from each other) rise with size by less and less, while congestion grows steadily, so output per worker peaks at a size and falls past it. Sliders move each gain and congestion. For why density pays, why it stops paying, and why a better transport network lets a city grow bigger before it does.',
  params: [
    { id: 'sharing', label: 'Sharing', ...GAIN, say: strength },
    { id: 'matching', label: 'Matching', ...GAIN, say: strength },
    { id: 'learning', label: 'Learning', ...GAIN, say: strength },
    {
      id: 'congestion',
      label: 'Congestion',
      min: 2,
      max: 6,
      step: 0.5,
      start: 4.5,
      say: (value) => `£${value.toFixed(1)}k a million`,
    },
  ],
  describe(values, from) {
    const now = read(values);
    const was = read(from);
    const said = [
      ...GAINS.filter(({ id }) => now[id] !== was[id]).map(
        ({ id, name }) => `${name} is ${now[id] > was[id] ? 'stronger' : 'weaker'}`,
      ),
      ...(now.congestion !== was.congestion
        ? [`congestion costs ${now.congestion > was.congestion ? 'more' : 'less'}`]
        : []),
    ];
    const top = peak(now);
    if (said.length === 0) {
      return `Output per worker peaks at ${thousands(top.output)} in ${peakWords(now)}. Below that size, each newcomer adds more through sharing, matching and learning than they cost in congestion; above it, they cost more than they add.`;
    }
    const before = peak(was);
    const size =
      same(top.size, before.size) && top.past === before.past
        ? `the best size stays at ${peakWords(now)}`
        : `the best size ${bestSize(now) > bestSize(was) ? 'grows' : 'shrinks'} from ${peakWords(was)} to ${peakWords(now)}`;
    const output = same(top.output, before.output)
      ? `output per worker there stays at ${thousands(top.output)}`
      : `output per worker there ${top.output > before.output ? 'rises' : 'falls'} from ${thousands(before.output)} to ${thousands(top.output)}`;
    return `Now ${join(said)}, so ${size} and ${output}.`;
  },
  readouts(values, from) {
    const now = peak(read(values));
    const was = peak(read(from));
    const size = (top: typeof now) =>
      top.past ? `Over ${millions(SIZE_MAX)}` : millions(top.size);
    return [
      {
        label: 'Best size',
        value: size(now),
        was: same(now.size, was.size) && now.past === was.past ? null : size(was),
      },
      {
        label: 'Output per worker there',
        value: thousands(now.output),
        was: same(now.output, was.output) ? null : thousands(was.output),
      },
    ];
  },
  table(values) {
    const now = read(values);
    const sizes = [0, 1, 2, 4, 6, 8, 10];
    return {
      head: ['City size', 'Output per worker'],
      rows: sizes.map((size) => [millions(size), thousands(outputAt(size, now))]),
    };
  },
  measures: [
    {
      id: 'best_size',
      label: 'the city size where output per worker peaks',
      at: (values) => bestSize(read(values)),
      words: { up: 'It grows', down: 'It shrinks', same: 'It stays the same' },
    },
    {
      id: 'peak_output',
      label: 'output per worker at the peak',
      at: (values) => peak(read(values)).output,
    },
  ],
  Plot: AgglomerationPlot,
  example: {
    caption:
      'A city builds a metro: turn congestion down and watch how big it can grow before crowding wins.',
    start: { sharing: 3, matching: 3, learning: 3, congestion: 4.5 },
    moved: { sharing: 3, matching: 3, learning: 3, congestion: 3 },
  },
};
