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
  /^(subtotal|shipping|taxes?|total|discount|tip|gift\s*card|order\s*summary|view your order|visit our store|thank you|customer information|shipping address|billing address|payment|visa|mastercard|amex|ending)/i;

const SECTION_STOP =
  /^(subtotal|shipping|taxes?|total|customer information|shipping address|billing address|payment)\b/i;

const QTY_LINE = /^(.+?)\s*[×xX✕*]\s*(\d+)\s*$/;
const PRICE_LINE = /^\$\s*([0-9,]+\.\d{2})\b/;
const PRICE_EACH_LINE = /^\$\s*([0-9,]+\.\d{2})\s*(?:each)?\b/i;

/**
 * Goods of Desire / some Shopify plain-text templates:
 *   *  1304010-0002 - 1pc x You Too Can Mahjong! by Douglas Young for
 *   $180.00 each
 * or the price on the same line after "for".
 */
const SKU_PC_INLINE =
  /^[*•·]?\s*(?:(\S+)\s+-\s+)?(\d+)\s*pcs?\s*[x×]\s*(.+?)\s+for\s+\$\s*([0-9,]+\.\d{2})\s*(?:each)?\s*$/i;
const SKU_PC_FOR =
  /^[*•·]?\s*(?:(\S+)\s+-\s+)?(\d+)\s*pcs?\s*[x×]\s*(.+?)\s+for\s*$/i;

function cleanMetaLine(line: string): string | null {
  const trimmed = line.replace(/\s+/g, ' ').trim();
  if (!trimmed || SKIP_NAME.test(trimmed) || PRICE_LINE.test(trimmed)) return null;
  // Shopify sometimes emits "_Kickstarter:" style labels — keep the label text.
  const withoutLead = trimmed.replace(/^[_*\-]+\s*/, '').replace(/:\s*$/, '').trim();
  if (!withoutLead || SKIP_NAME.test(withoutLead)) return null;
  if (withoutLead.length > 80) return withoutLead.slice(0, 80);
  return withoutLead;
}

function parseSkuPcLines(rows: string[]): ParsedShopifyLine[] {
  const out: ParsedShopifyLine[] = [];
  const used = new Set<number>();

  for (let i = 0; i < rows.length; i++) {
    if (used.has(i)) continue;
    const trimmed = (rows[i] ?? '').replace(/\s+/g, ' ').trim();
    if (!trimmed) continue;

    const inline = trimmed.match(SKU_PC_INLINE);
    if (inline) {
      const quantity = Number(inline[2]);
      const name = inline[3].replace(/\s+/g, ' ').trim();
      const unitPriceCents = parseMoneyToCents(inline[4]);
      if (!name || SKIP_NAME.test(name) || quantity < 1 || unitPriceCents == null) continue;
      const sku = inline[1]?.trim() || null;
      out.push({
        name: name.slice(0, 200),
        quantity,
        unitPriceCents,
        variant: sku,
        blockText: rows[i] ?? trimmed,
      });
      used.add(i);
      continue;
    }

    const forLine = trimmed.match(SKU_PC_FOR);
    if (!forLine) continue;

    const quantity = Number(forLine[2]);
    const name = forLine[3].replace(/\s+/g, ' ').trim();
    if (!name || SKIP_NAME.test(name) || quantity < 1) continue;

    let unitPriceCents: number | null = null;
    let end = i;
    for (let j = i + 1; j < rows.length && j <= i + 4; j++) {
      const next = (rows[j] ?? '').replace(/\s+/g, ' ').trim();
      if (!next) continue;
      if (SECTION_STOP.test(next) || SKU_PC_FOR.test(next) || SKU_PC_INLINE.test(next)) break;
      const price = next.match(PRICE_EACH_LINE);
      if (price) {
        unitPriceCents = parseMoneyToCents(price[1]);
        end = j;
        break;
      }
    }
    if (unitPriceCents == null) continue;

    const sku = forLine[1]?.trim() || null;
    out.push({
      name: name.slice(0, 200),
      quantity,
      unitPriceCents,
      variant: sku,
      blockText: rows.slice(i, end + 1).join('\n'),
    });
    for (let k = i; k <= end; k++) used.add(k);
  }

  return out;
}

/**
 * Shopify-style confirmation lines inside "Order summary":
 *   Miraculous Foamer × 1
 *   4 oz
 *   $32.00
 *
 * Some merchants (Kickstarter / crowdfunding storefronts) insert extra
 * attribute lines between the title and the price:
 *   Your Pandora's Legacy Pledge - 3 × 1
 *   The Ultimate Bundle
 *   _Kickstarter:
 *   Pledge
 *   $99.00
 */
export function parseShopifyQuantityLines(text: string): ParsedShopifyLine[] {
  if (!text) return [];

  const section =
    text.match(
      /Order summary[\s\S]*?(?=Customer information|Shipping address|Billing address|Payment\b|$)/i,
    )?.[0] ?? text;

  const rows = section.split(/\n/);
  const skuPc = parseSkuPcLines(rows);
  if (skuPc.length > 0) return skuPc;

  const out: ParsedShopifyLine[] = [];

  for (let i = 0; i < rows.length; i++) {
    const qtyMatch = rows[i]?.trim().match(QTY_LINE);
    if (!qtyMatch) continue;

    const name = qtyMatch[1].replace(/\s+/g, ' ').trim();
    const quantity = Number(qtyMatch[2]);
    if (!name || SKIP_NAME.test(name) || name.length > 200 || quantity < 1) continue;

    const meta: string[] = [];
    let unitPriceCents: number | null = null;
    let end = i;

    for (let j = i + 1; j < rows.length && j <= i + 14; j++) {
      const raw = rows[j] ?? '';
      const line = raw.trim();
      if (!line) continue;
      if (SECTION_STOP.test(line)) break;
      if (QTY_LINE.test(line)) break;

      const price = line.match(PRICE_LINE);
      if (price) {
        unitPriceCents = parseMoneyToCents(price[1]);
        end = j;
        break;
      }

      const metaLine = cleanMetaLine(line);
      if (metaLine) meta.push(metaLine);
    }

    if (unitPriceCents == null) continue;

    const variant =
      meta.length > 0
        ? [...new Set(meta)].slice(0, 3).join(' · ').slice(0, 120)
        : null;

    out.push({
      name: name.slice(0, 200),
      quantity,
      unitPriceCents,
      variant,
      blockText: rows.slice(i, end + 1).join('\n'),
    });
  }

  return out;
}
