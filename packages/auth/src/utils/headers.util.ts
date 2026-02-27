import { IncomingHttpHeaders } from "node:http";

/**
 * Converts Express/Node.js IncomingHttpHeaders to Web API Headers.
 * This ensures compatibility with libraries (like Better Auth) that expect Web Standard Headers.
 */
export function toWebHeaders(expressHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(expressHeaders)) {
    // Only skip explicitly undefined headers. An empty string is a valid header value.
    if (value !== undefined) {
      // Handle array headers (e.g. set-cookie, though typical request headers are singular or comma-separated)
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  return headers;
}
