import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { AiEngineModule } from './ai-engine.module.js';

describe('AiEngineModule', () => {
  it('should compile module and verify dependencies', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AiEngineModule],
    }).compile();

    try {
      expect(moduleRef).toBeDefined();

      // Verify the module compiled successfully with its imports
      expect(AiEngineModule).toBeDefined();
    } finally {
      await moduleRef.close();
    }
  });
});