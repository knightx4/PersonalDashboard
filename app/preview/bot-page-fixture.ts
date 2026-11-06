/**
 * The page a bot had made, as the gallery's goals-file-page surface frames it
 * (plan #2997). It is the framed document, not the app's screen, so its own
 * colours and wording are the page's, not the app's tokens.
 */
export const DRILL_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c1b19;background:#fbfaf7} /* ui-ok: the framed page's own colours, not the app's */
main{max-width:40rem;margin:0 auto;padding:20px 16px}h1{font-size:22px;margin:0 0 4px}p.sub{color:#6b665e;margin:0 0 20px} /* ui-ok: the framed page's own colours, not the app's */
.q{background:#fff;border:1px solid #e4e0d8;border-radius:12px;padding:16px;margin-bottom:12px} /* ui-ok: the framed page's own colours, not the app's */
.q h2{font-size:15px;margin:0 0 8px;color:#6b665e;font-weight:600}label{display:block;margin:6px 0} /* ui-ok: the framed page's own colours, not the app's */
button{font:inherit;border:0;border-radius:8px;padding:8px 14px;background:#2f5d50;color:#fff} /* ui-ok: the framed page's own colours, not the app's */
.answer{margin-top:10px;padding:10px 12px;border-radius:8px;background:#eef4f1} /* ui-ok: the framed page's own colours, not the app's */
</style></head><body><main><h1>Accounting practice drill</h1><p class="sub">12 questions for Thursday's second round. Answer, then reveal the worked answer.</p>
<div class="q"><h2>1 of 12 · Journal entries</h2><p>You prepay $12,000 for a year of software on 1 March. What is the entry on 1 March?</p>
<label><input type="radio" name="q1"> Dr Software expense 12,000 / Cr Cash 12,000</label>
<label><input type="radio" name="q1"> Dr Prepaid expenses 12,000 / Cr Cash 12,000</label>
<button type="button">Reveal the answer</button>
<div class="answer"><strong>Dr Prepaid expenses 12,000, Cr Cash 12,000.</strong> The service is not used yet, so it is an asset. Each month, Dr Software expense 1,000, Cr Prepaid expenses 1,000.</div></div>
<div class="q"><h2>2 of 12 · Revenue recognition</h2><p>A customer signs a 12-month contract for $24,000, paid upfront in January. How much revenue is recognised in January?</p>
<button type="button">Reveal the answer</button></div>
<div class="q"><h2>3 of 12 · Accruals</h2><p>Staff worked the last week of December and are paid on 5 January. What is booked on 31 December?</p>
<button type="button">Reveal the answer</button></div>
<div class="q"><h2>4 of 12 · Month-end close</h2><p>The bank shows $41,250 and the ledger $40,900. Name two items that could explain the $350.</p>
<button type="button">Reveal the answer</button></div></main></body></html>`;

