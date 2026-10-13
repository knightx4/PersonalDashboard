import { none, tool, type ModuleActions } from '@/lib/agent-actions/types';

/** What the You pages let the person do, and the tool that does each (lib/agent-actions/types.ts). */
export const youActions: ModuleActions = {
  'app/you/places/actions.ts': {
    savePlace: tool('add_place', 'change_place'),
    removePlace: none('deletes'),
  },
};
