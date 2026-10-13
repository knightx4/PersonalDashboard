import { Card, CardSection } from '@/components/ui/card';
import { Banner } from '@/components/ui/banner';
import { Disclosure } from '@/components/ui/disclosure';
import { ChipSelect, InlineInput, Input, Label, Select, Textarea } from '@/components/ui/field';
import { Figure } from '@/components/ui/figure';
import { Meter } from '@/components/ui/meter';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkline } from '@/components/ui/sparkline';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { ModuleMark } from '@/components/ui/module-mark';
import { Tabs } from '@/components/ui/tabs';
import { ENTRIES } from './overhaul/entries';

/**
 * Every shared component in components/ui, in each state it has, on one
 * surface (`ui-kit`).
 *
 * This is where a change to a primitive is looked at. The close guard used to
 * follow a changed Button up through every file that imports it, which is
 * every screen in the gallery, and the builder then had to settle each one by
 * hand. COMPONENT_SURFACES in lib/preview/routes.ts now stops the walk at this
 * surface for every file in components/ui that has no surface of its own, so
 * a change to Button is checked here, once. A page that imports a primitive
 * for itself is still checked on its own surface when the page changes.
 *
 * The overhauled components are drawn from the overhaul's own entries
 * (app/preview/overhaul/entries.tsx), so the two cannot disagree. The rest
 * follow.
 */

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <CardSection title={title} padding="standard">
      {children}
    </CardSection>
  );
}

export function UiKit() {
  return (
    <div className="space-y-4">
      {ENTRIES.map((entry) => (
        <Group key={entry.id} title={entry.name}>
          {entry.next()}
        </Group>
      ))}

      <Group title="Card and folds">
        <div className="space-y-3">
          <Card padding="dense">A dense card holding a list.</Card>
          <CardSection title="A section that folds" meta="3" fold="preview.ui-kit.fold">
            <p className="text-ui text-ink">The body of a section folded by its heading.</p>
          </CardSection>
          <Disclosure title="A disclosure" meta="2 items">
            <p className="text-ui text-ink">What it was hiding.</p>
          </Disclosure>
        </div>
      </Group>

      <Group title="Banner">
        <div className="space-y-2">
          <Banner tone="info">Mail is syncing for the first time.</Banner>
          <Banner tone="warn">The vault has not synced since Tuesday.</Banner>
          <Banner tone="bad">The last import failed. Try again from Settings.</Banner>
          <Banner tone="good">Every return is back on time this month.</Banner>
        </div>
      </Group>

      <Group title="Fields">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="ui-kit-input">Name</Label>
            <Input id="ui-kit-input" defaultValue="Research Platform" />
          </div>
          <div>
            <Label htmlFor="ui-kit-select">Stage</Label>
            <Select id="ui-kit-select" defaultValue="applied">
              <option value="applied">Applied</option>
              <option value="interview">Interview</option>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ui-kit-textarea">Notes</Label>
            {/* ui-ok: the kit draws the field itself, not a composer over a list */}
            <Textarea id="ui-kit-textarea" defaultValue="Ask about the on-call rota." />
          </div>
          <InlineInput aria-label="Salary" defaultValue="$185,000" />
          <ChipSelect aria-label="Priority" defaultValue="high">
            <option value="high">High</option>
            <option value="low">Low</option>
          </ChipSelect>
        </div>
      </Group>

      <Group title="Tabs">
        <Tabs
          label="Company"
          tabs={[
            { id: 'roles', label: 'Roles', count: 2 },
            { id: 'about', label: 'About' },
            { id: 'people', label: 'People', count: 3 },
          ]}
        />
      </Group>

      <Group title="Figures and measures">
        <div className="space-y-5">
          <Figure label="Spent this month" value="$1,284" caption="$212 under last month" />
          <div className="flex flex-wrap items-center gap-4">
            <div className="w-40">
              <Meter value={7} max={10} label="7 of 10 done" />
            </div>
            <Sparkline values={[3, 5, 2, 8, 6, 9, 4]} label="Orders over seven weeks" />
            <StatusGlyph glyph="half" label="Half done" />
            <StatusGlyph glyph="three-quarters" label="Three quarters done" />
            <ModuleMark module="jobs" />
            <ModuleMark module="learn" />
            <ModuleMark module={null} />
          </div>
        </div>
      </Group>

      <Group title="Loading">
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </Group>
    </div>
  );
}
