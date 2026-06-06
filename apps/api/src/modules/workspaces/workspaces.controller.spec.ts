import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard, PermissionsGuard } from '@soopa/auth';
import { WorkspacesController } from './workspaces.controller.js';
import { ORG_ID, WS_ID, makeAuth } from './workspace-test-fixtures.js';
import { WorkspaceProvisionerUseCase } from './use-cases/workspace-provisioner.use-case.js';
import { WorkspaceRepository } from './repositories/workspace.repository.js';

const WORKSPACE = {
  id: WS_ID,
  orgId: ORG_ID,
  name: 'Logistics',
  envType: 'PRODUCTION' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('WorkspacesController', () => {
  let controller: WorkspacesController;
  const mockProvisioner = { execute: vi.fn() };
  const mockWorkspaceRepository = {
    findByOrg: vi.fn(),
    findByIdAndOrg: vi.fn(),
    updateWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [WorkspacesController],
      providers: [
        { provide: WorkspaceProvisionerUseCase, useValue: mockProvisioner },
        { provide: WorkspaceRepository, useValue: mockWorkspaceRepository },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(WorkspacesController);
    vi.clearAllMocks();
  });

  it('create — delegates to provisioner', async () => {
    mockProvisioner.execute.mockResolvedValue(WORKSPACE);
    const result = await controller.create(makeAuth(), { name: 'Logistics' });
    expect(result).toBe(WORKSPACE);
    expect(mockProvisioner.execute).toHaveBeenCalledWith(ORG_ID, {
      name: 'Logistics',
    });
  });

  it('list — returns workspaces from repository', async () => {
    mockWorkspaceRepository.findByOrg.mockResolvedValue([WORKSPACE]);
    const result = await controller.list(makeAuth());
    expect(result).toEqual([WORKSPACE]);
    expect(mockWorkspaceRepository.findByOrg).toHaveBeenCalledWith(ORG_ID);
  });

  it('findOne — returns workspace from repository', async () => {
    mockWorkspaceRepository.findByIdAndOrg.mockResolvedValue(WORKSPACE);
    const result = await controller.findOne(makeAuth(), WS_ID);
    expect(result).toBe(WORKSPACE);
    expect(mockWorkspaceRepository.findByIdAndOrg).toHaveBeenCalledWith(
      WS_ID,
      ORG_ID,
    );
  });

  it('findOne — throws NotFoundException if workspace not found', async () => {
    mockWorkspaceRepository.findByIdAndOrg.mockResolvedValue(null);
    await expect(controller.findOne(makeAuth(), WS_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('update — delegates to repository', async () => {
    const updated = { ...WORKSPACE, name: 'Logistics-EU' };
    mockWorkspaceRepository.updateWorkspace.mockResolvedValue(updated);
    const result = await controller.update(makeAuth(), WS_ID, {
      name: 'Logistics-EU',
    });
    expect(result).toBe(updated);
    expect(mockWorkspaceRepository.updateWorkspace).toHaveBeenCalledWith(
      WS_ID,
      ORG_ID,
      { name: 'Logistics-EU' },
    );
  });

  it('update — throws BadRequestException if no updatable fields provided', async () => {
    await expect(controller.update(makeAuth(), WS_ID, {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('update — throws NotFoundException if workspace not found after update', async () => {
    mockWorkspaceRepository.updateWorkspace.mockResolvedValue(null);
    await expect(
      controller.update(makeAuth(), WS_ID, { name: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('update — throws ConflictException on unique violation (23505)', async () => {
    const uniqueErr = Object.assign(new Error('duplicate'), { code: '23505' });
    mockWorkspaceRepository.updateWorkspace.mockRejectedValue(uniqueErr);
    await expect(
      controller.update(makeAuth(), WS_ID, { name: 'Dup' }),
    ).rejects.toThrow(ConflictException);
  });

  it('remove — delegates to repository', async () => {
    mockWorkspaceRepository.deleteWorkspace.mockResolvedValue(WORKSPACE);
    await expect(controller.remove(makeAuth(), WS_ID)).resolves.toBeUndefined();
    expect(mockWorkspaceRepository.deleteWorkspace).toHaveBeenCalledWith(
      WS_ID,
      ORG_ID,
    );
  });

  it('remove — throws NotFoundException if workspace not found', async () => {
    mockWorkspaceRepository.deleteWorkspace.mockResolvedValue(null);
    await expect(controller.remove(makeAuth(), WS_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});
