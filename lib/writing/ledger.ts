import { costMicrosFor, type SpendReport } from '@/lib/core/spend/pricing';

/**
 * The core.model_spend row for one writing check, for the scripts that write
 * it over a direct connection (scripts/plan.ts, scripts/writing-scores.ts).
 * The app records through lib/core/spend/record.ts instead; the columns are
 * the same.
 */
export function writingSpendRow(userId: string, report: SpendReport) {
  return {
    user_id: userId,
    module: 'core',
    operation: 'check-writing',
    model: report.model,
    input_tokens: report.usage.inputTokens,
    cached_input_tokens: report.usage.cachedInputTokens,
    cache_write_tokens: report.usage.cacheWriteTokens,
    output_tokens: report.usage.outputTokens,
    cost_micros: costMicrosFor(report.model, report.usage),
  };
}
