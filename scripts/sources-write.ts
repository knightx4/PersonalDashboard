/**
 * Write the catalogue of sources for the goals routine to read:
 *
 *   npm run sources:write
 *
 * The routine reads .claude/skills/goals/reference/sources.md, not the code,
 * so after a module's sources.ts changes this writes the file again.
 * lib/sources/catalogue.test.ts fails until it has been run.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogueMarkdown } from '@/lib/sources/catalogue';

const SOURCES_FILE = join(process.cwd(), '.claude/skills/goals/reference/sources.md');

writeFileSync(SOURCES_FILE, catalogueMarkdown());
console.log(`wrote ${SOURCES_FILE}`);
