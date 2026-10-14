'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/shell/page-header';
import { AimedCaptureForm } from '@/components/shell/capture-aim';
import { PaidCostsProvider, PaidHint } from '@/components/ui/paid-hint';
import { popoverSurface } from '@/components/ui/popover';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { CAPTURE_KINDS } from '@/lib/capture/actions';
import { HAIKU } from '@/lib/core/models';
import type { PaidCosts } from '@/lib/core/spend/paid-actions';
import { InventoryAddActions, InventoryEmpty, OrdersAddActions, OrdersEmpty } from '@/app/shopping/list-adds';

/**
 * Shopping's Add buttons and the capture they aim (plan #1950.3.1): the
 * Orders and Inventory headers and empty lists with their Add buttons
 * (shopping-list-adds), and capture aimed at an order, an item and a link
 * (shell-capture-aimed-shopping), with the toast one press leaves.
 */

const nothing = () => {};

/** What reading a sentence as an order costs, as the ledger would price it. */
const COSTS: PaidCosts = {
  'app/capture-actions.ts#makeAimedCapture': {
    lowMicros: 600,
    medianMicros: 900,
    highMicros: 1_400,
    runs: 12,
    basis: 'measured',
    per: 'run',
    models: [HAIKU],
  },
};

function Aimed({ children }: { children: React.ReactNode }) {
  return <div className={cn(popoverSurface, 'w-full overflow-hidden shadow-2xl')}>{children}</div>;
}

/** The toast an order leaves, held open for the shot. */
function AddedToast() {
  const toast = useToast();
  useEffect(() => {
    toast({
      text: 'Added to Shopping · Orders.',
      undo: nothing,
      undone: 'Taken back.',
      duration: 600_000,
    });
  }, [toast]);
  return null;
}

export function ShoppingAimedSurface() {
  return (
    <ToastProvider>
      <div className="space-y-8 py-4">
        <Aimed>
          <AimedCaptureForm
            kind={CAPTURE_KINDS.order}
            text="Two packs of AA batteries and a stainless steel electric kettle from Target, $41.97 altogether, yesterday"
            onText={nothing}
            day=""
            onDay={nothing}
            pending={false}
            error={null}
            onSubmit={nothing}
            hint={
              <PaidCostsProvider costs={COSTS}>
                <PaidHint action="app/capture-actions.ts#makeAimedCapture" what="Cost of reading it" align="end" />
              </PaidCostsProvider>
            }
          />
        </Aimed>
        <Aimed>
          <AimedCaptureForm
            kind={CAPTURE_KINDS['inventory-item']}
            text="978-0-14-312779-6"
            onText={nothing}
            day=""
            onDay={nothing}
            pending
            error={null}
            onSubmit={nothing}
          />
        </Aimed>
        <Aimed>
          <AimedCaptureForm
            kind={CAPTURE_KINDS['saved-item']}
            text="the green one, for the cabin"
            onText={nothing}
            day=""
            onDay={nothing}
            pending={false}
            error="Paste the link to it."
            onSubmit={nothing}
          />
        </Aimed>
        <AddedToast />
      </div>
    </ToastProvider>
  );
}

export function ShoppingListAddsSurface() {
  return (
    <div className="space-y-12">
      <section>
        <PageHeader title="Orders" actions={<OrdersAddActions />} />
        <OrdersEmpty />
      </section>
      <section>
        <PageHeader title="Inventory" actions={<InventoryAddActions />} />
        <InventoryEmpty />
      </section>
    </div>
  );
}
