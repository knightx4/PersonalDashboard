import { describe, expect, it } from 'vitest';
import { checkRecord, fieldsError, type CollectionField } from './collections';
import { DEFAULT_LIST_FIELDS, fieldsForProduct, productValues, sayMissing } from './lists';

/** A goal's own lists (plan #2330.2): the fields they start with, and a row filled from a product page. */

const pantries: CollectionField[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'photo', label: 'Photo', type: 'image' },
  { key: 'cost', label: 'Cost', type: 'money' },
  { key: 'width', label: 'Width', type: 'number' },
  { key: 'link', label: 'Link', type: 'link' },
];

const product = {
  url: 'https://shop.example.com/homcom-72',
  title: '  HOMCOM 72"   Kitchen Pantry ',
  imageUrl: 'https://cdn.example.com/homcom.jpg',
  priceCents: 18999,
};

describe('a list with no fields given', () => {
  it('holds a name, a link and notes, which the database accepts', () => {
    expect(DEFAULT_LIST_FIELDS.map((f) => f.key)).toEqual(['name', 'link', 'notes']);
    expect(fieldsError(DEFAULT_LIST_FIELDS)).toBeNull();
  });
});

describe('fieldsForProduct', () => {
  it('leaves a list that has a name, picture, price and link as it is', () => {
    expect(fieldsForProduct(pantries)).toEqual(pantries);
  });

  it('adds the picture and price a list of names and links lacks, after its own fields', () => {
    const fields = fieldsForProduct(DEFAULT_LIST_FIELDS);
    expect(fields.slice(0, 3)).toEqual(DEFAULT_LIST_FIELDS);
    expect(fields.slice(3)).toEqual([
      { key: 'picture', label: 'Picture', type: 'image' },
      { key: 'price', label: 'Price', type: 'money' },
    ]);
    expect(fieldsError(fields)).toBeNull();
  });

  it('picks a free key when the one it wants is taken by another type', () => {
    const fields = fieldsForProduct([{ key: 'price', label: 'Price band', type: 'choice', options: ['Low', 'High'] }]);
    expect(fields.find((f) => f.type === 'money')?.key).toBe('price_2');
    expect(fieldsError(fields)).toBeNull();
  });

  it('does not count a removed field', () => {
    const fields = fieldsForProduct([...pantries.filter((f) => f.type !== 'image'), { key: 'old_pic', label: 'Old', type: 'image', removed: true }]);
    expect(fields.filter((f) => f.type === 'image' && !f.removed)).toHaveLength(1);
  });
});

describe('productValues', () => {
  it("puts the page's name, picture, price and link in the list's own fields", () => {
    const { values, missing } = productValues(pantries, product);
    expect(values).toEqual({
      name: 'HOMCOM 72" Kitchen Pantry',
      photo: 'https://cdn.example.com/homcom.jpg',
      cost: 189.99,
      link: 'https://shop.example.com/homcom-72',
    });
    expect(missing).toEqual([]);
    expect(checkRecord(pantries, values, null).ok).toBe(true);
  });

  it('says what a page did not give, and always keeps the link', () => {
    const { values, missing } = productValues(pantries, { url: product.url, title: null, imageUrl: null, priceCents: null });
    expect(values).toEqual({ link: product.url });
    expect(missing).toEqual(['name', 'picture', 'price']);
    expect(sayMissing(missing)).toBe('the name, the picture and the price');
    expect(sayMissing(['price'])).toBe('the price');
  });
});
