/* eslint-disable @typescript-eslint/require-await */
import { describe, it, expect, beforeEach } from 'vitest';
import { CanonicalMetadataController } from './canonical-metadata.controller.js';
import type { CanonicalSchemaRepositoryPort } from './core/ports/outbound/canonical-schema.repository.port.js';
import type { ObjectDescriptor, FieldDescriptor } from '@soopa/piece-framework';

// We create a lightweight stub of the port for the controller integration test.
// This ensures we test the HTTP delegation without heavy mocking frameworks.
class StubCanonicalSchemaRepository implements CanonicalSchemaRepositoryPort {
  async listObjects(): Promise<ObjectDescriptor[]> {
    return [{ name: 'STUB_OBJECT', label: 'Stub Object', queryable: true }];
  }

  async listFields(objectName: string): Promise<FieldDescriptor[]> {
    if (objectName === 'STUB_OBJECT') {
      return [
        {
          name: 'stub_field',
          label: 'Stub Field',
          type: 'string',
          filterable: true,
          sortable: true,
          nillable: false,
        },
      ];
    }
    return [];
  }
}

describe('CanonicalMetadataController', () => {
  let controller: CanonicalMetadataController;
  let stubPort: CanonicalSchemaRepositoryPort;

  beforeEach(() => {
    stubPort = new StubCanonicalSchemaRepository();
    controller = new CanonicalMetadataController(stubPort);
  });

  describe('listObjects', () => {
    it('should delegate to the port and return objects', async () => {
      const objects = await controller.listObjects();
      expect(objects).toHaveLength(1);
      expect(objects[0]?.name).toBe('STUB_OBJECT');
    });
  });

  describe('listFields', () => {
    it('should delegate to the port and return fields for a known object', async () => {
      const fields = await controller.listFields('STUB_OBJECT');
      expect(fields).toHaveLength(1);
      expect(fields[0]?.name).toBe('stub_field');
    });

    it('should return a fallback id field if the port returns an empty array', async () => {
      const fields = await controller.listFields('UNKNOWN_OBJECT');
      expect(fields).toHaveLength(1);
      expect(fields[0]?.name).toBe('id');
      expect(fields[0]?.label).toBe('Hub ID');
    });
  });
});
