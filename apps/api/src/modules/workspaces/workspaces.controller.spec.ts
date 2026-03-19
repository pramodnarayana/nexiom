import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard, PermissionsGuard } from '@nexiom/auth';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspacesService } from './workspaces.service.js';
import { ORG_ID, WS_ID, makeAuth } from './workspace-test-fixtures.js';

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
  const mockService = {
    create: vi.fn(),
    list: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [WorkspacesController],
      providers: [{ provide: WorkspacesService, useValue: mockService }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(WorkspacesController);
    vi.clearAllMocks();
  });

  it('create — delegates to service', async () => {
    mockService.create.mockResolvedValue(WORKSPACE);
    const result = await controller.create(makeAuth(), { name: 'Logistics' });
    expect(result).toBe(WORKSPACE);
    expect(mockService.create).toHaveBeenCalledWith(ORG_ID, {
      name: 'Logistics',
    });
  });

  it('list — delegates to service', async () => {
    mockService.list.mockResolvedValue([WORKSPACE]);
    const result = await controller.list(makeAuth());
    expect(result).toEqual([WORKSPACE]);
    expect(mockService.list).toHaveBeenCalledWith(ORG_ID);
  });

  it('findOne — delegates to service', async () => {
    mockService.findOne.mockResolvedValue(WORKSPACE);
    const result = await controller.findOne(makeAuth(), WS_ID);
    expect(result).toBe(WORKSPACE);
    expect(mockService.findOne).toHaveBeenCalledWith(ORG_ID, WS_ID);
  });

  it('findOne — propagates NotFoundException from service', async () => {
    mockService.findOne.mockRejectedValue(new NotFoundException());
    await expect(controller.findOne(makeAuth(), WS_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('update — delegates to service', async () => {
    const updated = { ...WORKSPACE, name: 'Logistics-EU' };
    mockService.update.mockResolvedValue(updated);
    const result = await controller.update(makeAuth(), WS_ID, {
      name: 'Logistics-EU',
    });
    expect(result).toBe(updated);
    expect(mockService.update).toHaveBeenCalledWith(ORG_ID, WS_ID, {
      name: 'Logistics-EU',
    });
  });

  it('remove — delegates to service', async () => {
    mockService.remove.mockResolvedValue(undefined);
    await expect(controller.remove(makeAuth(), WS_ID)).resolves.toBeUndefined();
    expect(mockService.remove).toHaveBeenCalledWith(ORG_ID, WS_ID);
  });
});
