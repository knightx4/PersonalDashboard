import {
  Activity,
  BarChart3,
  BookOpen,
  BookOpenCheck,
  Bookmark,
  Boxes,
  Briefcase,
  Bug,
  Building2,
  FileText,
  Flag,
  GalleryHorizontalEnd,
  Gauge,
  Globe,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Compass,
  ClipboardCheck,
  Frame,
  GraduationCap,
  History,
  Hourglass,
  House,
  KanbanSquare,
  LayoutDashboard,
  Lightbulb,
  List,
  ListTodo,
  Mail,
  Megaphone,
  Map,
  Network,
  MessageCircleQuestion,
  MessageSquareText,
  MonitorPlay,
  Receipt,
  Repeat,
  Share2,
  Shapes,
  StickyNote,
  Tag,
  Target,
  Telescope,
  Undo2,
  Users,
  Waypoints,
} from 'lucide-react';
import { OwlIcon } from '@/components/shell/owl-icon';

/**
 * The sidebar's icons, named rather than passed.
 *
 * The layouts that build the section lists are server components and the shell
 * that renders them is a client one, and a component is not something that
 * crosses that boundary -- `icon: Briefcase` is a function, and functions
 * cannot be props to a client component. A name can, so the layouts name the
 * icon and this table is where the name becomes a glyph.
 *
 * It also keeps the whole set in one screen, which is the only way five
 * workspaces' navigation ends up looking like one product: the icons have to
 * be chosen against each other, not one at a time next to the label they
 * happen to sit beside.
 */
export const NAV_ICONS = {
  // Shopping
  dashboard: LayoutDashboard,
  orders: Receipt,
  inventory: Boxes,
  sell: Tag,
  returns: Undo2,
  // What you pay for again and again: subscriptions and bills (plan #1126).
  recurring: Repeat,
  saved: Bookmark,
  share: Share2,
  // Jobs
  // The Jobs front page: a house, for the page you come in by.
  jobsHome: House,
  week: CalendarRange,
  pipeline: KanbanSquare,
  roles: Briefcase,
  companies: Building2,
  contacts: Users,
  interviews: CalendarClock,
  answers: MessageSquareText,
  analytics: BarChart3,
  activity: Activity,
  // Career goals: which way you are heading, so the compass. Not Target,
  // which is Learn's Goals tab, and not Flag, which is the Goals workspace.
  careerGoals: Compass,
  // Dev
  bugs: Bug,
  raised: MessageCircleQuestion,
  ideas: Lightbulb,
  // Looking outward for ideas, as Ideas is the ones you had yourself.
  inspiration: Telescope,
  plan: Map,
  changelog: History,
  // Drafts for X about building the app (plan #1419): saying it out loud.
  posts: Megaphone,
  ui: Shapes,
  surfaces: Frame,
  // Which pages are opened and what each workspace spends (plan #1482).
  usage: Gauge,
  // A project Dev builds outside this app (lib/plan/projects): a site.
  project: Globe,
  // A specification is a document you read and argue with, so it gets the
  // document glyph rather than another list icon.
  specs: FileText,
  // Todo and vault
  //
  // Agenda is the list with something still unticked -- what needs you next,
  // which is exactly what an unticked box says. All is a plain list with no
  // boxes at all: it is everything there is, finished included, so ticks would
  // be claiming something about it. The two were ListChecks and ListTodo, near
  // enough that the only way to tell the rows apart was to read the labels.
  agenda: ListTodo,
  // What someone else has to move first (plan #1475): time passing until
  // they do.
  waiting: Hourglass,
  calendar: CalendarDays,
  tasks: List,
  notes: StickyNote,
  // The vault's map: subjects joined to the positions and notes under them.
  // Not Map, which is the plan's, and not Network, which is Learn's knowledge
  // graph -- the map claims nothing about what you know.
  vaultMap: Waypoints,
  // Maya, the vault's thought partner (plan #1286). An owl, drawn in
  // owl-icon.tsx because lucide has none, and never Bot, which is Dash.
  maya: OwlIcon,
  // Education: your transcripts and the courses on them (plan #1308).
  education: GraduationCap,

  // Learn
  tracks: BookOpen,
  // Now: the feed, what is waiting, and the practice questions (plan #1486).
  readNow: BookOpenCheck,
  know: Network,
  // Goals: the things you want to learn and how well (plan #897).
  goals: Target,
  // Videos: your list, its clips and the YouTube library on one page (plan
  // #1488). A screen with a play mark, not the YouTube logo, because a brand
  // mark in the nav would be the only one.
  videos: MonitorPlay,
  // News. An envelope, the same object the workspace's own mark draws, because
  // the tab and the mark name the same thing and picking a second object for
  // it would say there are two.
  newsletters: Mail,
  // Quick read deals the stories out one card at a time, so it gets the
  // stack of cards.
  quickRead: GalleryHorizontalEnd,
  // Goals. A flag, the same object the workspace's own mark draws, as News
  // does with its envelope. Not Target, which is Learn's Goals tab.
  goalsHome: Flag,
  // Every area and goal, for adding and arranging them; the home is the short
  // daily list, so this is the long one.
  goalsAll: List,
  // Every run Claude made on your goals, newest first: a record of what was
  // done, so the same clock-and-arrow the changelog uses.
  goalsRuns: History,
  // Files Claude wrote for your goals: a page of writing, so a page.
  goalsFiles: FileText,
  // Shared: both workspaces have one, and they do the same job.
  review: ClipboardCheck,
} as const;

export type NavIconName = keyof typeof NAV_ICONS;
