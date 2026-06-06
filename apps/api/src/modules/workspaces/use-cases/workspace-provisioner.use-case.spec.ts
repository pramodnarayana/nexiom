import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { WorkspaceProvisionerUseCase } from './workspace-provisioner.use-case.js';

describe('WorkspaceProvisionerUseCase', () => {
  let useCase: WorkspaceProvisionerUseCase;
  let mockRepo: { createWorkspace: ReturnType<typeof vi.fn> };

  const WORKSPACE = {
    id: 'ws-1',
    orgId: 'org-1',
    name: 'Dev',
    envType: 'PRODUCTION',
  };

  beforeEach(() => {
    mockRepo = { createWorkspace: vi.fn().mockResolvedValue(WORKSPACE) };
    useCase = new WorkspaceProvisionerUseCase(mockRepo as any);
  });

  it('creates a workspace and returns it', async () => {
    const result = await useCase.execute('org-1', { name: 'Dev' });
    expect(result).toBe(WORKSPACE);
    expect(mockRepo.createWorkspace).toHaveBeenCalledWith('org-1', {
      name: 'Dev',
      envType: 'PRODUCTION',
    });
  });

  it('defaults envType to PRODUCTION when not specified', async () => {
    await useCase.execute('org-1', { name: 'Default' });
    expect(mockRepo.createWorkspace).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ envType: 'PRODUCTION' }),
    );
  });

  it('uses SANDBOX envType when specified', async () => {
    const sandbox = { ...WORKSPACE, envType: 'SANDBOX' };
    mockRepo.createWorkspace.mockResolvedValueOnce(sandbox);

    const result = await useCase.execute('org-1', {
      name: 'Staging',
      envType: 'SANDBOX',
    });

    expect(result).toBe(sandbox);
    expect(mockRepo.createWorkspace).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ envType: 'SANDBOX' }),
    );
  });

  it('throws InternalServerErrorException when repository returns null', async () => {
    mockRepo.createWorkspace.mockResolvedValueOnce(null);
    await expect(useCase.execute('org-1', { name: 'Broken' })).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('throws ConflictException on unique violation (code 23505)', async () => {
    mockRepo.createWorkspace.mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), { code: '23505' }),
    );
    await expect(
      useCase.execute('org-1', { name: 'Duplicate' }),
    ).rejects.toThrow(ConflictException);
  });

  it('re-throws non-unique errors unchanged', async () => {
    mockRepo.createWorkspace.mockRejectedValueOnce(new Error('Database down'));
    await expect(useCase.execute('org-1', { name: 'Bad' })).rejects.toThrow(
      'Database down',
    );
  });
});
