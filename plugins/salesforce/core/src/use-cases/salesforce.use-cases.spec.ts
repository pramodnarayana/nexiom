import { describe, it, expect, beforeEach } from 'vitest';
import { SalesforceUseCases } from './salesforce.use-cases.js';
import { FakeHttpAdapter } from '../adapters/fake-http.adapter.js';
import { SalesforceCredentials } from '../domain/salesforce-credentials.value.js';

describe('SalesforceUseCases', () => {
  let fakeHttp: FakeHttpAdapter;
  let useCases: SalesforceUseCases;
  let creds: SalesforceCredentials;

  beforeEach(() => {
    fakeHttp = new FakeHttpAdapter();
    useCases = new SalesforceUseCases(fakeHttp);
    creds = SalesforceCredentials.fromRecord({
      instance_url: 'https://test.salesforce.com',
      access_token: 'secret-token'
    });
  });

  describe('describeObjects', () => {
    it('returns sorted objects and filters out standard non-queryable objects', async () => {
      fakeHttp.getStub = () => ({
        status: 200,
        headers: {},
        data: {
          sobjects: [
            { name: 'StandardQueryable', label: 'B', queryable: true },
            { name: 'StandardNonQueryable', label: 'C', queryable: false },
            { name: 'Custom__c', label: 'A', queryable: false }
          ]
        }
      });

      const result = await useCases.describeObjects(creds);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Custom__c');
      expect(result[1].name).toBe('StandardQueryable');
    });
  });

  describe('executeFind', () => {
    it('builds SOQL dynamically and fetches results', async () => {
      let requestedUrl = '';
      fakeHttp.getStub = (url) => {
        requestedUrl = url;
        if (url.includes('/describe')) {
          return {
            status: 200,
            headers: {},
            data: { fields: [{ name: 'Name', label: 'Name', type: 'string', filterable: true, sortable: true, nillable: true }] }
          };
        }
        if (url.includes('/sobjects')) {
          return {
            status: 200,
            headers: {},
            data: { sobjects: [{ name: 'Account', label: 'Account', queryable: true }] }
          };
        }
        if (url.includes('/query')) {
          return {
            status: 200,
            headers: {},
            data: { records: [{ Id: '123', Name: 'Acme Corp' }] }
          };
        }
        throw new Error('Unexpected URL');
      };

      const result = await useCases.executeFind(creds, 'Account', { Name: 'Acme Corp' });

      expect(result).toHaveLength(1);
      expect(result[0]['Id']).toBe('123');
      expect(requestedUrl).toContain(encodeURIComponent(`SELECT FIELDS(ALL) FROM Account WHERE Name = 'Acme Corp' LIMIT 20`));
    });

    it('throws if object not found', async () => {
      fakeHttp.getStub = () => ({ status: 200, headers: {}, data: { sobjects: [] } });
      await expect(useCases.executeFind(creds, 'Unknown', { Name: 'A' }))
        .rejects.toThrow('Object not found in metadata dictionary');
    });

    it('throws if object not queryable', async () => {
      fakeHttp.getStub = () => ({ status: 200, headers: {}, data: { sobjects: [{ name: 'Custom__c', queryable: false }] } });
      await expect(useCases.executeFind(creds, 'Custom__c', { Name: 'A' }))
        .rejects.toThrow('is not queryable');
    });

    it('throws if filter is empty', async () => {
      fakeHttp.getStub = () => ({ status: 200, headers: {}, data: { sobjects: [{ name: 'Account', queryable: true }] } });
      await expect(useCases.executeFind(creds, 'Account', {}))
        .rejects.toThrow('requires non-empty filters');
    });

    it('throws if filter key is invalid', async () => {
      fakeHttp.getStub = (url) => {
        if (url.includes('/describe')) return { status: 200, headers: {}, data: { fields: [] } };
        if (url.includes('/sobjects')) return { status: 200, headers: {}, data: { sobjects: [{ name: 'Account', queryable: true }] } };
        throw new Error();
      };
      await expect(useCases.executeFind(creds, 'Account', { Invalid: '1' }))
        .rejects.toThrow('Invalid filter keys for Account');
    });

    it('handles various filter data types', async () => {
      let requestedUrl = '';
      fakeHttp.getStub = (url) => {
        requestedUrl = url;
        if (url.includes('/describe')) {
          return {
            status: 200,
            headers: {},
            data: { fields: [
              { name: 'IsActive', filterable: true },
              { name: 'Count', filterable: true },
              { name: 'NullField', filterable: true }
            ] }
          };
        }
        if (url.includes('/sobjects')) {
          return { status: 200, headers: {}, data: { sobjects: [{ name: 'Account', queryable: true }] } };
        }
        if (url.includes('/query')) {
          return { status: 200, headers: {}, data: { records: [] } };
        }
        throw new Error('Unexpected URL');
      };

      await useCases.executeFind(creds, 'Account', { IsActive: true, Count: 42, NullField: null });

      const decoded = decodeURIComponent(requestedUrl);
      expect(decoded).toContain('IsActive = true');
      expect(decoded).toContain('Count = 42');
      expect(decoded).toContain('NullField = NULL');
    });

    it('throws if filter value has unsupported type', async () => {
      fakeHttp.getStub = (url) => {
        if (url.includes('/describe')) return { status: 200, headers: {}, data: { fields: [{ name: 'Other', filterable: true }] } };
        if (url.includes('/sobjects')) return { status: 200, headers: {}, data: { sobjects: [{ name: 'Account', queryable: true }] } };
        throw new Error();
      };
      await expect(useCases.executeFind(creds, 'Account', { Other: { complex: true } }))
        .rejects.toThrow('Filter value for key "Other" has unsupported type');
    });
  });

  describe('countRecords', () => {
    it('returns the total size from a count query', async () => {
      fakeHttp.getStub = (url) => {
        if (url.includes('/query')) {
          return {
            status: 200,
            headers: {},
            data: { totalSize: 42 }
          };
        }
        throw new Error('Unexpected URL');
      };
      const result = await useCases.countRecords(creds, 'Account');
      expect(result).toBe(42);
    });
  });

  describe('describeStreams', () => {
    it('returns describeObjects as stream descriptors', async () => {
      fakeHttp.getStub = () => ({
        status: 200,
        headers: {},
        data: {
          sobjects: [
            { name: 'Account', label: 'Account', queryable: true }
          ]
        }
      });
      const streams = await useCases.describeStreams(creds);
      expect(streams).toEqual([
        { streamName: 'Account', replicationMethod: 'FULL_TABLE', keyProperties: ['Id'] }
      ]);
    });
  });

  describe('poll', () => {
    // Shared describe stub: poll() calls describeFields() on first-page requests
    // to build the SOQL SELECT field list dynamically.
    const describeStub = (url: string) => {
      if (url.includes('/describe')) {
        return {
          status: 200,
          headers: {},
          data: { fields: [{ name: 'Id', label: 'ID', type: 'id', filterable: true, sortable: true, nillable: false }] },
        };
      }
      return null;
    };

    it('polls records successfully', async () => {
      fakeHttp.getStub = (url) => {
        const described = describeStub(url);
        if (described) return described;
        if (url.includes('/query')) {
          return {
            status: 200,
            headers: {},
            data: {
              records: [{ Id: 'abc', SystemModstamp: '2023-01-01T00:00:00Z' }],
              done: true,
            },
          };
        }
        throw new Error('Unexpected URL');
      };

      const result = await useCases.poll(creds, 'Account', {
        from: '2023-01-01T00:00:00.000Z',
        to: '2023-01-02T00:00:00.000Z',
      });

      expect(result.records).toHaveLength(1);
      expect(result.nextPageCursor).toBeUndefined();
    });

    it('uses native nextRecordsUrl cursor for subsequent pages (no describeFields call)', async () => {
      // When nextPageCursor is provided, poll skips describeFields entirely.
      fakeHttp.getStub = (url) => {
        if (url.includes('/query/next-token')) {
          return {
            status: 200,
            headers: {},
            data: {
              records: [{ Id: 'page2-rec' }],
              done: true,
            },
          };
        }
        throw new Error('Unexpected URL');
      };

      const result = await useCases.poll(
        creds,
        'Account',
        { from: '2023-01-01T00:00:00.000Z', to: '2023-01-02T00:00:00.000Z' },
        { nextRecordsUrl: '/query/next-token' },
      );

      expect(result.records).toHaveLength(1);
      expect(result.nextPageCursor).toBeUndefined();
    });

    it('handles full-page with nextRecordsUrl — sets nextPageCursor', async () => {
      fakeHttp.getStub = (url) => {
        const described = describeStub(url);
        if (described) return described;
        if (url.includes('/query')) {
          return {
            status: 200,
            headers: {},
            data: {
              records: Array.from({ length: 200 }).map((_, i) => ({ Id: `id_${i}` })),
              done: false,
              nextRecordsUrl: '/query/NEXT-TOKEN',
            },
          };
        }
        throw new Error('Unexpected URL');
      };

      const result = await useCases.poll(creds, 'Account', {
        from: '2023-01-01T00:00:00.000Z',
        to: '2023-01-02T00:00:00.000Z',
      });

      expect(result.records).toHaveLength(200);
      expect(result.nextPageCursor).toEqual({ nextRecordsUrl: '/query/NEXT-TOKEN' });
    });

    it('handles full-page terminal case — no nextPageCursor', async () => {
      fakeHttp.getStub = (url) => {
        const described = describeStub(url);
        if (described) return described;
        if (url.includes('/query')) {
          return {
            status: 200,
            headers: {},
            data: {
              records: Array.from({ length: 200 }).map((_, i) => ({ Id: `id_${i}` })),
              done: true,
            },
          };
        }
        throw new Error('Unexpected URL');
      };

      const result = await useCases.poll(creds, 'Account', {
        from: '2023-01-01T00:00:00.000Z',
        to: '2023-01-02T00:00:00.000Z',
      });

      expect(result.records).toHaveLength(200);
      expect(result.nextPageCursor).toBeUndefined();
    });
  });
});
