'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/shell/page-header';
import { AimedCaptureForm } from '@/components/shell/capture-aim';
import {
  NamingCode,
  ReceiptAttached,
  ReceiptPhotoButton,
  ScanButton,
  ScannedAttached,
  Viewfinder,
} from '@/components/shell/capture-camera';
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
  // Reading a receipt photo instead (plan #1950.3.2).
  'app/capture-actions.ts#makeAimedCapture:receipt': {
    lowMicros: 2_000,
    medianMicros: 3_100,
    highMicros: 4_800,
    runs: 9,
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
            tools={<ReceiptPhotoButton taken={false} onFile={nothing} />}
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
            tools={<ScanButton scanning={false} onStart={nothing} onStop={nothing} />}
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

/**
 * A receipt drawn as an SVG, standing in for the photo a phone takes: paper,
 * a shop name, lines and a total, so the shot shows how a tall, pale photo
 * sits in the panel.
 */
// ui-ok: raw-hex -- the colours of a photographed counter and paper, which no theme repaints
const [COUNTER, PAPER] = ['#d9d4c7', '#fbfaf6'];
const RECEIPT_PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="520" viewBox="0 0 300 520">
    <rect width="300" height="520" fill="${COUNTER}"/>
    <rect x="40" y="20" width="220" height="480" fill="${PAPER}"/>
    <rect x="95" y="50" width="110" height="14" fill="#333"/>
    ${[100, 130, 160, 190, 220, 250].map((y) => `<rect x="60" y="${y}" width="120" height="8" fill="#777"/><rect x="200" y="${y}" width="40" height="8" fill="#777"/>`).join('')}
    <rect x="60" y="300" width="180" height="2" fill="#999"/>
    <rect x="60" y="320" width="70" height="12" fill="#333"/><rect x="190" y="320" width="50" height="12" fill="#333"/>
  </svg>`,
)}`;

/**
 * The camera step inside aimed capture (plan #1950.3.2): an order with its
 * receipt photo taken, the barcode viewfinder open, a scan being looked up,
 * the book a scan named, and a scan no catalog knows.
 */
export function ShoppingAimedCameraSurface() {
  return (
    <div className="space-y-8 py-4">
      <Aimed>
        <AimedCaptureForm
          kind={CAPTURE_KINDS.order}
          text=""
          onText={nothing}
          day=""
          onDay={nothing}
          pending={false}
          error={null}
          onSubmit={nothing}
          attached={<ReceiptAttached src={RECEIPT_PHOTO} onRemove={nothing} />}
          tools={<ReceiptPhotoButton taken onFile={nothing} />}
          hint={
            <PaidCostsProvider costs={COSTS}>
              <PaidHint action="app/capture-actions.ts#makeAimedCapture:receipt" what="Cost of reading the receipt" align="end" />
            </PaidCostsProvider>
          }
        />
      </Aimed>
      <Aimed>
        <AimedCaptureForm
          kind={CAPTURE_KINDS['inventory-item']}
          text=""
          onText={nothing}
          day=""
          onDay={nothing}
          pending={false}
          error={null}
          onSubmit={nothing}
          attached={<Viewfinder />}
          tools={<ScanButton scanning onStart={nothing} onStop={nothing} />}
        />
      </Aimed>
      <Aimed>
        <AimedCaptureForm
          kind={CAPTURE_KINDS['inventory-item']}
          text=""
          onText={nothing}
          day=""
          onDay={nothing}
          pending={false}
          error={null}
          onSubmit={nothing}
          attached={<NamingCode code="9780143127796" />}
          tools={<ScanButton scanning={false} onStart={nothing} onStop={nothing} />}
        />
      </Aimed>
      <Aimed>
        <AimedCaptureForm
          kind={CAPTURE_KINDS['inventory-item']}
          text=""
          onText={nothing}
          day=""
          onDay={nothing}
          pending={false}
          error={null}
          onSubmit={nothing}
          attached={
            <ScannedAttached
              thing={{
                kind: 'book',
                title: 'The Remains of the Day: A Novel, with an Introduction by the Author for the Thirtieth Anniversary Edition',
                byline: 'Kazuo Ishiguro',
                image: null,
                code: '9780571258246',
                record: '{}',
              }}
              onRemove={nothing}
            />
          }
          tools={<ScanButton scanning={false} onStart={nothing} onStop={nothing} />}
        />
      </Aimed>
      <Aimed>
        <AimedCaptureForm
          kind={CAPTURE_KINDS['inventory-item']}
          text=""
          onText={nothing}
          day=""
          onDay={nothing}
          pending={false}
          error="Nothing is listed under that barcode. Type the name instead."
          onSubmit={nothing}
          tools={<ScanButton scanning={false} onStart={nothing} onStop={nothing} />}
        />
      </Aimed>
    </div>
  );
}
