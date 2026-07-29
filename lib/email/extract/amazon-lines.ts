export type ParsedAmazonLine = {
  name: string;
  quantity: number;
  unitPriceCents: number;
  variant: string | null;
  /** Raw block text for category heuristics. */
  blockText: string;
};

function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Amazon confirmation plain text uses:
 *   * Product title…
 *     Optional variant line
 *     Quantity: N
 *     12.99 USD
 */
export function parseAmazonQuantityLines(text: string): ParsedAmazonLine[] {
  if (!text) return [];

  const blocks = text.split(/(?=^\*\s+)/m).filter((block) => /^\*\s+\S/m.test(block.trimStart()));
  const lines: ParsedAmazonLine[] = [];

  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    const qtyMatch = block.match(/\bQuantity:\s*(\d+)\b/i);
    const priceMatch =
      block.match(/(?:^|\n)\s*([0-9,]+\.\d{2})\s*USD\b/im) ??
      block.match(/\$\s*([0-9,]+\.\d{2})/);
    if (!qtyMatch || !priceMatch) continue;

    const unitPriceCents = parseMoneyToCents(priceMatch[1]);
    const quantity = Number(qtyMatch[1]);
    if (unitPriceCents == null || !Number.isFinite(quantity) || quantity < 1) continue;

    const metaLines = block
      .replace(/^\*\s*/, '')
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter(
        (line) =>
          !/^Quantity:\s*\d+\b/i.test(line) &&
          !/^[0-9,]+\.\d{2}\s*USD\b/i.test(line) &&
          !/^\$\s*[0-9,]+\.\d{2}\b/.test(line) &&
          !/^(sold by|shipped by|arriving|delivery)/i.test(line) &&
          !/^(grand\s*total|order\s*total|subtotal|shipping|taxes?|total)\s*:?\s*$/i.test(
            line,
          ),
      );

    const name = metaLines[0]?.replace(/\s+/g, ' ').trim();
    if (!name || name.length < 2) continue;

    const variant =
      metaLines
        .slice(1)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .find(
          (line) =>
            line.length > 0 &&
            line.length <= 80 &&
            !/^(grand\s*total|order\s*total|subtotal|shipping|taxes?|total)\s*:?\s*$/i.test(
              line,
            ),
        ) ?? null;

    lines.push({
      name: name.slice(0, 200),
      quantity,
      unitPriceCents,
      variant,
      blockText: block,
    });
  }

  return lines;
}
