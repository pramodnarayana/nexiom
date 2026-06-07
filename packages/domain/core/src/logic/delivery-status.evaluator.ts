export type DeliveryStatusEvaluation = {
  finalStatus: 'SUCCESS' | 'FAIL' | 'RETRY';
  statusCode: number;
  resPayload: Record<string, unknown> | null;
};

export type DispatchResponse = {
  statusCode?: number;
  retry?: boolean;
  body?: Record<string, unknown>;
  sentPayload?: Record<string, unknown>;
  entityId?: string;
};

/**
 * Pure function to evaluate the delivery status based on the dispatcher response or error.
 * This contains zero infrastructure dependencies and can be tested purely.
 */
export function evaluateDeliveryStatus(
  dispatchResult: DispatchResponse | null,
  error: unknown | null,
  sanitizeErrorFn: (err: unknown) => string
): DeliveryStatusEvaluation {
  if (error) {
    const errObj = error as Record<string, unknown>;
    
    // Check if it's explicitly retryable via duck-typing (e.g. RetryableException)
    const isRetryableException =
      errObj['name'] === 'RetryableException' ||
      (typeof errObj['retryable'] === 'boolean' ? errObj['retryable'] : false);

    const statusCode =
      typeof errObj['statusCode'] === 'number' ? errObj['statusCode'] : 500;

    return {
      statusCode,
      finalStatus: isRetryableException ? 'RETRY' : 'FAIL',
      resPayload: { error: sanitizeErrorFn(error) },
    };
  }

  if (!dispatchResult) {
    return {
      statusCode: 500,
      finalStatus: 'FAIL',
      resPayload: { error: 'No response received' },
    };
  }

  const statusCode = dispatchResult.statusCode ?? 200;
  let finalStatus: 'SUCCESS' | 'FAIL' | 'RETRY';

  if (statusCode >= 200 && statusCode < 300) {
    finalStatus = 'SUCCESS';
  } else if (dispatchResult.retry === true) {
    finalStatus = 'RETRY';
  } else {
    finalStatus = 'FAIL';
  }

  return {
    statusCode,
    finalStatus,
    resPayload: dispatchResult.body ?? null,
  };
}
