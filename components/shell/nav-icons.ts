import {
  Activity,
  BarChart3,
  Bookmark,
  Boxes,
  Briefcase,
  Bug,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  KanbanSquare,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  ListTodo,
  MessageSquareText,
  Receipt,
  Share2,
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
  ideas: Lightbulb,
  // Todo and vault
  agenda: ListChecks,
  calendar: CalendarDays,
  tasks: ListTodo,
  notes: StickyNote,
  // Shared: both workspaces have one, and they do the same job.
  review: ClipboardCheck,
} as const;

export type NavIconName = keyof typeof NAV_ICONS;
