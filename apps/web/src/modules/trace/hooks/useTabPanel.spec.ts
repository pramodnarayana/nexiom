import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTabPanel } from './useTabPanel';
import { listInbound, listOutbound, listObjectsByStitch, updateRecord, deleteRecord } from '../api/data-explorer.api';

vi.mock('../api/data-explorer.api', () => ({
  listInbound: vi.fn(),
  listReplica: vi.fn(),
  listNormalized: vi.fn(),
  listEntityMap: vi.fn(),
  listOutbound: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
  listObjectsByStitch: vi.fn(),
}));

vi.mock('@/shared/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('useTabPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const stitch = {
    id: 's1',
    srcDataSourceId: 'src1',
    destDataSourceId: 'dest1'
  } as any;

  it('loads object types and data on mount', async () => {
    vi.mocked(listObjectsByStitch).mockResolvedValueOnce(['Contact', 'Lead']);
    vi.mocked(listInbound).mockResolvedValueOnce({
      data: [{ id: '1', status: 'SUCCESS' }],
      total: 1
    } as any);

    const { result } = renderHook(() => useTabPanel({
      tabId: 'inbound',
      stitch,
      workspaceId: 'w1'
    }));

    expect(result.current.loading).toBe(true);

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.objectTypes).toEqual(['Contact', 'Lead']);
    expect(result.current.objectType).toBe('Contact');
    expect(result.current.result).toEqual({
      data: [{ id: '1', status: 'SUCCESS' }],
      total: 1
    });
  });

  it('handles load error', async () => {
    vi.mocked(listObjectsByStitch).mockResolvedValueOnce([]);
    vi.mocked(listInbound).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useTabPanel({
      tabId: 'inbound',
      stitch,
      workspaceId: 'w1'
    }));

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
  });

  it('changes page and loads new data', async () => {
    vi.mocked(listObjectsByStitch).mockResolvedValueOnce([]);
    vi.mocked(listInbound).mockResolvedValue({
      data: [],
      total: 0
    } as any);

    const { result } = renderHook(() => useTabPanel({
      tabId: 'inbound',
      stitch,
      workspaceId: 'w1'
    }));

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(listInbound).toHaveBeenCalledWith('s1', expect.objectContaining({ page: 1 }));

    await act(async () => {
      result.current.handlePage(2);
    });

    await vi.waitFor(() => {
      expect(listInbound).toHaveBeenCalledWith('s1', expect.objectContaining({ page: 2 }));
    });
    
    expect(result.current.page).toBe(2);
  });

  it('handles apply filters', async () => {
    vi.mocked(listObjectsByStitch).mockResolvedValueOnce([]);
    vi.mocked(listOutbound).mockResolvedValue({ data: [], total: 0 } as any);

    const { result } = renderHook(() => useTabPanel({
      tabId: 'outbound',
      stitch,
      workspaceId: 'w1'
    }));

    act(() => {
      result.current.setFilters({ logic: 'and', rules: [{ field: 'status', operator: 'eq', value: 'ERROR' }] });
    });

    act(() => {
      result.current.handleApplyFilters();
    });

    expect(result.current.appliedFilters.rules.length).toBe(1);
  });

  it('handles update cell', async () => {
    vi.mocked(listObjectsByStitch).mockResolvedValueOnce([]);
    vi.mocked(listInbound).mockResolvedValue({ data: [{ id: '1', status: 'SUCCESS' }], total: 1 } as any);
    vi.mocked(updateRecord).mockResolvedValueOnce({} as any);

    const { result } = renderHook(() => useTabPanel({ tabId: 'inbound', stitch, workspaceId: 'w1' }));
    await vi.waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleUpdateCell({ id: '1', status: 'SUCCESS' }, 'status', 'FAILED');
    });

    expect(updateRecord).toHaveBeenCalledWith('w1', 'src1', 'inbound', '1', { status: 'FAILED' });
    expect(result.current.result?.data[0].status).toBe('FAILED');
  });

  it('handles update cell error', async () => {
    vi.mocked(listObjectsByStitch).mockResolvedValueOnce([]);
    vi.mocked(listInbound).mockResolvedValue({ data: [{ id: '1', status: 'SUCCESS' }], total: 1 } as any);
    vi.mocked(updateRecord).mockRejectedValueOnce(new Error('Update error'));

    const { result } = renderHook(() => useTabPanel({ tabId: 'inbound', stitch, workspaceId: 'w1' }));
    await vi.waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleUpdateCell({ id: '1', status: 'SUCCESS' }, 'status', 'FAILED');
    });

    expect(result.current.result?.data[0].status).toBe('SUCCESS'); // no change
  });

  it('handles save json', async () => {
    vi.mocked(listObjectsByStitch).mockResolvedValueOnce([]);
    vi.mocked(listInbound).mockResolvedValue({ data: [{ id: '1', config: '{}' }], total: 1 } as any);
    vi.mocked(updateRecord).mockResolvedValueOnce({} as any);

    const { result } = renderHook(() => useTabPanel({ tabId: 'inbound', stitch, workspaceId: 'w1' }));
    await vi.waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setEditingJson({ row: { id: '1' }, field: 'config', value: '{}' });
    });

    await act(async () => {
      await result.current.handleSaveJson('{"a": 1}');
    });

    expect(updateRecord).toHaveBeenCalledWith('w1', 'src1', 'inbound', '1', { config: '{"a": 1}' });
    expect(result.current.editingJson).toBeNull();
  });

  it('handles view trace', async () => {
    vi.mocked(listObjectsByStitch).mockResolvedValueOnce([]);
    vi.mocked(listInbound).mockResolvedValue({ data: [], total: 0 } as any);

    const { result } = renderHook(() => useTabPanel({ tabId: 'inbound', stitch, workspaceId: 'w1' }));
    
    act(() => {
      result.current.handleViewTrace({ traceId: 't1' });
    });
    
    expect(result.current.traceToView).toBe('t1');

    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    act(() => {
      result.current.handleViewTrace({ noTrace: true });
    });
    expect(alertSpy).toHaveBeenCalledWith('This record does not have a traceId.');
  });

  it('handles delete', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(listObjectsByStitch).mockResolvedValueOnce([]);
    vi.mocked(listInbound).mockResolvedValue({ data: [], total: 0 } as any);
    vi.mocked(deleteRecord).mockResolvedValueOnce({} as any);

    const { result } = renderHook(() => useTabPanel({ tabId: 'inbound', stitch, workspaceId: 'w1' }));
    
    await act(async () => {
      await result.current.handleDelete({ id: '1' });
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(deleteRecord).toHaveBeenCalledWith('w1', 'src1', 'inbound', '1');
  });
});
