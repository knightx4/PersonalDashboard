'use client';

import { createContext, useCallback, useContext } from 'react';
import { planScopeLabel, type PlanScope } from '@/lib/plan/projects';

/**
 * What each plan scope is called, for the parts of the plan drawn in the
 * browser (plan #2553.1). A workspace's name is in lib/modules, but a
 * project's is on its dev_projects row, which only the server reads; the page
 * reads it once with the plan and hands the names down here, from the
 * sections it built (`scopeLabelsOf` in lib/plan/tree.ts).
 */
const ScopeLabels = createContext<Readonly<Record<string, string>>>({});

export function ScopeLabelsProvider({
  labels,
  children,
}: {
  labels: Readonly<Record<string, string>>;
  children: React.ReactNode;
}) {
  return <ScopeLabels.Provider value={labels}>{children}</ScopeLabels.Provider>;
}

/**
 * A scope's name: the page's, else a workspace's own, else the bare id. A
 * project outside a provider reads as its id rather than as nothing.
 */
export function useScopeLabel(): (scope: PlanScope | null) => string {
  const labels = useContext(ScopeLabels);
  return useCallback(
    (scope: PlanScope | null) => (scope && labels[scope]) || planScopeLabel(scope, []),
    [labels],
  );
}
