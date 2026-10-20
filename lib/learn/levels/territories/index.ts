import type { Territory } from '@/lib/learn/levels/territory';
import { BUSINESS } from '@/lib/learn/levels/territories/business';
import { SAAS_METRICS } from '@/lib/learn/levels/territories/saas-metrics';

/**
 * The hand-written territories the territory-draft route can draft by key
 * (`?territory=<key>`). A new pack adds its territory here (plan #2483.1).
 */
export const TERRITORIES: Readonly<Record<string, Territory>> = {
  [SAAS_METRICS.key]: SAAS_METRICS,
  [BUSINESS.key]: BUSINESS,
};
