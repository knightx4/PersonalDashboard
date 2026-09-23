# Submit controls and their pending states

A write on the pending tier makes you wait for the server before anything on
screen changes, so the button you pressed is the only thing that can tell you
the app heard you. This is a reading of every submit control in the app, taken
on 2026-09-11, recording which ones change their words while the write is in
flight and which ones stay as they were.

Nothing was changed to produce it. The tables are the work a later step would
go through.

## What was counted

Every `type="submit"` control under `app/` and `components/` — 164 of them — and
the action each one posts to. Every action behind them carries a
`// latency: pending` tag from #182 or #183; the one control with no action at
all is listed at the end. A control counts as showing a pending
state when its own label changes during the write: `Saving…`, `Importing…`,
`Pricing…`. Disabling on its own does not count, because the words stay the same.

| | Controls |
|---|---|
| Label changes while the write is in flight | 94 |
| `pending` passed to `Button`, label fixed | 14 |
| Disabled while pending, label fixed | 25 |
| No pending signal wired at all | 30 |
| Not a write (the inventory filter form's fallback submit) | 1 |

So 69 controls say nothing while the write is running.

## Passes `pending` to Button, label fixed

`Button` takes `pending`, and it disables the button, sets `aria-busy` and makes
it a live region — but the label it announces is the children, and these pass the
same string either way. A screen reader gets "busy"; everyone else gets a dimmed
button.

| Control | Label | Action |
|---|---|---|
| `app/dev/plan/plan-view.tsx:891` | Answer / Record the new answer | `answerPlanDecision` |
| `app/dev/plan/plan-view.tsx:1054` | Answer / Record the new answer | `answerPlanDecision` |
| `app/dev/plan/plan-view.tsx:1079` | Withdraw | `setPlanItemStatus` |
| `app/dev/plan/plan-view.tsx:2212` | icon only, "Send #n to Claude" | `sendPlanItemToClaude` |
| `app/dev/plan/plan-view.tsx:2220` | icon only, "Hand to Claude" | `setPlanItemAssignee` |
| `app/dev/plan/plan-view.tsx:2387` | Hand to Claude / Take back from Claude | `setPlanItemAssignee` |
| `app/dev/raised/raised-view.tsx:121` | Answer / Reply | `answerRaise` |
| `app/dev/raised/raised-view.tsx:183` | Dismiss | `dismissRaise` |
| `app/dev/raised/raised-view.tsx:190` | Reopen | `reopenRaise` |
| `app/dev/surfaces/review.tsx:170` | Note | `noteOnSurface` |
| `app/dev/ui/review/review-view.tsx:47` | Review it | `startUiReview` |
| `app/dev/ui/review/review-view.tsx:134` | Confirm | `decideUiFinding` |
| `app/dev/ui/review/review-view.tsx:149` | Put it back | `decideUiFinding` |
| `app/jobs/(app)/roles/[id]/panels.tsx:556` | Add | `addReminder`, through `useTransition` |

The two plan rows at 2212 and 2220 are `RowIconButton`, which is an icon and an
`sr-only` label. It has no words to swap, so it needs a spinner or a changed
icon rather than a string.

## Disabled while pending, label fixed

The pending flag is already in scope at every one of these; it reaches
`disabled` and stops there.

| Control | Label | Action |
|---|---|---|
| `app/dev/ideas/ideas-view.tsx:190` | Delete | `deleteIdea` |
| `app/dev/plan/plan-view.tsx:1198` | icon only, "Stop waiting on #n" | `removePlanDependency` |
| `app/dev/ui/review/review-view.tsx:137` | Dismiss | `decideUiFinding` |
| `app/learn/r/[id]/read-now-button.tsx:39` | Read now / On Learn now | `toggleReadNow` |
| `app/learn/r/[id]/status-buttons.tsx:38` | the four reading statuses | `updateStatus` |
| `app/learn/s/[id]/probe/session.tsx:66` | the answer options | `answerQuestion` |
| `app/shopping/inventory/[id]/copies-panel.tsx:149` | Separate | `separateCopy` |
| `app/shopping/inventory/[id]/sell-panel.tsx:113` | Use this price | `setSellPrice` |
| `app/shopping/sell/sell-ui.tsx:260` | I'll list this myself | `noteListingIntent` |
| `app/shopping/sell/sell-ui.tsx:271` | Mark donated | `disposeInventoryItem` |
| `app/shopping/sell/sell-ui.tsx:290` | Mark sold to buyback | `disposeInventoryItem` |
| `app/shopping/sell/sell-ui.tsx:300` | Not for sale | `setItemsForSale` |
| `app/shopping/sell/sell-ui.tsx:455` | Price N selected | `priceSellItems` |
| `app/shopping/sell/sell-ui.tsx:469` | Rescan everything | `priceSellItems` |
| `app/shopping/settings/return-policies-section.tsx:109` | Use default | `saveMerchantReturnPolicy` |
| `components/feedback/feedback-list.tsx:278` | Delete | `deleteFeedback` |
| `components/inventory/inventory-selection.tsx:175` | Mark for sale | `setItemsForSale` |
| `components/inventory/inventory-selection.tsx:183` | Not for sale | `setItemsForSale` |
| `components/inventory/inventory-selection.tsx:191` | Mark to return | `setItemsReturnPlanned` |
| `components/inventory/inventory-selection.tsx:199` | Not returning | `setItemsReturnPlanned` |
| `components/todo/event-form.tsx:151` | Save | `addEvent` / `editEvent` |
| `components/todo/event-form.tsx:182` | Delete | `removeEvent` |
| `components/todo/linked-tasks.tsx:100` | Add | `addLinkedTask` |
| `components/todo/task-form.tsx:86` | Add | `addTask` |
| `components/todo/task-form.tsx:206` | Save | `editTask` |

`components/inventory/inventory-selection.tsx` disables its whole toolbar on any
of its four writes, so pressing "Mark for sale" dims "Mark to return" as well
and none of the four says which one is running.

## No pending signal wired at all

Nothing reads a pending flag here: the button stays live and unchanged, and a
second press posts the action again.

| Control | Label | Action | Notes |
|---|---|---|---|
| `app/(auth)/auth-form.tsx:31` | Continue with Google | `signInWithGoogle` | |
| `app/(onboarding)/layout.tsx:29` | Sign out | `signOut` | server component |
| `app/account/view.tsx:96` | Save | `updateAccountSettings` | |
| `app/account/view.tsx:141` | Save | `updateEnabledModules` | |
| `app/account/view.tsx:250` | Sign out | `signOut` | |
| `app/jobs/(app)/contacts/view.tsx:120` | Add contact | `createContact` | |
| `app/jobs/(app)/roles/new/role-form.tsx:63` | Fetch | `fetchJobDescription` | |
| `app/jobs/(app)/settings/view.tsx:244` | Save | `updateProfile` | |
| `app/jobs/(app)/settings/view.tsx:572` | Exclude | `addExcludedSender` | |
| `app/jobs/(app)/settings/view.tsx:649` | Add | `addResumeVersion` | |
| `app/jobs/(app)/settings/view.tsx:807` | Add to the bank | `addEvidence` | |
| `app/jobs/(onboarding)/onboarding/forms.tsx:92` | Skip — I will add roles by hand | `finishOnboarding` | |
| `app/learn/now/page.tsx:81` | Open | `openReading` | server component |
| `app/learn/r/[id]/page.tsx:136` | Open | `openReading` | server component |
| `app/learn/s/[id]/probe/session.tsx:132` | Add these underneath | `approveFloor` | |
| `app/learn/s/[id]/probe/session.tsx:150` | Work out what it rests on | `findFloor` | |
| `app/learn/s/[id]/read-about.tsx:21` | Find something to read for this | `readAboutConcept` | server component |
| `app/shopping/orders/[id]/page.tsx:207` | Restore order | `restoreDeletedOrder` | server component |
| `app/shopping/settings/categories-section.tsx:173` | Delete | `deleteCustomCategory` | |
| `app/shopping/settings/deleted-orders-section.tsx:62` | Restore | `restoreDeletedOrder` | |
| `app/shopping/settings/inbox-section.tsx:148` | Disconnect | `disconnectInbox` | server component |
| `app/shopping/settings/lists-section.tsx:135` | Delete | `deleteItemList` | |
| `app/shopping/settings/muted-merchants.tsx:40` | Import again | `restoreMerchantExclusion` | server component |
| `app/shopping/settings/page.tsx:302` | Sign out | `signOut` | server component |
| `app/shopping/settings/tags-section.tsx:36` | Delete | `deleteItemTag` | |
| `app/todo/settings/view.tsx:119` | Save | `updateAgendaSettings` | |
| `app/vault/settings/page.tsx:156` | Re-read everything | `rescanVault` | server component |
| `app/vault/settings/page.tsx:162` | Disconnect | `disconnectVault` | server component |
| `components/inventory/inventory-row-actions.tsx:130` | Mark for return / Unmark to return | `toggleReturnPlannedForm` | |
| `components/inventory/inventory-row-actions.tsx:142` | Mark for sale / Not for sale | `toggleItemForSaleForm` | |

The ten rows marked *server* are in server components whose `<form action={…}>`
posts a server action directly. There is no hook to read, so each needs a client
submit button before it can say anything.

`app/jobs/(app)/settings/view.tsx` and `app/account/view.tsx` are client
components that call `useActionState` and discard the third element, so the flag
they need is one destructure away.

## How big the fix is

Thirty-nine of the 69 are a one-line change each: the pending flag is already in
the component, and the label has to read it. The 14 in the first table have it on
the button already; the 25 in the second have it on `disabled`.

The remaining 30 need a pending flag that does not exist yet. Twenty are in
client components — a third element from `useActionState`, or `useFormStatus`
inside the form. Ten are in server components and need a small client submit
button.

That button is already written, eighteen times. `useFormStatus` appears in 18
files, each with its own local `SubmitButton` that renders `{pending ? 'Saving…'
: label}`; `app/learn` alone holds fifteen of them. One shared component in
`components/ui/` covering `label`, `pendingLabel` and the `Button` variants would
replace all eighteen and serve the ten server-side rows, which is what makes the
30 cheaper than they look.

## Three of these want the optimistic tier instead

`toggleReadNow`, `toggleReturnPlannedForm` and `toggleItemForSaleForm` are tagged
`// latency: pending -- should be optimistic: a toggle that waits for the round
trip`. Giving them a pending label would settle for the slower tier. They belong
with the optimistic conversions instead, and they appear here only because the
reading covers every submit control.

## What is not in the tables

- `app/shopping/inventory/page.tsx:720`, the "Apply" button behind the inventory
  filters. It submits a GET form and posts no action.
- `app/shopping/sell/sell-ui.tsx:73`, the sell settings form. It has no submit
  control at all — the inputs commit on blur, and a `Saving…` span beside them
  says so. It is the one labelled pending state in the app that is not on a
  button.
- The 13 `ActionMenu` items that carry a `formAction`. They are menu rows rather
  than submit controls: the menu closes, the action runs in a transition, and the
  trigger is disabled until it returns. No label changes there either, so they
  are worth the same pass.
