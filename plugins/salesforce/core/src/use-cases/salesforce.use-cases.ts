import { ObjectDescriptor, FieldDescriptor, RelatedObjectDescriptor, StreamDescriptor, PollPage, PollWindow } from '@soopa/piece-framework';
import { VendorHttpPort } from '../ports/vendor-http.port.js';
import { SalesforceCredentials } from '../domain/salesforce-credentials.value.js';

const SF_API_VERSION = 'v59.0';

export class SalesforceUseCases {
  constructor(private readonly http: VendorHttpPort) {}

  async describeObjects(credentials: SalesforceCredentials): Promise<ObjectDescriptor[]> {
    const url = `${credentials.instanceUrl}/services/data/${SF_API_VERSION}/sobjects`;
    
    interface SfSobjectsResponse {
      sobjects: Array<{ name: string; label: string; queryable: boolean }>;
    }
    
    const { data } = await this.http.get<SfSobjectsResponse>(url, {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: 'application/json',
    });

    const filtered = data.sobjects.filter((o) => o.queryable || o.name.endsWith('__c'));

    filtered.sort((a, b) => {
      const aCustom = a.name.endsWith('__c');
      const bCustom = b.name.endsWith('__c');
      if (aCustom !== bCustom) return aCustom ? -1 : 1;
      return a.label.localeCompare(b.label);
    });

    return filtered.map((o) => ({ name: o.name, label: o.label, queryable: o.queryable }));
  }

