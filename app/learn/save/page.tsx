import { PageHeader } from '@/components/shell/page-header';
import { AutoSave } from './auto-save';
import { SaveLinkForm } from './save-link-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Save a link' };

/**
 * Where a link shared to Dash lands. The web app manifest names this page as
 * the share target (app/manifest.ts), so on a phone with Dash on the home
 * screen, Share then Dash saves the page to the reading list with no typing.
 * A share sends the link as `url` or inside `text`, depending on the phone and
 * the app it came from; either is read. Opened with neither, it is the box.
 */
export default async function SaveLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[]; text?: string | string[]; title?: string | string[] }>;
}) {
  const params = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';
  const url = one(params.url);
  const text = one(params.text);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Save a link" />
      {url || text ? <AutoSave url={url} text={text} /> : <SaveLinkForm autoFocus />}
    </div>
  );
}
