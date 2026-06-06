import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWorkspaceDetailPage } from './useWorkspaceDetailPage';
import { getWorkspace } from '../api/workspaces.api';

vi.mock('../api/workspaces.api', () => ({
  getWorkspace: vi.fn(),
}));

describe('useWorkspaceDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles null id', async () => {
    const { result } = renderHook(() => useWorkspaceDetailPage(undefined));

    expect(result.current.wsLoading).toBe(false);
    expect(result.current.workspace).toBeNull();
    expect(getWorkspace).not.toHaveBeenCalled();
  });

  it('loads workspace on mount', async () => {
    vi.mocked(getWorkspace).mockResolvedValueOnce({ id: 'w1', name: 'WS 1' } as any);

    const { result } = renderHook(() => useWorkspaceDetailPage('w1'));

    expect(result.current.wsLoading).toBe(true);

    await vi.waitFor(() => {
      expect(result.current.wsLoading).toBe(false);
    });

    expect(result.current.workspace).toEqual({ id: 'w1', name: 'WS 1' });
    expect(result.current.error).toBeNull();
  });

  it('handles load error', async () => {
    vi.mocked(getWorkspace).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useWorkspaceDetailPage('w1'));

    await vi.waitFor(() => {
      expect(result.current.wsLoading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
  });
});
