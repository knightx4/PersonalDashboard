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
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  Frame,
  History,
  KanbanSquare,
  LayoutDashboard,
  Lightbulb,
  List,
  ListTodo,
  Mail,
  Map,
  Network,
  PencilLine,
  MessageCircleQuestion,
  MessageSquareText,
  MonitorPlay,
  Receipt,
  Share2,
  Shapes,
  StickyNote,
  Tag,
  Target,
  Timer,
  Undo2,
  Users,
  Waypoints,
} from 'lucide-react';

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
  saved: Bookmark,
  share: Share2,
  // Jobs
  week: CalendarRange,
  pipeline: KanbanSquare,
  roles: Briefcase,
  companies: Building2,
  contacts: Users,
  interviews: CalendarClock,
  answers: MessageSquareText,
  analytics: BarChart3,
  activity: Activity,
  // Dev
  bugs: Bug,
  raised: MessageCircleQuestion,
  ideas: Lightbulb,
  plan: Map,
  changelog: History,
  ui: Shapes,
  surfaces: Frame,
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
  calendar: CalendarDays,
  tasks: List,
  notes: StickyNote,
  // The vault's map: subjects joined to the positions and notes under them.
  // Not Map, which is the plan's, and not Network, which is Learn's knowledge
  // graph -- the map claims nothing about what you know.
  vaultMap: Waypoints,

  // Learn
  tracks: BookOpen,
  readNow: BookOpenCheck,
  know: Network,
  // Goals: the things you want to learn and how well (plan #897).
  goals: Target,
  // Practice Flow, and so Learn's front page. Still the clock it had as the
  // five-minute session: the question mark is already the dev workspace's
  // raised tab.
  practiceFlow: Timer,
  // A quiz is answered in writing, which is the whole of what separates it
  // from being asked to recognise something, so it gets the pencil.
  quiz: PencilLine,
  // The YouTube library: channels, playlists and the transcripts fetched for
  // them. A screen with a play mark, not the YouTube logo, because a brand
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
  // Shared: both workspaces have one, and they do the same job.
  review: ClipboardCheck,
} as const;

export type NavIconName = keyof typeof NAV_ICONS;
