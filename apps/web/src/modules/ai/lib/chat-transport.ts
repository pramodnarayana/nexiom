import { streamFetcher } from '@/shared/lib/api-client';

/**
 * Creates a custom Vercel AI SDK Fetch implementation designed to deeply integrate
 * with the new Nexiom architecture (Queueing POSTs + Polling SSE Streams).
 * 
 * Vercel `useChat({ fetch: customJobStreamFetcher })` will inject its URL and standard payload into this function.
 * We intercept it to make the internal POST call and wire up the subsequent SSE Reader seamlessly.
 */
export async function customJobStreamFetcher(
  url: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const apiUrl = typeof url === 'string' ? url : url.toString();
  
  // 1. Submit the message safely to the background worker API Queue
  const queueResponse = await streamFetcher(apiUrl, {
    method: 'POST',
    headers: { ...init?.headers },
    body: init?.body,
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
    window.history.replaceState(null, '', `/dashboard/ai/chat/${conversationId}`);
  }

  // 2. We now spawn an actual readable Fetch stream targeted at our SSE endpoint.
  // Vercel handles the event-stream natively.
  // We use streamFetcher to maintain Auth Headers!
  const sseUrl = `${import.meta.env.VITE_API_URL}/ai/jobs/${jobId}/stream`;
  
  const sseResponse = await streamFetcher(sseUrl, {
    method: 'GET',
    headers: {
      'Accept': 'text/event-stream',
    },
  });

  if (!sseResponse.ok) {
    throw new Error(`Failed to subscribe to Copilot job SSE: ${sseResponse.statusText}`);
  }

  // Provide the native raw ReadableStream back up to standard `useChat`
  return sseResponse;
}
