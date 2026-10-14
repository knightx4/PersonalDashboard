'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { readReceiptPhoto, saveReceiptOrder, type ReceiptExtraction } from '../receipt-order';

export type ReceiptActionState = {
  error?: string;
  message?: string;
  preview?: {
    merchantName: string | null;
    orderDate: string;
    totalCents: number;
    lines: { name: string; quantity: number; unitPriceCents: number; categorySlug: string | null }[];
  };
  rawOrder?: string;
};

// latency: pending
export async function previewReceiptPhoto(
  _prev: ReceiptActionState,
  formData: FormData,
): Promise<ReceiptActionState> {
  const user = await requireUser();
  const read = await readReceiptPhoto(user.id, String(formData.get('image_data_url') ?? ''));
  if (!read.ok) return { error: read.error };

  return {
    message: 'Review the extracted order, then save.',
    preview: {
      merchantName: read.order.merchantName ?? null,
      orderDate: read.order.orderDate,
      totalCents: read.order.totalCents,
      lines: read.order.lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        categorySlug: line.categorySlug ?? null,
      })),
    },
    rawOrder: JSON.stringify(read.order),
  };
}

// latency: pending
export async function saveReceiptPhotoOrder(
  _prev: ReceiptActionState,
  formData: FormData,
): Promise<ReceiptActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const raw = String(formData.get('raw_order') ?? '');
  if (!raw) return { error: 'Nothing to save.' };

  let extraction: ReceiptExtraction;
  try {
    extraction = JSON.parse(raw);
  } catch {
    return { error: 'Invalid order payload.' };
  }

  const saved = await saveReceiptOrder(supabase, user.id, extraction);
  if (!saved.ok) return { error: saved.error };

  revalidatePath('/shopping/orders');
  revalidatePath('/shopping/inventory');
  revalidatePath('/shopping/dashboard');
  redirect(`/shopping/orders/${saved.id}`);
}
