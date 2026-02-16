/**
 * Helper to validate frontend URL
 * Checks if the provided URL is in the allowed origins list.
 * If valid, returns the URL. Otherwise, checks if it is in the allowed list; if so returns it, else returns the first allowed origin.
 *
 * @param url - The URL to validate
 * @param allowedOrigins - List of allowed origins
 * @returns A valid frontend URL (either the input if valid, or the first allowed origin)
 */
export function validateFrontendUrl(
  url: string | undefined,
  allowedOrigins: string[],
): string {
  if (url && allowedOrigins.includes(url)) {
    return url;
  }
  // Fallback to first allowed origin
  return allowedOrigins[0];
}
