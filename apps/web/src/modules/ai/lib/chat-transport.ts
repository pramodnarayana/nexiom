import { streamFetcher } from '@/shared/lib/api-client';
import type { NavigateFunction } from 'react-router-dom';

/**
 * Creates a custom Vercel AI SDK Fetch implementation designed to deeply integrate
 * with the new Soopa architecture (Queueing POSTs + Polling SSE Streams).
 *
 * Vercel `useChat({ fetch: customJobStreamFetcher })` will inject its URL and standard payload into this function.
 * We intercept it to make the internal POST call and wire up the subsequent SSE Reader seamlessly.
 */
export function createCustomJobStreamFetcher(navigate?: NavigateFunction) {
  return async function customJobStreamFetcher(
    url: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
  const apiUrl = typeof url === 'string' ? url : url.toString();
  
  // 1. Submit the message safely to the background worker API Queue
  const queueResponse = await streamFetcher(apiUrl, {
    method: 'POST',
    headers: init?.headers,
    body: init?.body,
    signal: init?.signal,
  });

  if (!queueResponse.ok) {
    throw new Error(`Failed to initialize chat: ${queueResponse.statusText}`);
  }

  // Expecting { success: true, jobId: "...", conversationId: "..." }
  const payload = await queueResponse.json();
  const { jobId, conversationId } = payload;

  if (!jobId) {
    throw new Error('Received invalid JobId payload from orchestrator API.');
  }

  // Update browser URL silently without reloading if conversationId was returned.
  // This satisfies the deep-linking enterprise requirement without breaking UI state.
  if (conversationId && window.location.pathname === '/dashboard/ai') {
    if (navigate) {
      navigate(`/dashboard/ai/chat/${conversationId}`, { replace: true });
    } else {
      window.history.replaceState(null, '', `/dashboard/ai/chat/${conversationId}`);
    }
  }

  // 2. We now spawn an actual readable Fetch stream targeted at our SSE endpoint.
  // Vercel handles the event-stream natively.
  // We use streamFetcher to maintain Auth Headers!
  const apiBase = import.meta.env.VITE_API_URL || '/api';
  const sseUrl = `${apiBase}/ai/jobs/${jobId}/stream`;

  const sseResponse = await streamFetcher(sseUrl, {
    method: 'GET',
    headers: {
      'Accept': 'text/event-stream',
    },
    signal: init?.signal,
  });

  if (!sseResponse.ok) {
    throw new Error(`Failed to subscribe to Copilot job SSE: ${sseResponse.statusText}`);
  }

  // Provide the native raw ReadableStream back up to standard `useChat`
  return sseResponse;
  };
}

/**
 * Default export for backwards compatibility.
 * For proper React Router integration, use createCustomJobStreamFetcher with navigate.
 */
export const customJobStreamFetcher = createCustomJobStreamFetcher();