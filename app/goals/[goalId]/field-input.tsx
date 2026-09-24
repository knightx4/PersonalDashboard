'use client';

import { Input, Select, Textarea } from '@/components/ui/field';
import type { CollectionField, FieldValue } from '@/lib/goals/collections';
import { VALUE_PREFIX, inputValue } from '@/lib/goals/information';

/**
 * One field's input on an information step, drawn from its type (plan #954).
 * Shared by the record form and the filled-in preview from a paste or a
 * document (plan #955), whose inputs carry a row prefix.
 */
export function FieldInput({
  id,
  field,
  value,
  namePrefix = '',
}: {
  id: string;
  field: CollectionField;
  value: FieldValue | undefined;
  /** Put before the input's name when one form holds several records. */
  namePrefix?: string;
}) {
  const name = `${namePrefix}${VALUE_PREFIX}${field.key}`;
  const defaultValue = inputValue(field, value);
  switch (field.type) {
    case 'long_text':
      return <Textarea id={id} name={name} rows={2} defaultValue={defaultValue} />;
    case 'number':
    case 'money':
    case 'percent':
      return (
        <Input
          id={id}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          defaultValue={defaultValue}
        />
      );
    case 'day_of_month':
      return (
        <Input
          id={id}
          name={name}
          inputMode="numeric"
          autoComplete="off"
          defaultValue={defaultValue}
        />
      );
    case 'date':
      return <Input id={id} name={name} type="date" defaultValue={defaultValue} />;
    case 'link':
      return <Input id={id} name={name} type="url" inputMode="url" defaultValue={defaultValue} />;
    case 'yes_no':
      return (
        <Select id={id} name={name} defaultValue={defaultValue}>
          <option value="">Not said</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
      );
    case 'choice': {
      const options = field.options ?? [];
      // A value kept from before an option was taken off stays choosable.
      const kept = defaultValue && !options.includes(defaultValue) ? [defaultValue] : [];
      return (
        <Select id={id} name={name} defaultValue={defaultValue}>
          <option value="">Not chosen</option>
          {[...kept, ...options].map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
    }
    default:
      return <Input id={id} name={name} autoComplete="off" defaultValue={defaultValue} />;
  }
}
