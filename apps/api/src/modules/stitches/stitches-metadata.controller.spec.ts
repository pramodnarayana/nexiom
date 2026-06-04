import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  AuthGuard,
  PermissionsGuard,
  type RequestAuthContext,
} from '@soopa/auth';
import { MetadataDiscoveryService } from '@soopa/piece-registry';
import { StitchesMetadataController } from './stitches-metadata.controller.js';

const CONNECTION_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_ID = 'org-abc-123';
const OBJECT_NAME = 'Account';

const mockAuth = {
  user: { organizationId: ORG_ID },
} as unknown as RequestAuthContext;

const mockMetadataDiscovery = {
  describeObjects: vi.fn(),
  describeFields: vi.fn(),
  describeRelatedObjects: vi.fn(),
  describeConfig: vi.fn(),
  countRecords: vi.fn(),
};

describe('StitchesMetadataController', () => {
  let controller: StitchesMetadataController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [StitchesMetadataController],
      providers: [
        { provide: MetadataDiscoveryService, useValue: mockMetadataDiscovery },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(StitchesMetadataController);
    vi.clearAllMocks();
  });

  // ── listObjects ────────────────────────────────────────────────────────────

  describe('listObjects', () => {
    it('delegates to metadataDiscovery.describeObjects with forceRefresh=false when refresh is omitted', async () => {
      const objects = [{ name: 'Account', label: 'Account', queryable: true }];
      mockMetadataDiscovery.describeObjects.mockResolvedValue(objects);

      const result = await controller.listObjects(
        mockAuth,
        CONNECTION_ID,
        undefined,
      );

      expect(result).toBe(objects);
      expect(mockMetadataDiscovery.describeObjects).toHaveBeenCalledWith(
        ORG_ID,
        CONNECTION_ID,
        undefined,
        false,
      );
    });

    it('delegates with forceRefresh=false when refresh is a string other than "true"', async () => {
      mockMetadataDiscovery.describeObjects.mockResolvedValue([]);

      await controller.listObjects(mockAuth, CONNECTION_ID, 'false');

      expect(mockMetadataDiscovery.describeObjects).toHaveBeenCalledWith(
        ORG_ID,
        CONNECTION_ID,
        undefined,
        false,
      );
    });

    it('delegates with forceRefresh=true when refresh="true"', async () => {
      const objects = [{ name: 'Contact', label: 'Contact', queryable: true }];
      mockMetadataDiscovery.describeObjects.mockResolvedValue(objects);

      const result = await controller.listObjects(
        mockAuth,
        CONNECTION_ID,
        'true',
      );

      expect(result).toBe(objects);
      expect(mockMetadataDiscovery.describeObjects).toHaveBeenCalledWith(
        ORG_ID,
        CONNECTION_ID,
        undefined,
        true,
      );
    });
  });

  // ── listFields ─────────────────────────────────────────────────────────────

  describe('listFields', () => {
    it('delegates to metadataDiscovery.describeFields with forceRefresh=false when refresh is omitted', async () => {
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
      mockMetadataDiscovery.describeFields.mockResolvedValue(fields);

      const result = await controller.listFields(
        mockAuth,
        CONNECTION_ID,
        OBJECT_NAME,
        undefined,
      );

      expect(result).toBe(fields);
      expect(mockMetadataDiscovery.describeFields).toHaveBeenCalledWith(
        ORG_ID,
        CONNECTION_ID,
        OBJECT_NAME,
        false,
      );
    });

    it('delegates with forceRefresh=true when refresh="true" — bypasses Redis/DB cache', async () => {
      const fields = [
        {
          name: 'BillingStreet',
          label: 'Billing Street',
          type: 'string',
          filterable: true,
          sortable: true,
          nillable: true,
        },
        {
          name: 'TMS_Type__c',
          label: 'TMS Type',
          type: 'picklist',
          filterable: true,
          sortable: true,
          nillable: true,
        },
      ];
      mockMetadataDiscovery.describeFields.mockResolvedValue(fields);

      const result = await controller.listFields(
        mockAuth,
        CONNECTION_ID,
        OBJECT_NAME,
        'true',
      );

      expect(result).toBe(fields);
      expect(mockMetadataDiscovery.describeFields).toHaveBeenCalledWith(
        ORG_ID,
        CONNECTION_ID,
        OBJECT_NAME,
        true,
      );
    });

    it('delegates with forceRefresh=false when refresh is "1" (only "true" string triggers refresh)', async () => {
      mockMetadataDiscovery.describeFields.mockResolvedValue([]);

      await controller.listFields(mockAuth, CONNECTION_ID, OBJECT_NAME, '1');

      expect(mockMetadataDiscovery.describeFields).toHaveBeenCalledWith(
        ORG_ID,
        CONNECTION_ID,
        OBJECT_NAME,
        false,
      );
    });

    it('forwards the objectName param unmodified', async () => {
      const customObject = 'TransportationProfile__c';
      mockMetadataDiscovery.describeFields.mockResolvedValue([]);

      await controller.listFields(
        mockAuth,
        CONNECTION_ID,
        customObject,
        undefined,
      );

      expect(mockMetadataDiscovery.describeFields).toHaveBeenCalledWith(
        ORG_ID,
        CONNECTION_ID,
        customObject,
        false,
      );
    });
  });

  // ── listRelatedObjects ─────────────────────────────────────────────────────

  describe('listRelatedObjects', () => {
    it('delegates to metadataDiscovery.describeRelatedObjects', async () => {
      const related = [
        {
          objectName: 'Contact',
          relationshipType: '1:N',
          relationField: 'AccountId',
        },
        {
          objectName: 'TransportationProfile__c',
          relationshipType: '1:N',
          relationField: 'Account__c',
        },
      ];
      mockMetadataDiscovery.describeRelatedObjects.mockResolvedValue(related);

      const result = await controller.listRelatedObjects(
        mockAuth,
        CONNECTION_ID,
        OBJECT_NAME,
      );

      expect(result).toBe(related);
      expect(mockMetadataDiscovery.describeRelatedObjects).toHaveBeenCalledWith(
        ORG_ID,
        CONNECTION_ID,
        OBJECT_NAME,
        false,
      );
    });

    it('returns an empty array when the connector does not implement describeRelatedObjects', async () => {
      mockMetadataDiscovery.describeRelatedObjects.mockResolvedValue([]);

      const result = await controller.listRelatedObjects(
        mockAuth,
        CONNECTION_ID,
        'Opportunity',
      );

      expect(result).toEqual([]);
    });
  });

  // ── describeConfig ─────────────────────────────────────────────────────────

  describe('describeConfig', () => {
    it('delegates to metadataDiscovery.describeConfig', async () => {
      const config = [
        {
          name: 'duplicateStrategy',
          label: 'Duplicate Strategy',
          type: 'select',
          description: 'How to handle duplicate records',
          options: [{ label: 'Reject', value: 'reject' }],
          defaultValue: 'reject',
        },
      ];
      mockMetadataDiscovery.describeConfig.mockResolvedValue(config);

      const result = await controller.describeConfig(mockAuth, CONNECTION_ID);

      expect(result).toBe(config);
      expect(mockMetadataDiscovery.describeConfig).toHaveBeenCalledWith(
        ORG_ID,
        CONNECTION_ID,
      );
    });

    it('returns an empty array for connectors without config options', async () => {
      mockMetadataDiscovery.describeConfig.mockResolvedValue([]);

      const result = await controller.describeConfig(mockAuth, CONNECTION_ID);

      expect(result).toEqual([]);
    });
  });

  // ── countRecords ───────────────────────────────────────────────────────────

  describe('countRecords', () => {
    it('delegates to metadataDiscovery.countRecords and returns { count }', async () => {
      mockMetadataDiscovery.countRecords.mockResolvedValue(42);

      const result = await controller.countRecords(
        mockAuth,
        CONNECTION_ID,
        OBJECT_NAME,
      );

      expect(result).toEqual({ count: 42 });
      expect(mockMetadataDiscovery.countRecords).toHaveBeenCalledWith(
        ORG_ID,
        CONNECTION_ID,
        OBJECT_NAME,
      );
    });
  });
});

