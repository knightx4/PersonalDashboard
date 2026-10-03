/**
 * Jobs, Todo and Shopping rows say whose move they are with the shared label
 * (plan #1454): the role page, a pipeline card, a todo row and a row on the
 * returns list. The rules themselves are tested beside each moveOf; this
 * checks the surfaces draw them with MoveLabel's words and colours, and that
 * each reads "Dash is on it" while an Ask Dash hand-off about it is open
 * (plan #1568).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/app/jobs/(app)/pipeline/actions', () => ({
  dismissPursuit: vi.fn(),
  moveApplication: vi.fn(),
  rejectApplication: vi.fn(),
}));
vi.mock('@/app/shopping/returns/actions', () => ({
  markItemReturned: vi.fn(),
  setReturnPlanned: vi.fn(),
  undoItemReturned: vi.fn(),
}));
vi.mock('@/app/todo/actions', () => ({
  addItem: vi.fn(),
  bringBackTask: vi.fn(),
  completeTask: vi.fn(),
  dropTask: vi.fn(),
  laterTask: vi.fn(),
  moveTask: vi.fn(),
  pinTask: vi.fn(),
  placeTask: vi.fn(),
  removeTask: vi.fn(),
  renameTaskAction: vi.fn(),
  reopenTask: vi.fn(),
  rescheduleTaskAction: vi.fn(),
  unpointTask: vi.fn(),
}));
vi.mock('@/components/todo/hand-to-dash', () => ({ HandToDash: () => null }));
vi.mock('@/components/todo/task-about', () => ({ TaskAbout: () => null }));
vi.mock('@/components/todo/task-form', () => ({ EditTask: () => null }));

import { PipelineBoard } from '@/components/jobs/pipeline/board';
import { ReturnItemRow } from '@/app/shopping/returns/return-item-row';
import { TaskRow } from '@/components/todo/task-row';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import type { ReturnsTrackerRow } from '@/lib/returns/types';
import type { Task } from '@/lib/todo/tasks/model';

const pursuit = (over: Partial<PipelineRow>): PipelineRow => ({
  applicationId: 'a1',
  roleId: 'r1',
  companyId: 'c1',
  companyName: 'EliseAI',
  companySlug: 'eliseai',
  companyLogoUrl: null,
  companyDomains: [],
  companyWebsite: null,
  roleTitle: 'Backend Engineer',
  location: null,
  workMode: null,
  status: 'acknowledged',
  source: 'portal',
  attempt: 1,
  excitement: null,
  needsReview: false,
  createdBy: 'user',
  submittedAt: '2026-09-01T00:00:00Z',
  confirmationReceivedAt: null,
  firstHumanResponseAt: null,
  closedAt: null,
  outcome: null,
  rejectionStage: null,
  nextAction: null,
  nextActionDue: null,
  lastActivityAt: '2026-09-01T00:00:00Z',
  daysSinceActivity: 2,
  lastTurnEvent: 'confirmation',
  compMinCents: null,
  compMaxCents: null,
  coverage: { covered: 0, total: 0, gaps: 0, rate: null },
  ...over,
});

const item = (over: Partial<ReturnsTrackerRow>): ReturnsTrackerRow => ({
  inventoryItemId: 'i1',
  name: 'Trainers',
  variant: null,
  costCents: 5000,
  orderId: 'o1',
  orderDate: '2026-09-20',
  externalOrderNumber: null,
  orderStatus: 'delivered',
  merchantId: 'm1',
  merchantName: 'Sephora',
  returnDeadline: '2026-10-20',
  daysLeft: 17,
  returnPlanned: false,
  returnWindowDays: 30,
  delivered: true,
  carrier: null,
  status: 'owned',
  returnId: null,
  refundedAt: null,
  ...over,
});

const task: Task = {
  id: 't1',
  title: 'Ring the dentist',
  body: null,
  status: 'open',
  dueOn: null,
  dueAt: null,
  pinned: false,
  snoozedUntil: null,
  completedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  position: null,
  parentId: null,
};

describe('moves on Jobs, Todo and Shopping rows', () => {
  it('says a sent application waits on the company, on its pipeline card', () => {
    const html = renderToStaticMarkup(<PipelineBoard rows={[pursuit({})]} view="board" />);
    expect(html).toContain('Waiting on EliseAI');
    expect(html).toContain('text-caution');
  });

  it('puts an open todo on you', () => {
    const html = renderToStaticMarkup(
      <TaskRow task={task} timezone="UTC" />,
    );
    expect(html).toContain('On you');
  });

  it('puts a return inside its window on you, and a parcel on its carrier', () => {
    expect(renderToStaticMarkup(<ReturnItemRow row={item({})} />)).toContain('On you');
    expect(
      renderToStaticMarkup(
        <ReturnItemRow
          row={item({
            delivered: false,
            orderStatus: 'shipped',
            carrier: 'UPS',
            returnDeadline: null,
            daysLeft: null,
          })}
        />,
      ),
    ).toContain('Waiting on UPS');
  });

  // An open Ask Dash hand-off about the row (plan #1568), stubbed as the refs
  // the page would read from core.dash_handoffs.
  describe('while an Ask Dash hand-off about the row is open', () => {
    it('says Dash is on it on the pipeline card, by its application or its role', () => {
      for (const working of [['job_search.applications:a1'], ['job_search.roles:r1']]) {
        const html = renderToStaticMarkup(<PipelineBoard rows={[pursuit({})]} view="board" working={working} />);
        expect(html).toContain('Dash is on it');
        expect(html).not.toContain('Waiting on EliseAI');
      }
      const other = renderToStaticMarkup(
        <PipelineBoard rows={[pursuit({})]} view="board" working={['job_search.applications:a2']} />,
      );
      expect(other).toContain('Waiting on EliseAI');
    });

    it('says Dash is on it on the todo row', () => {
      const html = renderToStaticMarkup(<TaskRow task={task} timezone="UTC" working={['todo.tasks:t1']} />);
      expect(html).toContain('Dash is on it');
      expect(html).not.toContain('On you');
    });

    it('says Dash is on it on a return, by its item or its order', () => {
      for (const working of [['public.inventory_items:i1'], ['public.orders:o1']]) {
        const html = renderToStaticMarkup(<ReturnItemRow row={item({})} working={working} />);
        expect(html).toContain('Dash is on it');
        expect(html).not.toContain('On you');
      }
    });

    it('leaves a row with no move without one', () => {
      const html = renderToStaticMarkup(
        <ReturnItemRow
          row={item({ status: 'returned', returnId: 'x', daysLeft: null })}
          working={['public.inventory_items:i1']}
        />,
      );
      expect(html).not.toContain('Dash is on it');
    });
  });

  it('shows no move on a returned item', () => {
    const html = renderToStaticMarkup(
      <ReturnItemRow row={item({ status: 'returned', returnId: 'x', daysLeft: null })} />,
    );
    expect(html).not.toContain('On you');
    expect(html).not.toContain('Waiting');
  });
});
