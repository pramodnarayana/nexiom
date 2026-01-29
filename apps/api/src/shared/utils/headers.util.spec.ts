import { toWebHeaders } from './headers.util';

describe('headers.util', () => {
  describe('toWebHeaders', () => {
    it('should convert standard headers', () => {
      const input = {
        'content-type': 'application/json',
        'x-api-key': '123',
      };
      const result = toWebHeaders(input);
      expect(result.get('content-type')).toBe('application/json');
      expect(result.get('x-api-key')).toBe('123');
    });

    it('should handle array headers', () => {
      const input = {
        'x-custom': ['val1', 'val2'],
      };
      const result = toWebHeaders(input);
      expect(result.get('x-custom')).toBe('val1, val2');
    });

    it('should ignore undefined values', () => {
      const input = {
        'x-missing': undefined,
      };
      const result = toWebHeaders(input);
      expect(result.has('x-missing')).toBe(false);
    });
  });
});
