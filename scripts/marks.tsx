/**
 * Look at the marks.
 *
 *   npx tsx scripts/marks.tsx .preview-shots/marks.html
 *
 * Then open the file, or photograph it the way scripts/shoot.ts photographs a
 * surface. Output is gitignored; nothing here ships.
 *
 * Why this exists: every mark in the set lives behind a login and a database,
 * so the only way anyone had of judging a redraw was to hand-write SVG that
 * resembled the component and look at *that*. A drawing agrees with whoever
 * drew it -- the same failure scripts/shoot.ts was written to close. This runs
 * components/ui/module-mark.tsx itself, so what you look at is what ships.
 *
 * It renders one React tree rather than one per mark, deliberately. Each mark
 * names its gradient and its mask with useId, and separate renderToStaticMarkup
 * calls each restart that counter -- paste them into one document and every
 * mark resolves url(#...) to the first one, so all seven come out as the home
 * dash. That is a bug in the harness and it looks exactly like a bug in the
 * component.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ModuleMark } from '@/components/ui/module-mark';
import { MODULES, type ModuleId } from '@/lib/modules';

/** Home first, then the modules in sidebar order. */
const MARKS: (ModuleId | null)[] = [null, ...MODULES.map((module) => module.id)];

function label(id: ModuleId | null): string {
  return id === null ? 'Home' : (MODULES.find((module) => module.id === id)?.label ?? id);
}

/** Every mark at every size, on one ground. */
function Band({ dark }: { dark: boolean }) {
  return (
    <div className={dark ? 'band dk' : 'band'}>
      {MARKS.map((id) => (
        <div className="cell" key={String(id)}>
          <div className="row">
            <ModuleMark module={id} size="lg" />
            <ModuleMark module={id} size="md" />
            <ModuleMark module={id} size="sm" />
          </div>
          <div className="name">{label(id)}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * The row they actually live in.
 *
 * A mark judged at 44px is not judged. Everything in the set survives being
 * large; what it has to survive is this.
 */
function Strip({ dark }: { dark: boolean }) {
  return (
    <div className={dark ? 'nav dk' : 'nav'}>
      <b>Sidebar, size=&quot;sm&quot;</b>
      {MARKS.map((id) => (
        <ModuleMark module={id} size="sm" key={String(id)} />
      ))}
    </div>
  );
}

const STYLE = `
 body{margin:0;padding:26px 30px 40px;background:#faf9f7;color:#16181d;
   font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
 h1{font-size:19px;margin:0 0 4px} p.sub{color:#6b7280;margin:0 0 22px;font-size:13px}
 h2{font-size:13px;margin:0 0 9px}
 .band{display:flex;border:1px solid #e8e8e6;border-radius:14px;overflow:hidden;
   background:#fff;margin-bottom:20px}
 .band>.cell{flex:1;padding:18px 6px 12px;text-align:center;border-right:1px solid #e8e8e6}
 .band>.cell:last-child{border-right:0}
 .band.dk{border-color:#262a31;background:#12151b} .band.dk>.cell{border-right-color:#22262e}
 .row{display:flex;align-items:center;justify-content:center;gap:10px;height:56px}
 .name{font-size:10.5px;color:#6b7280;margin-top:10px;letter-spacing:.03em}
 .dk .name{color:#868d97}
 .nav{display:flex;gap:6px;align-items:center;padding:9px 12px;border:1px solid #e8e8e6;
   border-radius:12px;background:#fff;width:max-content;margin-bottom:10px}
 .nav.dk{border-color:#262a31;background:#12151b}
 .nav b{font-size:12px;font-weight:500;color:#4b5563;margin:0 8px 0 2px}
 .nav.dk b{color:#9aa1ab}
 svg{display:block}
`;

const out = process.argv[2] ?? '.preview-shots/marks.html';
const body = renderToStaticMarkup(
  <div>
    <h1>Every mark, as the component renders it</h1>
    <p className="sub">
      lg / md / sm, on both grounds, then the size the sidebar uses.
    </p>
    <h2>On light</h2>
    <Band dark={false} />
    <h2>On the app&rsquo;s dark ground</h2>
    <Band dark />
    <Strip dark={false} />
    <Strip dark />
  </div>,
);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `<meta charset="utf-8"><title>Marks</title><style>${STYLE}</style>${body}`);
console.log(`wrote ${out}`);
