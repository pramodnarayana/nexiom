import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCreateStitchPage } from './useCreateStitchPage';
import { listWorkspaceConnections } from '@/modules/workspaces/api/workspaces.api';
import { createStitch } from '../api/stitches.api';
import { listObjects, listCanonicalObjects } from '../api/metadata.api';
import { useNavigate } from 'react-router-dom';

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
}));

vi.mock('@/modules/workspaces/api/workspaces.api', () => ({
  listWorkspaceConnections: vi.fn(),
}));

vi.mock('../api/stitches.api', () => ({
  createStitch: vi.fn(),
}));

vi.mock('../api/metadata.api', () => ({
  listObjects: vi.fn(),
  listCanonicalObjects: vi.fn(),
}));

describe('useCreateStitchPage', () => {
  const mockNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useNavigate).mockReturnValue(mockNavigate);
  });

  it('loads connections on mount', async () => {
    vi.mocked(listWorkspaceConnections).mockResolvedValueOnce([{ id: 'c1', displayName: 'Conn 1' } as any]);

    const { result } = renderHook(() => useCreateStitchPage('w1'));

    expect(result.current.connectionsLoading).toBe(true);

    await vi.waitFor(() => {
      expect(result.current.connectionsLoading).toBe(false);
    });

    expect(listWorkspaceConnections).toHaveBeenCalledWith('w1');
    expect(result.current.connections).toEqual([{ id: 'c1', displayName: 'Conn 1' }]);
  });

  it('handles connection changes and loads objects', async () => {
    vi.mocked(listWorkspaceConnections).mockResolvedValueOnce([]);
    vi.mocked(listCanonicalObjects).mockResolvedValueOnce([{ name: 'Obj1' } as any]);

    const { result } = renderHook(() => useCreateStitchPage('w1'));

    act(() => {
      result.current.handleSrcConnectionChange('c1');
    });

    expect(result.current.wizard.srcDataSourceId).toBe('c1');
    expect(result.current.wizard.sourceObjects).toEqual([]);
    expect(result.current.srcObjectsLoading).toBe(true);

    await vi.waitFor(() => {
      expect(result.current.srcObjectsLoading).toBe(false);
    });

    expect(listCanonicalObjects).toHaveBeenCalled();
    expect(result.current.srcObjects).toEqual([{ name: 'Obj1' }]);
  });

  it('handles create stitch', async () => {
    vi.mocked(listWorkspaceConnections).mockResolvedValueOnce([]);
    vi.mocked(createStitch).mockResolvedValueOnce({ id: 'new-stitch' } as any);

    const { result } = renderHook(() => useCreateStitchPage('w1'));

    act(() => {
      result.current.setWizard({
        name: 'New Stitch',
        srcDataSourceId: 'c1',
        sourceObjects: ['Obj1'],
        destDataSourceId: 'c2',
        targetObject: 'Obj2',
        mappingRules: [],
        syncConditions: [],
        config: {},
      });
    });

    await act(async () => {
      await result.current.handleCreate();
    });

    expect(createStitch).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/workspaces/w1/stitches');
  });

  it('handles src and dest object load errors', async () => {
    vi.mocked(listWorkspaceConnections).mockResolvedValueOnce([]);
    vi.mocked(listCanonicalObjects).mockRejectedValueOnce(new Error('Src failure'));
    vi.mocked(listObjects).mockRejectedValueOnce(new Error('Dest failure'));

    const { result } = renderHook(() => useCreateStitchPage('w1'));

    act(() => {
      result.current.handleSrcConnectionChange('c1');
    });

    await vi.waitFor(() => {
      expect(result.current.srcObjectsLoading).toBe(false);
    });
    expect(result.current.srcObjectsError).toBe('Src failure');

    act(() => {
      result.current.handleDestConnectionChange('c2');
    });

    await vi.waitFor(() => {
      expect(result.current.destObjectsLoading).toBe(false);
    });
    expect(result.current.destObjectsError).toBe('Dest failure');
  });

  it('handles handleCreate failure', async () => {
    vi.mocked(listWorkspaceConnections).mockResolvedValueOnce([]);
    vi.mocked(createStitch).mockRejectedValueOnce(new Error('Create failure'));

    const { result } = renderHook(() => useCreateStitchPage('w1'));

    act(() => {
      result.current.setWizard({
        name: 'New Stitch',
        srcDataSourceId: 'c1',
        sourceObjects: ['Obj1'],
        destDataSourceId: 'c2',
        targetObject: 'Obj2',
        mappingRules: [],
        syncConditions: [],
        config: {},
      });
    });

    await act(async () => {
      await result.current.handleCreate();
    });

    expect(result.current.submitting).toBe(false);
    expect(result.current.submitError).toBe('Create failure');
  });

  it('handles mapping changes', () => {
    vi.mocked(listWorkspaceConnections).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useCreateStitchPage('w1'));

    act(() => {
      result.current.handleMappingChange([], [{ field: 'f1', op: 'eq', value: '1', logic: 'AND' }]);
    });

    expect(result.current.wizard.syncConditions.length).toBe(1);
    expect(result.current.wizard.syncConditions[0].field).toBe('f1');
  });
});
