import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useConnectionTabPanel } from './useConnectionTabPanel';
import { listConnectionInbound, listConnectionOutbound, updateRecord, deleteRecord } from '../api/data-explorer.api';
import { listObjects } from '@/modules/stitches/api/metadata.api';

vi.mock('../api/data-explorer.api', () => ({
  listConnectionInbound: vi.fn(),
  listConnectionReplica: vi.fn(),
  listConnectionNormalized: vi.fn(),
  listConnectionOutbound: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
}));

vi.mock('@/modules/stitches/api/metadata.api', () => ({
  listObjects: vi.fn(),
}));

vi.mock('@/shared/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('useConnectionTabPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });



  it('loads data on mount', async () => {
    vi.mocked(listConnectionInbound).mockResolvedValueOnce({
      data: [{ id: '1', status: 'SUCCESS' }],
      total: 1
    } as any);

    const { result } = renderHook(() => useConnectionTabPanel({
      tabId: 'inbound',
      connectionId: 'conn1',
      workspaceId: 'w1'
    }));

    expect(result.current.loading).toBe(true);

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.result).toEqual({
      data: [{ id: '1', status: 'SUCCESS' }],
      total: 1
    });
  });

  it('handles load error', async () => {
    vi.mocked(listConnectionInbound).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useConnectionTabPanel({
      tabId: 'inbound',
      connectionId: 'conn1',
      workspaceId: 'w1'
    }));

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
  });

  it('changes page and loads new data', async () => {
    vi.mocked(listObjects).mockResolvedValueOnce([{ name: 'Contact' }] as any);
    vi.mocked(listConnectionInbound).mockResolvedValue({
      data: [],
      total: 0
    } as any);

    const { result } = renderHook(() => useConnectionTabPanel({
      tabId: 'inbound',
      workspaceId: 'w1',
      connectionId: 'conn1'
    }));

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(listConnectionInbound).toHaveBeenCalledWith('conn1', expect.objectContaining({ page: 1 }));

    await act(async () => {
      await result.current.handlePage(2);
    });

    await vi.waitFor(() => {
      expect(listConnectionInbound).toHaveBeenCalledWith('conn1', expect.objectContaining({ page: 2 }));
    });
    
    expect(result.current.page).toBe(2);
  });

  it('handles apply filters', async () => {
    vi.mocked(listObjects).mockResolvedValueOnce([{ name: 'Contact' }] as any);
    vi.mocked(listConnectionOutbound).mockResolvedValue({ data: [], total: 0 } as any);

    const { result } = renderHook(() => useConnectionTabPanel({
      tabId: 'outbound',
      workspaceId: 'w1',
      connectionId: 'c1'
    }));

    act(() => {
      result.current.setFilters({ logic: 'and', rules: [{ field: 'status', operator: 'eq', value: 'ERROR' }] });
    });

    act(() => {
      result.current.handleApplyFilters();
    });

    expect(result.current.appliedFilters.rules.length).toBe(1);
  });

  it('handles save json and errors', async () => {
    vi.mocked(listObjects).mockResolvedValueOnce([{ name: 'Contact' }] as any);
    vi.mocked(listConnectionOutbound).mockResolvedValue({ data: [{ id: '1', config: '{}' }], total: 1 } as any);
    vi.mocked(updateRecord).mockResolvedValueOnce({} as any);

    const { result } = renderHook(() => useConnectionTabPanel({
      tabId: 'outbound',
      workspaceId: 'w1',
      connectionId: 'c1'
    }));
    await vi.waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setEditingJson({ row: { id: '1' }, field: 'config', value: '{}' });
    });

    await act(async () => {
      await result.current.handleSaveJson('{"a": 1}');
    });

    expect(updateRecord).toHaveBeenCalledWith('w1', 'c1', 'outbound', '1', { config: '{"a": 1}' });
    expect(result.current.editingJson).toBeNull();
  });

  it('handles update cell and errors', async () => {
    vi.mocked(listObjects).mockResolvedValueOnce([{ name: 'Contact' }] as any);
    vi.mocked(listConnectionInbound).mockResolvedValue({ data: [{ id: '1', status: 'SUCCESS' }], total: 1 } as any);
    vi.mocked(updateRecord).mockRejectedValueOnce(new Error('Update error'));

    const { result } = renderHook(() => useConnectionTabPanel({
      tabId: 'inbound',
      workspaceId: 'w1',
      connectionId: 'c1'
    }));
    await vi.waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleUpdateCell({ id: '1', status: 'SUCCESS' }, 'status', 'FAILED');
    });

    expect(result.current.result?.data[0].status).toBe('SUCCESS'); // no change
  });

  it('handles delete', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(listObjects).mockResolvedValueOnce([{ name: 'Contact' }] as any);
    vi.mocked(listConnectionInbound).mockResolvedValue({ data: [], total: 0 } as any);
    vi.mocked(deleteRecord).mockResolvedValueOnce({} as any);

    const { result } = renderHook(() => useConnectionTabPanel({
      tabId: 'inbound',
      workspaceId: 'w1',
      connectionId: 'c1'
    }));
    
    await act(async () => {
      await result.current.handleDelete({ id: '1' });
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(deleteRecord).toHaveBeenCalledWith('w1', 'c1', 'inbound', '1');
  });

  it('handles delete errors', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.mocked(listObjects).mockResolvedValueOnce([{ name: 'Contact' }] as any);
    vi.mocked(listConnectionInbound).mockResolvedValue({ data: [], total: 0 } as any);
    vi.mocked(deleteRecord).mockRejectedValueOnce(new Error('Delete error'));

    const { result } = renderHook(() => useConnectionTabPanel({
      tabId: 'inbound',
      workspaceId: 'w1',
      connectionId: 'c1'
    }));
    
    await act(async () => {
      await result.current.handleDelete({ id: '1' });
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Delete error');
  });
});
