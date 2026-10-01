/**
 * The anchor the Saved tab gives each story, so a link from elsewhere (a
 * reading in Learn, plan #1368) can open the tab at that one story.
 */
export function savedStoryAnchor(id: string): string {
  return `story-${id}`;
}
