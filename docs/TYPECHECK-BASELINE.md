# Type check baseline

Measured 15 October 2026 on main at `ad2b66103` (plan #2205.1), TypeScript
5.9.3, Node 22.22.0, a 4-core 15 GiB machine with no other load. Step #2205.2
repeats these commands and compares.

## Commands

Run from a clean checkout, deleting `tsconfig.tsbuildinfo` first so
`incremental` does not hide the work. `--incremental false` does the same.

```
# peak memory and wall time (this machine has no /usr/bin/time -v)
python3 -c 'import resource,subprocess,time;t=time.time();r=subprocess.run(["node_modules/.bin/tsc","--noEmit","--incremental","false"]);u=resource.getrusage(resource.RUSAGE_CHILDREN);print(r.returncode,round(time.time()-t,1),"s",u.ru_maxrss,"KiB")'

# type and instantiation counts
npx tsc --noEmit --incremental false --extendedDiagnostics

# trace, kept outside the repo, then read
npx tsc --noEmit --incremental false --generateTrace <dir>/trace
npx @typescript/analyze-trace <dir>/trace --color=false --expandTypes=false
```

Where `/usr/bin/time -v` exists, `/usr/bin/time -v npx tsc --noEmit` reports
the same peak as "Maximum resident set size".

## Baseline

| | |
|---|---|
| Peak memory (max RSS) | 5.10 GiB (5,348,424 KiB) |
| `Memory used` (tsc's own count) | 5.03 GiB |
| Wall time, no errors | 150 s (177 s in the run that also traced) |
| Files | 5,726 (4,025 checked source files, 348k lines of definitions, 751k lines of TypeScript) |
| Types | 1,764,406 |
| Instantiations | 9,377,851 |
| Check time | 155 s of 177 s; parse 8 s, bind 4 s |

The plan skill's building guide quotes "about 25 seconds" for this command. It is now six
times that.

## What the trace shows

No file dominates. The slowest single file is 2.3 s of 155 s, and 72 s is spent
in the 3,700 files that each take under 100 ms. The cost is the number of
files and the types each one touches.

- **Tests are a fifth of it.** The 1,198 test files add 32 s by their own
  timings. Excluding `tests/**` and `*.test.ts(x)` gives 112 s, 4.0 GiB,
  1.40M types and 8.96M instantiations. The instantiation count barely moves,
  so most of the 9.4M comes from application code.
- **Types by declaring file:** `lib.es5.d.ts` 296k, `@supabase/postgrest-js`
  240k, `@types/node/compatibility/indexable.d.ts` 155k, `lib.es2015.iterable`
  68k, `@vitest/expect` 31k, zod 37k. The 155k are `RelativeIndexable<T>`,
  one per `Array<T>` that gets created (175k arrays).
- **Supabase client is untyped** (`createServerClient` without a `Database`
  type), and there are about 2,900 `.from('...')` calls. Each builds
  `PostgrestTransformBuilder` and its methods.

## Ten slowest files

Times include whatever the file is first to instantiate, so a shared type is
charged to whichever file reaches it first.

| # | File | Time | What is costly |
|---|---|---|---|
| 1 | `lib/learn/briefs/quick-read.ts` | 2.27 s | One chain at lines 40 to 46 takes 2.1 s: a Supabase `.from().select(template string).eq().in().in().order()`. Probably the first untyped postgrest chain the checker reaches. |
| 2 | `tests/rls-goals.test.ts` | 2.24 s | `postgres` tagged-template calls with explicit row generics, and vitest `expect` matchers. |
| 3 | `tests/rls-learn.test.ts` | 2.07 s | Same. |
| 4 | `lib/db/admin.ts` | 1.55 s | `drizzle(client, { schema })` at line 32 builds the relational config type for all of the 1,259-line `lib/db/schema.ts`. Nothing uses relational queries. |
| 5 | `app/dev/ui/standard.tsx` | 1.42 s | 2,068 lines of JSX in one file. |
| 6 | `tests/rls-vault.test.ts` | 1.35 s | Same as 2. |
| 7 | `app/preview/surfaces.tsx` | 1.23 s | 8,292 lines of JSX in one file; it declares 2,777 types itself. |
| 8 | `app/jobs/(app)/roles/[id]/page.tsx` | 1.12 s | A 14-way `Promise.all` of Supabase chains, destructured, at lines 160 to 254 (0.57 s). |
| 9 | `lib/you/places-map-outlines.ts` | 1.06 s | Imports `world-atlas` and `us-atlas` JSON; `resolveJsonModule` gives them literal types (0.69 s). |
| 10 | `app/shopping/inventory/[id]/page.tsx` | 1.01 s | The same `Promise.all` shape, lines 70 to 136 (0.75 s). |

Also worth a look: `lib/vault/map/proposal.ts` (0.85 s) spends 0.6 s
computing variance of `z.ZodType<T>` in its `each` helper.

## Suggested fixes, to try in #2205.2

1. Check tests in their own `tsc` run (a `tsconfig.tests.json`) so each process
   holds less, and the two can run in parallel in the gate. Expect the main
   project near 112 s and 4.0 GiB.
2. Drop `{ schema }` from `drizzle()` in `lib/db/admin.ts`, or pass only the
   tables used. Saves about 1.5 s.
3. Try `@types/node` 22 to match Node 22 (now 20.19.43), and see whether
   `RelativeIndexable` goes. Unverified.
4. Type the repeated Supabase reads through a few shared loaders with an
   explicit row type, so the chain is instantiated once and not per page.
5. Import the world-atlas JSON through a `.d.ts` that types it as `Topology`.

## After #2205.2

Measured 15 October 2026 on the same machine with the same command
(`tsc --noEmit --incremental false` under the python snippet above, no
`tsconfig.tsbuildinfo`). The before column was re-measured on this machine at
the same time; the 5.10 GiB above came from a different run, and peak RSS
varies by a few hundred MiB between runs of the same tree.

| | Before | After |
|---|---|---|
| Peak memory (max RSS) | 4.60 GiB (4,820,436 KiB) | 2.97 GiB (3,109,788 KiB) |
| `Memory used` (tsc's own count) | 4.48 GiB | 2.82 GiB |
| Wall time, no errors | 154 s | 106 s |
| Types | 1,764,406 | 1,047,324 |
| Instantiations | 9,377,851 | 2,047,138 |

Four further runs of the after tree peaked between 2.94 and 3.02 GiB.

`npm run typecheck`, which the gate, CI and the building guide use, is still
one `tsc` process over the whole project, tests included. Next's type check
during `next build` reads the same `tsconfig.json`, so it gets the same saving.

### What changed

The cost was the select-string parser in `@supabase/postgrest-js`. Every
client here is created without a `Database` type, and for that case the
library still parses each `.select('...')` string at the type level to infer a
row of `any` fields. About 2,300 select calls did that.

`lib/db/postgrest-select.d.ts` adds a `select()` overload, ahead of the
library's own, that applies only when the schema is `any`: it takes the column
list as a plain `string` and types each row as `any`. A client given a real
`Database` type falls through to the library's own `select()`.

Rows were `{ col: any }` objects before and are `any` now, so a misspelt
property on an untyped row is no longer caught. One page relied on the
inferred shape for callback parameters, `app/shopping/orders/[id]/page.tsx`,
and now states its row type with `.maybeSingle<OrderRow>()`. Nothing changes
at runtime.

### Tried and not kept

| Change | Result |
|---|---|
| Drop `{ schema }` from `drizzle()` in `lib/db/admin.ts` | 13k fewer types and 158k fewer instantiations, peak memory unchanged (2.96 GiB). Not kept. |
| `@types/node` 22 | `compatibility/indexable.d.ts` is identical in 22.20.5, so `RelativeIndexable` stays. Not installed. |
| Type the `world-atlas` and `us-atlas` JSON as `Topology` | Peak 3.00 GiB, no change. Not kept. |
| Check tests in a separate `tsc` run | The project without tests peaks at 2.39 GiB in 74 s. The whole project in one run is already under 3 GiB, so the split is left as the next lever if the count grows again. |
