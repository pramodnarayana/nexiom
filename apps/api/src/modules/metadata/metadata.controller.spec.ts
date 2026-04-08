import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { AuthGuard, PermissionsGuard } from '@nexiom/auth';
import { MetadataController } from './metadata.controller.js';
import { MetadataDiscoveryService } from './metadata-discovery.service.js';
import { ORG_ID, makeAuth } from '../workspaces/workspace-test-fixtures.js';

const CONN_ID = 'conn-uuid-1';

const mockService = {
  describeObjects: vi.fn(),
  describeFields: vi.fn(),
  describeRelatedObjects: vi.fn(),
  describeConfig: vi.fn(),
};

describe('MetadataController', () => {
  let controller: MetadataController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [MetadataController],
      providers: [{ provide: MetadataDiscoveryService, useValue: mockService }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(MetadataController);
    vi.clearAllMocks();
  });

  it('describeObjects — delegates to service with orgId, connectionId, and limit', async () => {
    const objects = [{ name: 'Contact', label: 'Contact', queryable: true }];
    mockService.describeObjects.mockResolvedValue(objects);

    const result = await controller.describeObjects(
      makeAuth(),
      CONN_ID,
      500,
      false,
    );

    expect(result).toBe(objects);
    expect(mockService.describeObjects).toHaveBeenCalledWith(
      ORG_ID,
      CONN_ID,
      500,
      false,
    );
  });

  it('describeObjects — forwards refresh=true to service for cache-busting', async () => {
    const objects = [{ name: 'Account', label: 'Account', queryable: true }];
    mockService.describeObjects.mockResolvedValue(objects);

    const result = await controller.describeObjects(
      makeAuth(),
      CONN_ID,
      500,
      true,
    );

    expect(result).toBe(objects);
    expect(mockService.describeObjects).toHaveBeenCalledWith(
      ORG_ID,
      CONN_ID,
      500,
      true,
    );
  });

  it('describeFields — delegates to service with orgId, connectionId, and objectName', async () => {
    const fields = [
      {
        name: 'Id',
        label: 'ID',
        type: 'string',
        filterable: true,
        sortable: true,
        nillable: false,
      },
    ];
    mockService.describeFields.mockResolvedValue(fields);

    const result = await controller.describeFields(
      makeAuth(),
      CONN_ID,
      'Contact',
    );

    expect(result).toBe(fields);
    expect(mockService.describeFields).toHaveBeenCalledWith(
      ORG_ID,
      CONN_ID,
      'Contact',
    );
  });

  it('describeRelatedObjects — delegates to service with orgId, connectionId, and objectName', async () => {
    const rels = [
      {
        objectName: 'Invoice',
        relationshipType: 'CHILD',
        relationField: 'accId',
      },
    ];
    mockService.describeRelatedObjects.mockResolvedValue(rels);

    const result = await controller.describeRelatedObjects(
      makeAuth(),
      CONN_ID,
      'Account',
    );

    expect(result).toBe(rels);
    expect(mockService.describeRelatedObjects).toHaveBeenCalledWith(
      ORG_ID,
      CONN_ID,
      'Account',
    );
  });

  it('describeConfig — delegates to service with orgId and connectionId', async () => {
    const config = [{ key: 'env', type: 'string' }];
    mockService.describeConfig.mockResolvedValue(config);

    const result = await controller.describeConfig(makeAuth(), CONN_ID);

    expect(result).toBe(config);
    expect(mockService.describeConfig).toHaveBeenCalledWith(ORG_ID, CONN_ID);
  });

  it('validateObjectName — guards against Redis injection by throwing BadRequestException on invalid characters', () => {
    expect(() =>
      controller.describeFields(makeAuth(), CONN_ID, 'Invali@d*Name'),
    ).toThrow('objectName must be 1-255 alphanumeric/underscore characters');

    expect(() =>
      controller.describeRelatedObjects(makeAuth(), CONN_ID, ''),
    ).toThrow('objectName must be 1-255 alphanumeric/underscore characters');
  });
});
