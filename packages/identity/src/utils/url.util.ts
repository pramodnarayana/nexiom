/**
 * Helper to validate frontend URL
 * Checks if the provided URL is in the allowed origins list.
 * If validation fails or URL is missing, it returns the first allowed origin as a fallback.
 *
 * @param url - The URL to validate
 * @param allowedOrigins - List of allowed origins
 * @returns The validated URL if it matches an allowed origin, otherwise the first allowed origin.
 * @throws Error if allowedOrigins is empty
 */
export function validateFrontendUrl(
  url: string | undefined,
  allowedOrigins: string[],
): string {
  if (!allowedOrigins || allowedOrigins.length === 0) {
    throw new Error("validateFrontendUrl: allowedOrigins cannot be empty");
  }

  if (url && allowedOrigins.includes(url)) {
    return url;
  }
  // Fallback to first allowed origin
  return allowedOrigins[0];
}
