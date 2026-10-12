'use client';

import { useState } from 'react';
import { InlineInput, Select } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { DUE_PRECISIONS, periodEnd, type DuePrecision } from '@/lib/goals/due-precision';

/**
 * A goal's date and how exact it is (plan #1840, feature #1838): a day, a
 * month, a quarter, a half year or a year. Sends `dueOn`, always the last day
 * of the period (or empty for none), and `duePrecision`, so the server stores
 * what the person picked. Changing the precision keeps the period the date was
 * in.
 */

export const PRECISION_LABELS: Record<DuePrecision, string> = {
  day: 'Day',
  month: 'Month',
  quarter: 'Quarter',
  half: 'Half year',
  year: 'Year',
};

const pad = (n: number) => String(n).padStart(2, '0');

type Parts = { day: string; ym: string; year: string; quarter: string; half: string };

function partsOf(iso: string): Parts {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return { day: '', ym: '', year: '', quarter: '1', half: '1' };
  }
  const month = Number(iso.slice(5, 7));
  return {
    day: iso,
    ym: iso.slice(0, 7),
    year: iso.slice(0, 4),
    quarter: String(Math.ceil(month / 3)),
    half: month <= 6 ? '1' : '2',
  };
}

function valueOf(precision: DuePrecision, p: Parts): string {
  const yearOk = /^\d{4}$/.test(p.year);
  switch (precision) {
    case 'day':
      return p.day;
    case 'month':
      return /^\d{4}-\d{2}$/.test(p.ym) ? periodEnd(`${p.ym}-01`, 'month') : '';
    case 'quarter':
      return yearOk ? periodEnd(`${p.year}-${pad(Number(p.quarter) * 3 - 2)}-01`, 'quarter') : '';
    case 'half':
      return yearOk ? periodEnd(`${p.year}-${p.half === '2' ? '07' : '01'}-01`, 'half') : '';
    case 'year':
      return yearOk ? periodEnd(`${p.year}-01-01`, 'year') : '';
  }
}

export function DueField({
  defaultDue,
  defaultPrecision,
  disabled,
  autoFocus,
  onKeyDown,
  label = 'goal',
}: {
  defaultDue: string;
  defaultPrecision: DuePrecision;
  disabled?: boolean;
  autoFocus?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  label?: string;
}) {
  const [precision, setPrecision] = useState<DuePrecision>(defaultPrecision);
  const [parts, setParts] = useState<Parts>(() => partsOf(defaultDue));
  const value = valueOf(precision, parts);
  const set = (change: Partial<Parts>) => setParts((p) => ({ ...p, ...change }));

  function changePrecision(next: DuePrecision) {
    // Keep the period the date is in; a date not yet set stays unset.
    setParts(partsOf(value));
    setPrecision(next);
  }

  const fit = 'field-sizing-content w-auto';
  const year = (
    <InlineInput
      inputMode="numeric"
      maxLength={4}
      value={parts.year}
      onChange={(e) => set({ year: e.target.value.replace(/\D/g, '') })}
      placeholder="year"
      aria-label={`The year the ${label} is due`}
      onKeyDown={onKeyDown}
      disabled={disabled}
      autoFocus={autoFocus && precision !== 'day' && precision !== 'month'}
      className={cn(fit, 'tabular min-w-12 max-sm:min-h-11')}
    />
  );

  return (
    <>
      <input type="hidden" name="duePrecision" value={precision} />
      <Select
        aria-label={`How exact the ${label}'s date is`}
        value={precision}
        onChange={(e) => changePrecision(e.target.value as DuePrecision)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        className="w-auto max-sm:min-h-11"
      >
        {DUE_PRECISIONS.map((p) => (
          <option key={p} value={p}>
            {PRECISION_LABELS[p]}
          </option>
        ))}
      </Select>
      {precision === 'day' && (
        <InlineInput
          type="date"
          name="dueOn"
          value={parts.day}
          onChange={(e) => set({ day: e.target.value })}
          aria-label={`When the ${label} is due. Clear it to have none.`}
          onKeyDown={onKeyDown}
          disabled={disabled}
          autoFocus={autoFocus}
          className="tabular w-auto max-sm:min-h-11"
        />
      )}
      {precision === 'month' && (
        <InlineInput
          type="month"
          value={parts.ym}
          onChange={(e) => set({ ym: e.target.value })}
          aria-label={`The month the ${label} is due. Clear it to have none.`}
          onKeyDown={onKeyDown}
          disabled={disabled}
          autoFocus={autoFocus}
          className="tabular w-auto max-sm:min-h-11"
        />
      )}
      {precision === 'quarter' && (
        <Select
          aria-label="Which quarter"
          value={parts.quarter}
          onChange={(e) => set({ quarter: e.target.value })}
          onKeyDown={onKeyDown}
          disabled={disabled}
          className="w-auto max-sm:min-h-11"
        >
          {['1', '2', '3', '4'].map((q) => (
            <option key={q} value={q}>{`Q${q}`}</option>
          ))}
        </Select>
      )}
      {precision === 'half' && (
        <Select
          aria-label="Which half of the year"
          value={parts.half}
          onChange={(e) => set({ half: e.target.value })}
          onKeyDown={onKeyDown}
          disabled={disabled}
          className="w-auto max-sm:min-h-11"
        >
          <option value="1">H1</option>
          <option value="2">H2</option>
        </Select>
      )}
      {(precision === 'quarter' || precision === 'half' || precision === 'year') && year}
      {precision !== 'day' && <input type="hidden" name="dueOn" value={value} />}
    </>
  );
}
