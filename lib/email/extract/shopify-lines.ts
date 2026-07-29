export type ParsedShopifyLine = {
  name: string;
  quantity: number;
  unitPriceCents: number;
  variant: string | null;
  blockText: string;
};

function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

const SKIP_NAME =
  /^(subtotal|shipping|taxes?|total|discount|tip|gift\s*card|order\s*summary|view your order|visit our store|thank you)/i;

/**
 * Shopify-style confirmation lines:
 *   Miraculous Foamer × 1
 *   4 oz
 *   $32.00
 */
export function parseShopifyQuantityLines(text: string): ParsedShopifyLine[] {
  if (!text) return [];

  const section =
    text.match(
      /Order summary[\s\S]*?(?=Customer information|Shipping address|Billing address|Payment\b|$)/i,
    )?.[0] ?? text;

  const lines: ParsedShopifyLine[] = [];
  const re =
    /^([^\n]+?)\s*[×x]\s*(\d+)\s*(?:\n+([^\n$][^\n]{0,80}))?\s*\n+\$\s*([0-9,]+\.\d{2})\b/gim;

  let match: RegExpExecArray | null;
  while ((match = re.exec(section)) !== null) {
    const name = match[1].replace(/\s+/g, ' ').trim();
    const quantity = Number(match[2]);
    const variantRaw = match[3]?.replace(/\s+/g, ' ').trim() || null;
    const unitPriceCents = parseMoneyToCents(match[4]);
    if (!name || SKIP_NAME.test(name) || unitPriceCents == null || quantity < 1) continue;
    if (name.length > 200) continue;

    const variant =
      variantRaw && !SKIP_NAME.test(variantRaw) && !/^\$/.test(variantRaw)
        ? variantRaw.slice(0, 80)
        : null;

    lines.push({
      name: name.slice(0, 200),
      quantity,
      unitPriceCents,
      variant,
      blockText: match[0],
    });
  }

  return lines;
}
