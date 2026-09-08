import { MODULES } from '@/lib/modules';
import { isClosed, type PlanStatus } from './load';
import { ancestorsOf, type PlanNode, type PlanSection } from './tree';

/**
 * A step written out for whoever is about to build it.
 *
 * The page shows a step in its place; a brief is the step taken out of the
 * page and handed over — to a session, a routine, a pasted message — with
 * everything it needs carried along: where it sits, what it involves, what
 * done means, what it waits on and what is beneath it. Markdown, because
 * that is what the reader on the other end reads.
 *
 * Deliberately the whole story and nothing else. A brief that leaves out the
 * acceptance criteria produces work checked against nobody's definition of
 * done; one that pads itself with the rest of the plan buries the step.
 */

export const STATUS_WORD: Record<PlanStatus, string> = {
  not_started: 'not started',
  in_progress: 'in progress',
  blocked: 'blocked',
  done: 'done',
  dropped: 'dropped',
};

const PRIORITY_WORD = { 1: 'next', 2: 'normal', 3: 'someday' } as const;

function moduleLabel(module: PlanNode['module']): string {
  return module ? (MODULES.find((m) => m.id === module)?.label ?? module) : 'The app as a whole';
}

function line(node: Pick<PlanNode, 'number' | 'title' | 'status'>): string {
  const box = node.status === 'done' ? '[x]' : node.status === 'dropped' ? '[-]' : '[ ]';
  return `- ${box} #${node.number} ${node.title}${
    node.status === 'in_progress' || node.status === 'blocked' ? ` (${STATUS_WORD[node.status]})` : ''
  }`;
}

function steps(nodes: readonly PlanNode[], indent = ''): string[] {
  return nodes.flatMap((node) => [indent + line(node), ...steps(node.children, indent + '  ')]);
}

export function planBrief(sections: readonly PlanSection[], node: PlanNode): string {
  const ancestors = ancestorsOf(sections, node.id);
  const out: string[] = [];

  out.push(`# Plan step #${node.number} — ${node.title}`);
  out.push('');

  const facts = [
    `Module: ${moduleLabel(node.module)}`,
    `Status: ${STATUS_WORD[node.status]}`,
    `Priority: ${PRIORITY_WORD[node.priority]}`,
  ];
  if (node.size) facts.push(`Size: ${node.size.toUpperCase()}`);
  if (node.assignee) facts.push(`Assigned: ${node.assignee === 'claude' ? 'Claude' : 'me'}`);
  out.push(facts.join(' · '));

  if (ancestors.length > 0) {
    out.push(`Part of: ${ancestors.map((a) => `#${a.number} ${a.title}`).join(' › ')}`);
  }

  if (node.detail) {
    out.push('', '## What it involves', '', node.detail);
  }

  if (node.acceptance) {
    out.push('', '## Done when', '', node.acceptance);
  }

  if (node.dependsOn.length > 0) {
    out.push('', '## Waits on', '');
    for (const link of node.dependsOn) {
      const state = isClosed(link.item.status) ? STATUS_WORD[link.item.status] : 'still open';
      out.push(`- #${link.item.number} ${link.item.title} (${state})`);
    }
  }

  const inherited = node.waitingOn.filter(
    (ref) => !node.dependsOn.some((link) => link.item.id === ref.id),
  );
  if (inherited.length > 0) {
    out.push('', 'Also held up, through a step above it, by:', '');
    for (const ref of inherited) out.push(`- #${ref.number} ${ref.title}`);
  }

  if (node.children.length > 0) {
    out.push('', '## Steps', '', ...steps(node.children));
  }

  if (node.blocks.length > 0) {
    out.push('', '## Unblocks', '');
    for (const ref of node.blocks) out.push(`- #${ref.number} ${ref.title}`);
  }

  if (node.comment) {
    out.push('', '## Notes', '', node.comment);
  }

  if (node.commitSha) {
    out.push('', `Shipped in ${node.commitSha}.`);
  }

  return out.join('\n') + '\n';
}
