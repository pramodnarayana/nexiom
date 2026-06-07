import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStitchesPage } from './useStitchesPage';
import { getWorkspace } from '@/modules/workspaces/api/workspaces.api';
import { listStitches, archiveStitch } from '../api/stitches.api';

vi.mock('@/modules/workspaces/api/workspaces.api', () => ({
  getWorkspace: vi.fn(),
}));

vi.mock('../api/stitches.api', () => ({
  listStitches: vi.fn(),
  archiveStitch: vi.fn(),
}));

describe('useStitchesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles null workspaceId', async () => {
    const { result } = renderHook(() => useStitchesPage(undefined));

    expect(result.current.loading).toBe(false);
    expect(result.current.workspace).toBeNull();
    expect(getWorkspace).not.toHaveBeenCalled();
    expect(listStitches).not.toHaveBeenCalled();
  });

  it('loads workspace and stitches on mount', async () => {
    vi.mocked(getWorkspace).mockResolvedValueOnce({ id: 'w1', name: 'WS 1' } as any);
    vi.mocked(listStitches).mockResolvedValueOnce([{ id: 's1' } as any]);

    const { result } = renderHook(() => useStitchesPage('w1'));
    
    expect(result.current.loading).toBe(true);

    // Wait for internal promises to settle
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.workspace).toEqual({ id: 'w1', name: 'WS 1' });
    expect(result.current.stitches).toEqual([{ id: 's1' }]);
  });

  it('handles load error', async () => {
    vi.mocked(getWorkspace).mockRejectedValueOnce(new Error('Network error'));
    vi.mocked(listStitches).mockResolvedValueOnce([]);

    const { result } = renderHook(() => useStitchesPage('w1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.workspace).toBeNull();
  });

  it('archives stitch and removes from list', async () => {
    vi.mocked(getWorkspace).mockResolvedValueOnce({ id: 'w1' } as any);
    vi.mocked(listStitches).mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }] as any);
    vi.mocked(archiveStitch).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useStitchesPage('w1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.stitches.length).toBe(2);

    // Act
    act(() => {
      result.current.setArchiveTarget({ id: 's1' } as any);
    });
    
    await act(async () => {
      await result.current.handleArchiveConfirm();
    });

    expect(archiveStitch).toHaveBeenCalledWith('s1');
    expect(result.current.stitches).toEqual([{ id: 's2' }]);
    expect(result.current.archiveTarget).toBeNull();
  });

  it('handles archive error', async () => {
    vi.mocked(getWorkspace).mockResolvedValueOnce({ id: 'w1' } as any);
    vi.mocked(listStitches).mockResolvedValueOnce([{ id: 's1' }] as any);
    vi.mocked(archiveStitch).mockRejectedValueOnce(new Error('Archive failed'));

    const { result } = renderHook(() => useStitchesPage('w1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setArchiveTarget({ id: 's1' } as any);
    });

    await act(async () => {
      await result.current.handleArchiveConfirm();
    });

    expect(result.current.error).toBe('Archive failed');
    expect(result.current.stitches.length).toBe(1);
    expect(result.current.archiving).toBeNull();
  });
});
