export interface BetterAuthAdapterConfig {
  allowedOrigins: string[];
  betterAuthUrl: string;
  frontendUrl?: string; // For invite links
  googleClientId?: string;
  googleClientSecret?: string;
  nodeEnv?: string;
}
