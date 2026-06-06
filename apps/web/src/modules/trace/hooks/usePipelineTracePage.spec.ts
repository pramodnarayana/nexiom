import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePipelineTracePage } from './usePipelineTracePage';
import { listTraces } from '../api/trace.api';

vi.mock('../api/trace.api', () => ({
  listTraces: vi.fn(),
}));

describe('usePipelineTracePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles undefined workspaceId or stitchId', async () => {
    const { result } = renderHook(() => usePipelineTracePage(undefined, 's1'));
    
    expect(result.current.loading).toBe(false);
    expect(result.current.traces).toEqual([]);
    expect(listTraces).not.toHaveBeenCalled();
  });

  it('loads traces on mount', async () => {
    vi.mocked(listTraces).mockResolvedValueOnce({
      data: [{ id: 't1' }],
      total: 1
    } as any);

    const { result } = renderHook(() => usePipelineTracePage('w1', 's1'));

    expect(result.current.loading).toBe(true);

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(listTraces).toHaveBeenCalledWith('w1', 's1', { limit: 50 });
    expect(result.current.traces).toEqual([{ id: 't1' }]);
    expect(result.current.error).toBeNull();
  });

  it('handles load error', async () => {
    vi.mocked(listTraces).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => usePipelineTracePage('w1', 's1'));

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
  });
});
