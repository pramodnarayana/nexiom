import { describe, it, expect, vi } from 'vitest';
import { evaluateDeliveryStatus, DispatchResponse } from './delivery-status.evaluator.js';

describe('DeliveryStatusEvaluator', () => {
  const mockSanitizeError = vi.fn((err: unknown) => {
    if (err instanceof Error) return err.message;
    return String(err);
  });

  it('evaluates a successful 2xx response', () => {
    const dispatchResp: DispatchResponse = {
      statusCode: 201,
      body: { id: '123' },
      entityId: '123'
    };

    const result = evaluateDeliveryStatus(dispatchResp, null, mockSanitizeError);

    expect(result.finalStatus).toBe('SUCCESS');
    expect(result.statusCode).toBe(201);
    expect(result.resPayload).toEqual({ id: '123' });
  });

  it('evaluates a non-2xx failure', () => {
    const dispatchResp: DispatchResponse = {
      statusCode: 400,
      body: { error: 'Bad Request' }
    };

    const result = evaluateDeliveryStatus(dispatchResp, null, mockSanitizeError);

    expect(result.finalStatus).toBe('FAIL');
    expect(result.statusCode).toBe(400);
    expect(result.resPayload).toEqual({ error: 'Bad Request' });
  });

  it('evaluates an explicitly retryable dispatch response', () => {
    const dispatchResp: DispatchResponse = {
      statusCode: 429,
      retry: true,
      body: { error: 'Rate limited' }
    };

    const result = evaluateDeliveryStatus(dispatchResp, null, mockSanitizeError);

    expect(result.finalStatus).toBe('RETRY');
    expect(result.statusCode).toBe(429);
    expect(result.resPayload).toEqual({ error: 'Rate limited' });
  });

  it('handles a missing dispatch response (null)', () => {
    const result = evaluateDeliveryStatus(null, null, mockSanitizeError);

    expect(result.finalStatus).toBe('FAIL');
    expect(result.statusCode).toBe(500);
    expect(result.resPayload).toEqual({ error: 'No response received' });
  });

  it('handles a thrown RetryableException', () => {
    const error = new Error('Rate limit exceeded');
    Object.assign(error, { name: 'RetryableException', statusCode: 429 });

    const result = evaluateDeliveryStatus(null, error, mockSanitizeError);

    expect(result.finalStatus).toBe('RETRY');
    expect(result.statusCode).toBe(429);
    expect(result.resPayload).toEqual({ error: 'Rate limit exceeded' });
  });

  it('handles a standard thrown Error (non-retryable)', () => {
    const error = new Error('Internal piece failure');
    Object.assign(error, { statusCode: 500 });

    const result = evaluateDeliveryStatus(null, error, mockSanitizeError);

    expect(result.finalStatus).toBe('FAIL');
    expect(result.statusCode).toBe(500);
    expect(result.resPayload).toEqual({ error: 'Internal piece failure' });
  });

  it('handles a generic object thrown with retryable flag', () => {
    const error = { message: 'Some weird error', retryable: true, statusCode: 503 };

    const result = evaluateDeliveryStatus(null, error, mockSanitizeError);

    expect(result.finalStatus).toBe('RETRY');
    expect(result.statusCode).toBe(503);
    expect(result.resPayload).toEqual({ error: '[object Object]' });
  });
});
