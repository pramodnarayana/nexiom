import { describe, it, expect } from 'vitest';
import { useAuth } from './useAuth';
import { useAuth as actualUseAuth } from '../lib/auth/context';

describe('useAuth Hook Export', () => {
    it('should correctly re-export useAuth from context', () => {
        expect(useAuth).toBe(actualUseAuth);
    });
});