import { BadRequestException } from '@nestjs/common';
import { ValidateObjectNamePipe } from './stitches-metadata.controller.js';

describe('ValidateObjectNamePipe', () => {
  let pipe: ValidateObjectNamePipe;

  beforeEach(() => {
    pipe = new ValidateObjectNamePipe();
  });

  it('allows valid object names', () => {
    expect(pipe.transform('Account')).toBe('Account');
    expect(pipe.transform('CustomObject__c')).toBe('CustomObject__c');
    expect(pipe.transform('Namespace.Object-Name')).toBe(
      'Namespace.Object-Name',
    );
  });

  it('throws BadRequestException if value is missing', () => {
    expect(() => pipe.transform(undefined as unknown as string)).toThrow(
      BadRequestException,
    );
    expect(() => pipe.transform('')).toThrow(BadRequestException);
  });

  it('throws BadRequestException if value is invalid', () => {
    expect(() => pipe.transform('Invalid Name!')).toThrow(BadRequestException);
    expect(() => pipe.transform('Invalid/Name')).toThrow(BadRequestException);
    expect(() => pipe.transform('Drop Table;')).toThrow(BadRequestException);
  });

  it('allows exactly 256 characters', () => {
    const validName = 'A'.repeat(256);
    expect(pipe.transform(validName)).toBe(validName);
  });

  it('throws BadRequestException for 257 characters', () => {
    const tooLongName = 'A'.repeat(257);
    expect(() => pipe.transform(tooLongName)).toThrow(BadRequestException);
  });
});
