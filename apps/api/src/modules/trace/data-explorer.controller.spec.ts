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
    expect(() => controller.listInbound(mockNoOrgCtx, 's1', 1, 10)).toThrow(
      BadRequestException,
    );
  });

  it('listInbound should delegate to service', async () => {
    service.listInbound.mockResolvedValue('res');
    expect(await controller.listInbound(mockCtx, 's1', 1, 10, 'ws1')).toBe(
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

  it('listReplica should delegate to service', async () => {
    service.listReplica.mockResolvedValue('res');
    expect(await controller.listReplica(mockCtx, 's1', 1, 10, 'ws1')).toBe(
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

  it('listNormalized should delegate to service', async () => {
    service.listNormalized.mockResolvedValue('res');
    expect(await controller.listNormalized(mockCtx, 's1', 1, 10, 'ws1')).toBe(
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

  it('listEntityMap should delegate to service', async () => {
    service.listEntityMap.mockResolvedValue('res');
    expect(await controller.listEntityMap(mockCtx, 's1', 1, 10, 'ws1')).toBe(
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

  it('listOutbound should delegate to service', async () => {
    service.listOutbound.mockResolvedValue('res');
    expect(await controller.listOutbound(mockCtx, 's1', 1, 10, 'ws1')).toBe(
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
