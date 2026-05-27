import {
  buildDrizzleFilter,
  isFilterGroup,
  validateFilterGroup,
  type FilterRule,
  type FilterGroup,
  type FilterOperator,
} from './filter-parser.js';
import { describe, it, expect } from 'vitest';

describe('filter-parser', () => {
  const mockTable = {
    id: 'mock_id_col',
    status: 'mock_status_col',
    data: 'mock_data_col',
    payload: 'mock_payload_col',
  };

  describe('isFilterGroup', () => {
    it('should return true for valid FilterGroup', () => {
      expect(isFilterGroup({ logic: 'and', rules: [] })).toBe(true);
      expect(
        isFilterGroup({
          logic: 'or',
          rules: [{ field: 'a', operator: 'eq', value: '1' }],
        }),
      ).toBe(true);
    });

    it('should return false for invalid objects', () => {
      expect(isFilterGroup(undefined)).toBe(false);
      expect(isFilterGroup(null)).toBe(false);
      expect(isFilterGroup({})).toBe(false);
      expect(isFilterGroup({ logic: 'and' })).toBe(false); // missing rules
      expect(isFilterGroup({ rules: [] })).toBe(false); // missing logic
      expect(isFilterGroup({ field: 'id', operator: 'eq', value: 1 })).toBe(
        false,
      ); // is FilterRule
    });
  });

  describe('validateFilterGroup', () => {
    it('should validate valid nested groups and rules', () => {
      expect(
        validateFilterGroup({
          logic: 'and',
          rules: [{ field: 'id', operator: 'eq', value: 1 }],
        }),
      ).toBe(true);
    });

    it('should reject invalid rules', () => {
      expect(
        validateFilterGroup({
          logic: 'and',
          rules: [{ field: 123, operator: 'eq', value: 1 }],
        }),
      ).toBe(false);
      expect(
        validateFilterGroup({
          logic: 'and',
          rules: [{ field: 'id', operator: 'unknown', value: 1 }],
        }),
      ).toBe(false);
      expect(
        validateFilterGroup({
          logic: 'and',
          rules: [{ field: 'id', operator: 'in', value: 'not-array' }],
        }),
      ).toBe(false);
      expect(validateFilterGroup({ logic: 'and', rules: [null] })).toBe(false);
    });
  });

  describe('buildDrizzleFilter', () => {
    it('should return undefined for undefined AST', () => {
      expect(buildDrizzleFilter(undefined, mockTable)).toBeUndefined();
    });

    it('should build a simple eq rule on a standard column', () => {
      const ast: FilterRule = { field: 'id', operator: 'eq', value: '123' };
      const result = buildDrizzleFilter(ast, mockTable);
      expect(result).toBeDefined();
      // result is a SQL wrapper. We can't strictly deep equal the SQL class, but we can verify it returns something.
      expect(result?.constructor.name).toBe('SQL');
    });

    it('should build a simple neq rule on a standard column', () => {
      const ast: FilterRule = {
        field: 'status',
        operator: 'neq',
        value: 'FAIL',
      };
      const result = buildDrizzleFilter(ast, mockTable);
      expect(result).toBeDefined();
    });

    it('should build operators (gt, gte, lt, lte)', () => {
      const ops = ['gt', 'gte', 'lt', 'lte'];
      ops.forEach((op) => {
        const ast: FilterRule = {
          field: 'id',
          operator: op as FilterOperator,
          value: 5,
        };
        const result = buildDrizzleFilter(ast, mockTable);
        expect(result).toBeDefined();
      });
    });

    it('should build "in" operator', () => {
      const ast: FilterRule = { field: 'id', operator: 'in', value: [1, 2, 3] };
      const result = buildDrizzleFilter(ast, mockTable);
      expect(result).toBeDefined();
    });

    it('should return false sql for empty "in" operator', () => {
      const ast: FilterRule = { field: 'id', operator: 'in', value: [] };
      const result = buildDrizzleFilter(ast, mockTable);
      expect(result).toBeDefined();
    });

    it('should build "contains" and "startsWith" operators', () => {
      const ast1: FilterRule = {
        field: 'id',
        operator: 'contains',
        value: 'abc',
      };
      expect(buildDrizzleFilter(ast1, mockTable)).toBeDefined();

      const ast2: FilterRule = {
        field: 'id',
        operator: 'startsWith',
        value: 'xyz',
      };
      expect(buildDrizzleFilter(ast2, mockTable)).toBeDefined();
    });

    it('should handle JSONB nested paths by default for non-standard columns', () => {
      const ast: FilterRule = {
        field: 'customField',
        operator: 'eq',
        value: 'foo',
      };
      const result = buildDrizzleFilter(ast, mockTable);
      expect(result).toBeDefined();
    });

    it('should handle explicit JSONB nested paths', () => {
      const ast: FilterRule = {
        field: 'data.nested.property',
        operator: 'eq',
        value: 'bar',
      };
      const result = buildDrizzleFilter(ast, mockTable);
      expect(result).toBeDefined();
    });

    it('should return undefined if the base column does not exist on the table', () => {
      const ast: FilterRule = {
        field: 'nonexistent.property',
        operator: 'eq',
        value: 'bar',
      };
      const result = buildDrizzleFilter(ast, mockTable);
      expect(result).toBeUndefined();
    });

    it('should return undefined for unknown operator', () => {
      const ast: FilterRule = {
        field: 'id',
        // @ts-expect-error - testing invalid operator
        operator: 'unknown_op',
        value: '1',
      };
      const result = buildDrizzleFilter(ast, mockTable);
      expect(result).toBeUndefined();
    });

    it('should process a FilterGroup with AND logic', () => {
      const ast: FilterGroup = {
        logic: 'and',
        rules: [
          { field: 'id', operator: 'eq', value: 1 },
          { field: 'status', operator: 'eq', value: 'SUCCESS' },
        ],
      };
      const result = buildDrizzleFilter(ast, mockTable);
      expect(result).toBeDefined();
    });

    it('should process a FilterGroup with OR logic', () => {
      const ast: FilterGroup = {
        logic: 'or',
        rules: [
          { field: 'id', operator: 'eq', value: 1 },
          { field: 'id', operator: 'eq', value: 2 },
        ],
      };
      const result = buildDrizzleFilter(ast, mockTable);
      expect(result).toBeDefined();
    });

    it('should return undefined for empty FilterGroup', () => {
      const ast: FilterGroup = { logic: 'and', rules: [] };
      const result = buildDrizzleFilter(ast, mockTable);
      expect(result).toBeUndefined();
    });

    it('should return undefined for invalid path segments in jsonb column', () => {
      const ast: FilterRule = {
        field: 'payload.invalid"segment',
        operator: 'eq',
        value: '1',
      };
      const result = buildDrizzleFilter(ast, mockTable);
      expect(result).toBeUndefined();
    });

    it('should cast numeric and date values for jsonb', () => {
      let ast: FilterRule = {
        field: 'payload.amount',
        operator: 'gt',
        value: 100,
      };
      expect(buildDrizzleFilter(ast, mockTable)).toBeDefined();

      ast = {
        field: 'payload.date',
        operator: 'gt',
        value: '2024-01-01T00:00:00Z',
      };
      expect(buildDrizzleFilter(ast, mockTable)).toBeDefined();
    });
  });
});
