import { PageHeader } from '@/components/shell/page-header';
import { SavedList, type SavedListStory } from './saved-list';

export type SavedViewProps = {
  /** Newest saved first, each with its newsletter's arrival formatted. */
  stories: SavedListStory[];
};

/**
 * What the Saved tab draws, split from the page so the preview gallery can
 * render it from a fixture. Loading and formatting the dates stay in page.tsx.
 */
export function SavedView({ stories }: SavedViewProps) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Saved"
        description="Stories you saved from your newsletters, the most recently saved first."
      />
      <SavedList stories={stories} />
    </div>
  );
}