  async describeFields(credentials: SalesforceCredentials, objectName: string): Promise<FieldDescriptor[]> {
    const url = `${credentials.instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${encodeURIComponent(objectName)}/describe`;
    
    interface SfField {
      name: string;
      label: string;
      type: string;
      filterable: boolean;
      sortable: boolean;
      nillable: boolean;
      referenceTo?: string[];
    }
    interface SfDescribeResponse { fields: SfField[] }
    
    const { data } = await this.http.get<SfDescribeResponse>(url, {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: 'application/json',
    });

    return data.fields.map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type,
      filterable: f.filterable,
      sortable: f.sortable,
      nillable: f.nillable,
      ...(f.referenceTo && f.referenceTo.length ? { referenceTo: f.referenceTo } : {}),
    }));
  }

  async describeRelatedObjects(credentials: SalesforceCredentials, objectName: string): Promise<RelatedObjectDescriptor[]> {
    const url = `${credentials.instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${encodeURIComponent(objectName)}/describe`;
    
    interface SfDescribeResponse {
      childRelationships: Array<{ childSObject: string; field: string; relationshipName: string | null }>;
      fields: Array<{ type: string; referenceTo?: string[]; name: string; label: string }>;
    }
    
    const { data } = await this.http.get<SfDescribeResponse>(url, {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: 'application/json',
    });

    const related: RelatedObjectDescriptor[] = [];

    for (const f of data.fields) {
      if (f.type === 'reference' && f.referenceTo && f.referenceTo.length) {
        for (const ref of f.referenceTo) {
          related.push({ 
            objectName: ref, 
            relationshipType: '1:1', 
            relationField: f.name,
            relationLabel: f.label
          });
        }
      }
    }

    for (const cr of data.childRelationships) {
      related.push({ objectName: cr.childSObject, relationshipType: '1:N', relationField: cr.field });
    }

    const unique = new Map<string, RelatedObjectDescriptor>();
    for (const r of related) {
      const key = `${r.objectName}-${r.relationshipType}-${r.relationField}`;
      if (!unique.has(key)) unique.set(key, r);
    }

    return Array.from(unique.values()).sort((a, b) => a.objectName.localeCompare(b.objectName));
  }

  async countRecords(credentials: SalesforceCredentials, objectName: string): Promise<number> {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectName)) {
      throw new Error(`Invalid Salesforce object name: ${objectName}`);
    }
    const q = encodeURIComponent(`SELECT COUNT() FROM ${objectName}`);
    const url = `${credentials.instanceUrl}/services/data/${SF_API_VERSION}/query?q=${q}`;
    
    interface SfQueryResponse { totalSize: number }
    const { data } = await this.http.get<SfQueryResponse>(url, {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: 'application/json',
    });

    return data.totalSize;
  }

  async describeStreams(credentials: SalesforceCredentials): Promise<StreamDescriptor[]> {
    const objects = await this.describeObjects(credentials);
    return objects.map((o) => ({
      streamName: o.name,
      replicationMethod: 'FULL_TABLE',
      keyProperties: ['Id'],
    }));
  }

  async poll(credentials: SalesforceCredentials, streamName: string, _window: PollWindow, nextPageCursor?: Record<string, unknown>): Promise<PollPage> {
    // Validate streamName to prevent SOQL injection
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(streamName)) {
      throw new Error(`Invalid Salesforce object name: ${streamName}`);
    }

    let soql = `SELECT FIELDS(ALL) FROM ${streamName}`;

    if (nextPageCursor && typeof nextPageCursor['lastId'] === 'string') {
      const lastId = nextPageCursor['lastId'];
      // Validate Salesforce ID format (15 or 18 alphanumeric characters)
      if (!/^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$/.test(lastId)) {
        throw new Error(`Invalid Salesforce ID format: ${lastId}`);
      }
      // Escape any special characters to prevent injection
      const sanitizedId = lastId.replace(/['"\n\r\\]/g, '');
      soql += ` WHERE Id > '${sanitizedId}' ORDER BY Id ASC LIMIT 200`;
    } else {
      soql += ` ORDER BY Id ASC LIMIT 200`;
    }
    
    const q = encodeURIComponent(soql);
    const url = `${credentials.instanceUrl}/services/data/${SF_API_VERSION}/query?q=${q}`;

    interface SfQueryResponse {
      done: boolean;
      records: Record<string, unknown>[];
    }

    const { data } = await this.http.get<SfQueryResponse>(url, {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: 'application/json',
    });

    // Honor Salesforce's done flag and also check record count
    const isComplete = Boolean(data.done) || data.records.length < 200;
    let nextCursor: Record<string, unknown> | undefined;
    if (!isComplete && data.records.length > 0) {
      const lastRecord = data.records[data.records.length - 1];
      nextCursor = { lastId: lastRecord['Id'] };
    }

    return {
      streamName,
      records: data.records.map((r) => ({
        data: r,
        replicationKey: 'Id',
        replicationKeyValue: String(r['Id'] || ''),
      })),
      nextPageCursor: nextCursor,
    };
  }

  async executeFind(
    credentials: SalesforceCredentials, 
    objectType: string, 
    filter: Record<string, unknown>
  ): Promise<Record<string, unknown>[]> {
    const objects = await this.describeObjects(credentials);
    const objectMatch = objects.find((o) => o.name === objectType);
    if (!objectMatch) {
      throw new Error(`Invalid objectType "${objectType}". Object not found in metadata dictionary.`);
    }
    if (!objectMatch.queryable) {
      throw new Error(`Object type "${objectType}" is not queryable. Cannot execute SOQL query against this object.`);
    }

    if (!filter || Object.keys(filter).length === 0) {
      throw new Error(`executeFind requires non-empty filters to prevent broad SELECT queries.`);
    }

    const fields = await this.describeFields(credentials, objectType);
    const validFieldNames = new Set(fields.filter((f) => f.filterable).map((f) => f.name));
    const invalidKeys = Object.keys(filter).filter((k) => !validFieldNames.has(k));
    if (invalidKeys.length > 0) {
      throw new Error(`Invalid filter keys for ${objectType}: ${invalidKeys.join(', ')}. Must match filterable field metadata.`);
    }

    const conditions = Object.entries(filter).map(([k, v]) => {
      if (v === null || v === undefined) {
        return `${k} = NULL`;
      }
      if (typeof v === 'string') {
        const escaped = v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `${k} = '${escaped}'`;
      }
      if (typeof v === 'number' || typeof v === 'boolean') {
        return `${k} = ${v}`;
      }
      const strVal = String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `${k} = '${strVal}'`;
    });
    const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

    const soql = `SELECT FIELDS(ALL) FROM ${objectType}${whereClause} LIMIT 20`;
    const url = `${credentials.instanceUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`;

    interface QueryRes { records: Record<string, unknown>[] }
    const { data } = await this.http.get<QueryRes>(url, {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: 'application/json',
    });
    
    return data.records || [];
  }
}
