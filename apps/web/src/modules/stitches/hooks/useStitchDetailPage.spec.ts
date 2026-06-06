import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStitchDetailPage } from './useStitchDetailPage';
import { getStitch, updateStitch } from '../api/stitches.api';
import { bulkUpsertAndDeleteFieldMappings } from '../api/field-mappings.api';

vi.mock('../api/stitches.api', () => ({
  getStitch: vi.fn(),
  updateStitch: vi.fn(),
}));

vi.mock('../api/field-mappings.api', () => ({
  bulkUpsertAndDeleteFieldMappings: vi.fn(),
}));

vi.mock('@/shared/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('useStitchDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles null id', async () => {
    const { result } = renderHook(() => useStitchDetailPage(undefined));

    expect(result.current.loading).toBe(false);
    expect(result.current.stitch).toBeNull();
    expect(getStitch).not.toHaveBeenCalled();
  });

  it('loads stitch on mount', async () => {
    vi.mocked(getStitch).mockResolvedValueOnce({
      id: 's1',
      name: 'Test Stitch',
      status: 'ACTIVE',
      sourceObject: 'Contact',
      targetObject: 'Lead',
      config: { pollInterval: 60 },
      syncCondition: [],
      fieldMappings: [
        { sourceCanonical: 'Contact', mappingRules: [{ dest: 'name', src: 'name' }] }
      ]
    } as any);

    const { result } = renderHook(() => useStitchDetailPage('s1'));

    expect(result.current.loading).toBe(true);

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.stitch?.name).toBe('Test Stitch');
    expect(result.current.configDraft).toEqual({ pollInterval: 60 });
    expect(result.current.canonicalMappings.length).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('handles load error', async () => {
    vi.mocked(getStitch).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useStitchDetailPage('s1'));

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
  });

  it('handles status toggle', async () => {
    vi.mocked(getStitch).mockResolvedValueOnce({ id: 's1', status: 'ACTIVE', name: 'Test', fieldMappings: [], syncCondition: [], config: {} } as any);
    vi.mocked(updateStitch).mockResolvedValueOnce({ id: 's1', status: 'PAUSED', name: 'Test', fieldMappings: [], syncCondition: [], config: {} } as any);

    const { result } = renderHook(() => useStitchDetailPage('s1'));

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.handleStatusToggle();
    });

    expect(updateStitch).toHaveBeenCalledWith('s1', { status: 'PAUSED' });
    expect(result.current.stitch?.status).toBe('PAUSED');
  });

  it('handles config save', async () => {
    vi.mocked(getStitch).mockResolvedValueOnce({ id: 's1', name: 'Test', fieldMappings: [], syncCondition: [], config: {} } as any);
    vi.mocked(updateStitch).mockResolvedValueOnce({ id: 's1', name: 'Test', fieldMappings: [], syncCondition: [], config: { newProp: 1 } } as any);

    const { result } = renderHook(() => useStitchDetailPage('s1'));

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setConfigDraft({ newProp: 1 });
    });

    expect(result.current.isConfigDirty).toBe(true);

    await act(async () => {
      await result.current.handleConfigSave();
    });

    expect(updateStitch).toHaveBeenCalledWith('s1', { config: { newProp: 1 } });
    expect(result.current.isConfigDirty).toBe(false);
  });

  it('handles name save', async () => {
    vi.mocked(getStitch).mockResolvedValueOnce({ id: 's1', name: 'Old Name', fieldMappings: [], syncCondition: [], config: {} } as any);
    vi.mocked(updateStitch).mockResolvedValueOnce({ id: 's1', name: 'New Name', fieldMappings: [], syncCondition: [], config: {} } as any);

    const { result } = renderHook(() => useStitchDetailPage('s1'));

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.startEditingName();
    });

    expect(result.current.editingName).toBe(true);

    act(() => {
      result.current.setNameDraft('New Name');
    });

    await act(async () => {
      await result.current.handleNameSave();
    });

    expect(updateStitch).toHaveBeenCalledWith('s1', { name: 'New Name' });
    expect(result.current.stitch?.name).toBe('New Name');
    expect(result.current.editingName).toBe(false);
  });

  it('handles mapping changes and save', async () => {
    vi.mocked(getStitch)
      .mockResolvedValueOnce({
        id: 's1',
        name: 'Test',
        config: {},
        syncCondition: [],
        fieldMappings: [{ sourceCanonical: 'Contact', mappingRules: [] }]
      } as any)
      .mockResolvedValueOnce({
        id: 's1',
        name: 'Test',
        config: {},
        syncCondition: [],
        fieldMappings: [{ sourceCanonical: 'Contact', mappingRules: [{ dest: 'name', src: 'name' }] }]
      } as any);
    vi.mocked(bulkUpsertAndDeleteFieldMappings).mockResolvedValueOnce([] as any);

    const { result } = renderHook(() => useStitchDetailPage('s1'));

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.handleMappingChange(
        [{ sourceCanonical: 'Contact', mappingRules: [{ dest: 'name', src: 'name' }] }],
        []
      );
    });

    expect(result.current.mappingsDirty).toBe(true);

    await act(async () => {
      await result.current.handleMappingSave();
    });

    expect(bulkUpsertAndDeleteFieldMappings).toHaveBeenCalledWith('s1', {
      toUpsert: [{ sourceCanonical: 'Contact', mappingRules: [{ dest: 'name', src: 'name' }] }],
      toDelete: []
    });
    expect(result.current.mappingsDirty).toBe(false);
  });
});
