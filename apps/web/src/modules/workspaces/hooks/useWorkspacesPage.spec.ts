import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWorkspacesPage } from './useWorkspacesPage';
import * as workspacesApi from '../api/workspaces.api';

vi.mock('../api/workspaces.api', () => ({
  listWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));

describe('useWorkspacesPage', () => {
  let mockRefreshWorkspaces: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshWorkspaces = vi.fn();
  });

  it('fetches workspaces on mount and handles loading state', async () => {
    const mockData = [{ id: '1', name: 'WS1', envType: 'PRODUCTION' }] as any;
    vi.mocked(workspacesApi.listWorkspaces).mockResolvedValue(mockData);

    const { result } = renderHook(() => useWorkspacesPage(mockRefreshWorkspaces));

    expect(result.current.loading).toBe(true);
    expect(result.current.workspaces).toEqual([]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.workspaces).toEqual(mockData);
    expect(result.current.error).toBeNull();
  });

  it('handles fetch error', async () => {
    vi.mocked(workspacesApi.listWorkspaces).mockRejectedValue(new Error('Fetch failed'));

    const { result } = renderHook(() => useWorkspacesPage(mockRefreshWorkspaces));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Fetch failed');
    expect(result.current.workspaces).toEqual([]);
  });

  it('handles workspace creation successfully', async () => {
    vi.mocked(workspacesApi.listWorkspaces).mockResolvedValueOnce([]); // Initial fetch
    const mockCreated = { id: '2', name: 'New WS', envType: 'SANDBOX' } as any;
    vi.mocked(workspacesApi.listWorkspaces).mockResolvedValueOnce([mockCreated]); // Fetch after create
    vi.mocked(workspacesApi.createWorkspace).mockResolvedValue(mockCreated);

    const { result } = renderHook(() => useWorkspacesPage(mockRefreshWorkspaces));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setNewName('New WS');
      result.current.setNewEnvType('SANDBOX');
      result.current.setDialogOpen(true);
    });

    await act(async () => {
      await result.current.handleCreate();
    });

    await waitFor(() => {
      expect(result.current.workspaces).toContainEqual(mockCreated);
    });
    expect(workspacesApi.createWorkspace).toHaveBeenCalledWith({ name: 'New WS', envType: 'SANDBOX' });
    expect(result.current.dialogOpen).toBe(false);
    expect(result.current.newName).toBe('');
    expect(result.current.newEnvType).toBe('PRODUCTION');
    expect(mockRefreshWorkspaces).toHaveBeenCalled();
  });

  it('does not create if name is empty', async () => {
    const { result } = renderHook(() => useWorkspacesPage(mockRefreshWorkspaces));
    
    act(() => {
      result.current.setNewName('   ');
    });

    await act(async () => {
      await result.current.handleCreate();
    });

    expect(workspacesApi.createWorkspace).not.toHaveBeenCalled();
  });

  it('handles workspace deletion successfully', async () => {
    const mockWs = { id: '3', name: 'Delete WS' } as any;
    vi.mocked(workspacesApi.listWorkspaces).mockResolvedValueOnce([mockWs]); // Initial fetch
    vi.mocked(workspacesApi.listWorkspaces).mockResolvedValueOnce([]); // Fetch after delete
    vi.mocked(workspacesApi.deleteWorkspace).mockResolvedValue(undefined);

    const { result } = renderHook(() => useWorkspacesPage(mockRefreshWorkspaces));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.workspaces).toContainEqual(mockWs);

    act(() => {
      result.current.setDeleteTarget(mockWs);
    });

    await act(async () => {
      await result.current.handleDeleteConfirm();
    });

    await waitFor(() => {
      expect(result.current.workspaces).not.toContainEqual(mockWs);
    });
    expect(workspacesApi.deleteWorkspace).toHaveBeenCalledWith('3');
    expect(result.current.deleteTarget).toBeNull();
    expect(mockRefreshWorkspaces).toHaveBeenCalled();
  });
});
