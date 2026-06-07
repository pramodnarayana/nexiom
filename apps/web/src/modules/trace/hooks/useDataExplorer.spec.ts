import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDataExplorer, TABS } from './useDataExplorer';
import * as router from 'react-router-dom';
import * as stitchesApi from '@/modules/stitches/api/stitches.api';

vi.mock('react-router-dom', () => ({
  useParams: vi.fn(),
  useNavigate: vi.fn(),
}));

vi.mock('@/modules/stitches/api/stitches.api', () => ({
  listStitches: vi.fn(),
}));

describe('useDataExplorer', () => {
  let mockNavigate: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate = vi.fn();
    vi.spyOn(router, 'useNavigate').mockReturnValue(mockNavigate);
  });

  it('redirects to dashboard if workspaceId is missing', async () => {
    vi.spyOn(router, 'useParams').mockReturnValue({});
    
    renderHook(() => useDataExplorer());

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    });
    expect(stitchesApi.listStitches).not.toHaveBeenCalled();
  });

  it('fetches stitches and initializes correctly when workspaceId is present', async () => {
    vi.spyOn(router, 'useParams').mockReturnValue({ id: 'ws-1' });
    const mockStitches = [{ id: 's1', name: 'Stitch 1' } as any];
    vi.spyOn(stitchesApi, 'listStitches').mockResolvedValue(mockStitches);

    const { result } = renderHook(() => useDataExplorer());

    // Initial state
    expect(result.current.workspaceId).toBe('ws-1');
    expect(result.current.activeTab).toBe('inbound');
    expect(result.current.selectedStitch).toBeNull();
    expect(result.current.isLoadingStitches).toBe(true);
    expect(result.current.activeTabMeta).toEqual(TABS[0]);

    // Wait for fetch
    await waitFor(() => {
      expect(result.current.isLoadingStitches).toBe(false);
    });

    expect(result.current.stitches).toEqual(mockStitches);
    expect(stitchesApi.listStitches).toHaveBeenCalledWith('ws-1');
  });

  it('allows changing active tab and selected stitch', async () => {
    vi.spyOn(router, 'useParams').mockReturnValue({ id: 'ws-1' });
    vi.spyOn(stitchesApi, 'listStitches').mockResolvedValue([]);

    const { result } = renderHook(() => useDataExplorer());

    act(() => {
      result.current.setActiveTab('replica');
    });

    expect(result.current.activeTab).toBe('replica');
    expect(result.current.activeTabMeta.id).toBe('replica');

    const mockStitch = { id: 's2', name: 'Stitch 2' } as any;
    act(() => {
      result.current.setSelectedStitch(mockStitch);
    });

    expect(result.current.selectedStitch).toEqual(mockStitch);
  });

  it('handles API errors gracefully during stitch fetch', async () => {
    vi.spyOn(router, 'useParams').mockReturnValue({ id: 'ws-1' });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(stitchesApi, 'listStitches').mockRejectedValue(new Error('API failed'));

    const { result } = renderHook(() => useDataExplorer());

    await waitFor(() => {
      expect(result.current.isLoadingStitches).toBe(false);
    });

    expect(result.current.stitches).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
    
    consoleSpy.mockRestore();
  });
});
