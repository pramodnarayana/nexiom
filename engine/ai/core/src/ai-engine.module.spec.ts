import { describe, it, expect } from 'vitest';
import { AiEngineModule } from './ai-engine.module.js';

describe('AiEngineModule', () => {
  it('should be exported and defined', () => {
    // We only verify that the module class can be imported and defined.
    // Deep dependency injection resolution (which pulls in database and external oauth layers)
    // is intentionally deferred to the consuming application (e.g. apps/api) where the global
    // modules like CredentialsModule are natively provided.
    expect(AiEngineModule).toBeDefined();
  });
});