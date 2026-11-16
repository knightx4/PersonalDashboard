/**
 * Open courses the person can ask Dash to build a digest of, from the Courses
 * tab. Each is a full lecture series published free by its university or
 * author. A row carries no video address unless one was read from the
 * publisher's own playlist: the build's first stage finds the playlist and
 * lists its videos (.claude/skills/learn-courses/SKILL.md), so nothing here
 * is a link typed from memory.
 */

export type CatalogueCourse = {
  key: string;
  title: string;
  provider: string;
  /** What the series is, in one line. */
  about: string;
  area: CatalogueArea;
  /** The playlist, when it was read from the publisher. */
  sourceUrl?: string;
};

export const CATALOGUE_AREAS = [
  'AI',
  'Economics and finance',
  'Cities',
  'Ideas',
  'Building things',
  'Music',
] as const;
export type CatalogueArea = (typeof CATALOGUE_AREAS)[number];

export const COURSE_CATALOGUE: readonly CatalogueCourse[] = [
  {
    key: 'karpathy-zero-to-hero',
    title: 'Neural Networks: Zero to Hero',
    provider: 'Andrej Karpathy',
    about:
      'Karpathy codes everything live, from backpropagation on a single number to reproducing GPT-2.',
    area: 'AI',
    sourceUrl: 'https://www.youtube.com/playlist?list=PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ',
  },
  {
    key: 'berkeley-agentic-ai-f25',
    title: 'Berkeley Agentic AI MOOC (Fall 2025)',
    provider: 'UC Berkeley CS294-196',
    about:
      'Guest lectures from frontier labs and agent startups on planning, tool use, evaluation and safety.',
    area: 'AI',
    sourceUrl: 'https://www.youtube.com/playlist?list=PLS01nW3RtgoqGkm4UeqNeZLccW-OGc1fJ',
  },
  {
    key: 'stanford-cs336',
    title: 'CS336: Language Modeling from Scratch',
    provider: 'Stanford',
    about:
      'Builds a language model end to end: tokenizer, transformer, training, data and evaluation.',
    area: 'AI',
  },
  {
    key: 'stanford-cs229',
    title: 'CS229: Machine Learning',
    provider: 'Stanford',
    about:
      "Andrew Ng's graduate machine learning course: regression, classification, kernels, learning theory.",
    area: 'AI',
  },
  {
    key: 'mit-6s191',
    title: '6.S191: Introduction to Deep Learning',
    provider: 'MIT',
    about: 'A fast tour of deep learning, updated each year, with guest lectures from industry.',
    area: 'AI',
  },
  {
    key: 'stanford-cs25',
    title: 'CS25: Transformers United',
    provider: 'Stanford',
    about: 'A seminar where the people who built transformer systems explain them.',
    area: 'AI',
  },
  {
    key: 'mit-18s096-2013',
    title: 'MIT Quantitative Finance, Condensed',
    provider: 'MIT OpenCourseWare',
    about:
      '18.S096 Topics in Mathematics with Applications in Finance (Fall 2013), plus four 2024 18.642 guest lectures.',
    area: 'Economics and finance',
  },
  {
    key: 'mit-15401',
    title: '15.401: Finance Theory I',
    provider: 'MIT OpenCourseWare',
    about:
      "Andrew Lo's introduction to finance, taught through the autumn of 2008 as the crisis unfolded.",
    area: 'Economics and finance',
  },
  {
    key: 'yale-econ252',
    title: 'ECON 252: Financial Markets',
    provider: 'Open Yale Courses',
    about:
      'Robert Shiller on how financial institutions work and why, with guests from the industry.',
    area: 'Economics and finance',
  },
  {
    key: 'mit-1401',
    title: '14.01: Principles of Microeconomics',
    provider: 'MIT OpenCourseWare',
    about: "Jonathan Gruber's first course in economics: supply and demand, firms, market failure.",
    area: 'Economics and finance',
  },
  {
    key: 'yale-econ159',
    title: 'ECON 159: Game Theory',
    provider: 'Open Yale Courses',
    about: 'Ben Polak teaches strategy through games played in the room.',
    area: 'Economics and finance',
  },
  {
    key: 'mit-1473',
    title: '14.73: The Challenge of World Poverty',
    provider: 'MIT OpenCourseWare',
    about: 'Banerjee and Duflo on what the evidence says about the lives and choices of the poor.',
    area: 'Economics and finance',
  },
  {
    key: 'mit-4241j',
    title: '4.241J: Theory of City Form',
    provider: 'MIT OpenCourseWare',
    about:
      'Julian Beinart on how cities have taken their shape, from ancient plans to the modern metropolis.',
    area: 'Cities',
  },
  {
    key: 'harvard-justice',
    title: "Justice: What's the Right Thing to Do?",
    provider: 'Harvard',
    about: "Michael Sandel's course on moral reasoning, argued case by case with the audience.",
    area: 'Ideas',
  },
  {
    key: 'yale-plsc114',
    title: 'PLSC 114: Introduction to Political Philosophy',
    provider: 'Open Yale Courses',
    about:
      'Steven Smith reads Plato, Aristotle, Machiavelli, Hobbes, Locke, Rousseau and Tocqueville.',
    area: 'Ideas',
  },
  {
    key: 'stanford-sapolsky',
    title: 'Human Behavioral Biology',
    provider: 'Stanford',
    about: 'Robert Sapolsky on why people behave as they do, from genes and hormones to culture.',
    area: 'Ideas',
  },
  {
    key: 'yale-phil176',
    title: 'PHIL 176: Death',
    provider: 'Open Yale Courses',
    about: 'Shelly Kagan on personal identity, the badness of death and how to live given it.',
    area: 'Ideas',
  },
  {
    key: 'stanford-startup',
    title: 'How to Start a Startup',
    provider: 'Stanford CS183B',
    about:
      "Sam Altman's 2014 series: twenty lectures from founders and investors on building a company.",
    area: 'Building things',
  },
  {
    key: 'yale-musi112',
    title: 'MUSI 112: Listening to Music',
    provider: 'Open Yale Courses',
    about: 'Craig Wright on how Western music is put together and how to hear it.',
    area: 'Music',
  },
];

export function catalogueCourse(key: string): CatalogueCourse | null {
  return COURSE_CATALOGUE.find((course) => course.key === key) ?? null;
}
