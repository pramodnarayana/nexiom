import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTraceRow } from './useTraceRow';
import { getTrace } from '../api/trace.api';

vi.mock('../api/trace.api', () => ({
  getTrace: vi.fn(),
}));

describe('useTraceRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const summary = {
    id: 't1',
    traceId: 'trace-1',
  } as any;

  it('toggles expansion and loads details on first expand', async () => {
    vi.mocked(getTrace).mockResolvedValueOnce({
      id: 'full-trace-1'
    } as any);

    const { result } = renderHook(() => useTraceRow('w1', 's1', summary));

    expect(result.current.expanded).toBe(false);
    expect(result.current.details).toBeNull();

    act(() => {
      void result.current.handleToggle();
    });

    expect(result.current.expanded).toBe(true);
    expect(result.current.loading).toBe(true);

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(getTrace).toHaveBeenCalledWith('w1', 's1', 'trace-1');
    expect(result.current.details).toEqual({ id: 'full-trace-1' });

    // Toggle again to collapse
    act(() => {
      void result.current.handleToggle();
    });

    expect(result.current.expanded).toBe(false);
    
    // Toggle again to expand, should not fetch again
    act(() => {
      void result.current.handleToggle();
    });

    expect(result.current.expanded).toBe(true);
    expect(getTrace).toHaveBeenCalledTimes(1); // Still 1
  });

  it('handles load error', async () => {
    vi.mocked(getTrace).mockRejectedValueOnce(new Error('Failed trace fetch'));

    const { result } = renderHook(() => useTraceRow('w1', 's1', summary));

    act(() => {
      void result.current.handleToggle();
    });

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.errorObj).toBe('Failed trace fetch');
    expect(result.current.details).toBeNull();
  });
});
