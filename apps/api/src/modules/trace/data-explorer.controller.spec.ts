/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { DataExplorerController } from './data-explorer.controller.js';
import { DataExplorerService } from './data-explorer.service.js';
import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestAuthContext } from '@nexiom/auth';
import { AuthGuard } from '@nexiom/auth';

describe('DataExplorerController', () => {
  let controller: DataExplorerController;
  let service: any;

  beforeEach(async () => {
    service = {
      listInbound: vi.fn(),
      listReplica: vi.fn(),
      listNormalized: vi.fn(),
      listEntityMap: vi.fn(),
      listOutbound: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DataExplorerController],
      providers: [{ provide: DataExplorerService, useValue: service }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DataExplorerController>(DataExplorerController);
  });

  const mockCtx = {
    user: { organizationId: 'org_1' },
  } as RequestAuthContext;

  const mockNoOrgCtx = {} as RequestAuthContext;

  it('should throw BadRequestException if org is missing', async () => {
    await expect(controller.listByTab(mockNoOrgCtx, 's1', 'inbound', 1, 10)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('listByTab(inbound) should delegate to service.listInbound', async () => {
    service.listInbound.mockResolvedValue('res');
    expect(await controller.listByTab(mockCtx, 's1', 'inbound', 1, 10, 'ws1')).toBe(
      'res',
    );
    expect(service.listInbound).toHaveBeenCalledWith(
      'org_1',
      's1',
      1,
      10,
      'ws1',
    );
  });

  it('listByTab(replica) should delegate to service.listReplica', async () => {
    service.listReplica.mockResolvedValue('res');
    expect(await controller.listByTab(mockCtx, 's1', 'replica', 1, 10, 'ws1')).toBe(
      'res',
    );
    expect(service.listReplica).toHaveBeenCalledWith(
      'org_1',
      's1',
      1,
      10,
      'ws1',
    );
  });

  it('listByTab(normalized) should delegate to service.listNormalized', async () => {
    service.listNormalized.mockResolvedValue('res');
    expect(await controller.listByTab(mockCtx, 's1', 'normalized', 1, 10, 'ws1')).toBe(
      'res',
    );
    expect(service.listNormalized).toHaveBeenCalledWith(
      'org_1',
      's1',
      1,
      10,
      'ws1',
    );
  });

  it('listByTab(entity-map) should delegate to service.listEntityMap', async () => {
    service.listEntityMap.mockResolvedValue('res');
    expect(await controller.listByTab(mockCtx, 's1', 'entity-map', 1, 10, 'ws1')).toBe(
      'res',
    );
    expect(service.listEntityMap).toHaveBeenCalledWith(
      'org_1',
      's1',
      1,
      10,
      'ws1',
    );
  });

  it('listByTab(outbound) should delegate to service.listOutbound', async () => {
    service.listOutbound.mockResolvedValue('res');
    expect(await controller.listByTab(mockCtx, 's1', 'outbound', 1, 10, 'ws1')).toBe(
      'res',
    );
    expect(service.listOutbound).toHaveBeenCalledWith(
      'org_1',
      's1',
      1,
      10,
      'ws1',
    );
  });
});