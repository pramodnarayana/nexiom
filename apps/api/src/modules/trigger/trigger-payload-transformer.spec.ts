import { describe, it, expect } from 'vitest';
import { TriggerPayloadTransformer } from './trigger-payload-transformer.js';

describe('TriggerPayloadTransformer', () => {
  const transformer = new TriggerPayloadTransformer();

  describe('parseWebhookPayload', () => {
    it('should parse JSON correctly', () => {
      const result = transformer.parseWebhookPayload(
        Buffer.from('{"hello":"world"}'),
      );
      expect(result).toEqual({ hello: 'world' });
    });

    it('should fallback to buffer if JSON invalid', () => {
      const buf = Buffer.from('not json');
      const result = transformer.parseWebhookPayload(buf);
      expect(result).toEqual(buf);
    });

    it('should return rawBuffer if string is empty', () => {
      const buf = Buffer.from('');
      const result = transformer.parseWebhookPayload(buf);
      expect(result).toEqual(buf);
    });
  });

  describe('buildSourceEventId', () => {
    it('should derive fingerprint from object', () => {
      const record = { a: 1, b: 2 };
      const fp = transformer.buildSourceEventId('ws1', 'trig1', record);
      expect(typeof fp).toBe('string');
      expect(fp.length).toBeGreaterThan(0);
    });

    it('should truncate large payloads', () => {
      const record = { a: 'A'.repeat(100000) };
      const fp = transformer.buildSourceEventId('ws1', 'trig1', record);
      expect(typeof fp).toBe('string');
    });

    it('should handle non-object primitives', () => {
      const fp = transformer.buildSourceEventId(
        'ws1',
        'trig1',
        'string_payload',
      );
      expect(typeof fp).toBe('string');
      expect(fp.length).toBeGreaterThan(0);
    });

    it('should handle arrays', () => {
      const fp = transformer.buildSourceEventId('ws1', 'trig1', [1, 2, 3]);
      expect(typeof fp).toBe('string');
      expect(fp.length).toBeGreaterThan(0);
    });

    it('should strip volatile keys', () => {
      const record1 = { a: 1, _etag: 'foo' };
      const record2 = { a: 1, _etag: 'bar' };
      const fp1 = transformer.buildSourceEventId('ws1', 'trig1', record1);
      const fp2 = transformer.buildSourceEventId('ws1', 'trig1', record2);
      expect(fp1).toEqual(fp2);
    });
  });

  describe('extractRecordCursor', () => {
    it('should extract matching cursor', () => {
      const newCursor = transformer.extractRecordCursor({
        LastModifiedDate: 'val',
      });
      expect(newCursor).toEqual('val');
    });

    it('should return current ISO string if no cursor definition', () => {
      const newCursor = transformer.extractRecordCursor({ test: 'val' });
      expect(new Date(newCursor).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should return current ISO string if record is not an object', () => {
      const newCursor = transformer.extractRecordCursor('not object');
      expect(new Date(newCursor).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should return current ISO string if record is null', () => {
      const newCursor = transformer.extractRecordCursor(null);
      expect(new Date(newCursor).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('buildWebhookLockHash', () => {
    it('should build a 16-character hex hash', () => {
      const hash = transformer.buildWebhookLockHash(Buffer.from('hello'));
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(16);
    });
  });
});
