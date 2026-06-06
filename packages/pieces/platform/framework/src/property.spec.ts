import { describe, it, expect } from 'vitest';
import { Property, PropertyType } from './property.js';

describe('Property', () => {
  it('should return correct property types for factories', () => {
    expect(Property.File({}).type).toBe(PropertyType.FILE);
    expect(Property.Array({}).type).toBe(PropertyType.ARRAY);
    expect(Property.Object({}).type).toBe(PropertyType.OBJECT);
    expect(Property.DateTime({}).type).toBe(PropertyType.SHORT_TEXT);
    expect(Property.DynamicProperties({}).type).toBe(PropertyType.DYNAMIC);
    expect(Property.MarkDown({}).type).toBe(PropertyType.SHORT_TEXT);
    expect(Property.ShortText({ displayName: '', required: false }).type).toBe(PropertyType.SHORT_TEXT);
    expect(Property.LongText({ displayName: '', required: false }).type).toBe(PropertyType.LONG_TEXT);
    expect(Property.Checkbox({ displayName: '', required: false }).type).toBe(PropertyType.CHECKBOX);
    expect(Property.Number({ displayName: '', required: false }).type).toBe(PropertyType.NUMBER);
    expect(Property.Json({ displayName: '', required: false }).type).toBe(PropertyType.JSON);
    expect(Property.SecretText({ displayName: '', required: false }).type).toBe(PropertyType.SECRET_TEXT);
    expect(Property.Dropdown({ displayName: '', required: false, options: async () => ({}) } as any).type).toBe(PropertyType.DROPDOWN);
    expect(Property.StaticDropdown({ displayName: '', required: false, options: { options: [] } }).type).toBe(PropertyType.STATIC_DROPDOWN);
  });
});
