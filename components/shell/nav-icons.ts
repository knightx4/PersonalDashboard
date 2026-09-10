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
  Map,
  Network,
  MessageCircleQuestion,
  MessageSquareText,
  Receipt,
  Share2,
  Shapes,
  StickyNote,
  Tag,
  Undo2,
  Users,
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

  // Learn
  tracks: BookOpen,
  readNow: BookOpenCheck,
  know: Network,
  // Shared: both workspaces have one, and they do the same job.
  review: ClipboardCheck,
} as const;

export type NavIconName = keyof typeof NAV_ICONS;
