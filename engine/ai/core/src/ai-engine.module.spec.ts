import { describe, it, expect } from 'vitest';
import { AiEngineModule } from './ai-engine.module.js';

describe('AiEngineModule', () => {
  it('should compile and allow imports', () => {
    expect(AiEngineModule).toBeDefined();
  });
});
