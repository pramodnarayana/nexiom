import {
	AuthenticationType,
	HttpMethod,
	httpClient,
	Property
} from '@soopa/piece-framework';
import type { HttpResponse } from '@soopa/piece-framework';
import { salesforceAuth } from '../auth.js';

export interface SalesforceAuthValue {
	access_token: string;
	data: {
		instance_url: string;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

/** Salesforce REST API version — must match the version in openapi.json. */
export const SF_API_VERSION = 'v59.0';

/**
 * Salesforce Bulk API 2.0 version.
 * Kept separate from SF_API_VERSION because the Bulk API follows its own
 * release cadence and is not always at parity with the REST API version.
 */
export const SF_BULK_API_VERSION = 'v58.0';

/* v8 ignore start */
export const salesforcesCommon = {
	account: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Account',
		required: false,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			const response = await querySalesforceApi<{
				records: { Id: string; Name: string }[];
			}>(
				HttpMethod.GET,
				auth,
				`SELECT Id, Name FROM Account ORDER BY Name LIMIT 100`
			);
			return {
				disabled: false,
				options: response.body.records.map((record) => ({
					label: record.Name,
					value: record.Id,
				})),
			};
		},
	}),
	object: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Object',
		required: true,
		description: 'Select the Object',
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'connect your account first',
					options: [],
				};
			}
			try {
				const options = await getSalesforceObjects(auth);
				const optionsBody = options.body as Record<string, unknown>;
				if (!optionsBody || typeof optionsBody !== 'object') {
					throw new Error('Invalid response body');
				}
				const optionsArray = optionsBody['sobjects'] as Record<string, unknown>[];
				if (!Array.isArray(optionsArray)) {
					throw new Error('sobjects is not an array');
				}
				return {
					disabled: false,
					options: optionsArray
						.map((object) => {
							return {
								label: String(object['label']),
								value: String(object['name']),
							};
						})
						.sort((a: { label: string }, b: { label: string }) =>
							a.label.localeCompare(b.label)
						)
						.filter((object: { label: string }) => !object.label.startsWith('_')),
				};
			} catch {
				return {
					disabled: true,
					placeholder: 'unable to load objects',
					options: [],
				};
			}
		},
	}),
	record: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Record',
		description: 'The record to select. The list shows the 20 most recently created records.',
		required: true,
		refreshers: ['object'],
		options: async ({ auth, object }) => {
			if (!auth || !object) {
				return {
					disabled: true,
					placeholder: 'Select an object first',
					options: [],
				};
			}

			if (!/^[A-Za-z0-9_]+$/.test(object as string)) {
				return {
					disabled: true,
					placeholder: 'Invalid object name',
					options: [],
				};
			}

			try {
				const describeResponse = await getSalesforceFields(
					auth,
					object as string
				);
				const describeBody = describeResponse.body as Record<string, unknown>;
				const fieldsArray = describeBody['fields'] as Record<string, unknown>[];
				const fields = new Set(fieldsArray.map((f) => String(f['name'])));

				let displayField = 'Id';
				if (fields.has('Name')) {
					displayField = 'Name';
				} else if (fields.has('Subject')) {
					displayField = 'Subject';
				} else if (fields.has('Title')) {
					displayField = 'Title';
				}

				const response = await querySalesforceApi<{
					records: { Id: string;[key: string]: unknown }[];
				}>(
					HttpMethod.GET,
					auth,
					`SELECT Id, ${displayField} FROM ${object} ORDER BY CreatedDate DESC LIMIT 20`
				);

				return {
					disabled: false,
					options: response.body.records.map((record) => ({
						label: record[displayField] ?? record.Id,
						value: record.Id,
					})),
				};
			} catch (e) {
				console.error(e);
				const fallbackResponse = await querySalesforceApi<{
					records: { Id: string }[];
				}>(
					HttpMethod.GET,
					auth,
					`SELECT Id FROM ${object} LIMIT 20`
				);
				return {
					disabled: false,
					options: fallbackResponse.body.records.map((record) => ({
						label: record.Id,
						value: record.Id,
					})),
				};
			}
		},
	}),
	recipient: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Recipient',
		required: true,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}

			const contactQuery = `SELECT Id, Name FROM Contact ORDER BY Name LIMIT 50`;
			const leadQuery = `SELECT Id, Name FROM Lead ORDER BY Name LIMIT 50`;

			const [contactsResponse, leadsResponse] = await Promise.all([
				querySalesforceApi<{ records: { Id: string; Name: string }[] }>(
					HttpMethod.GET,
					auth,
					contactQuery
				),
				querySalesforceApi<{ records: { Id: string; Name: string }[] }>(
					HttpMethod.GET,
					auth,
					leadQuery
				),
			]);

			const contactOptions = contactsResponse.body.records.map((record) => ({
				label: `${record.Name} (Contact)`,
				value: record.Id,
			}));

			const leadOptions = leadsResponse.body.records.map((record) => ({
				label: `${record.Name} (Lead)`,
				value: record.Id,
			}));

			return {
				disabled: false,
				options: [...contactOptions, ...leadOptions].sort((a, b) =>
					a.label.localeCompare(b.label)
				),
			};
		},
	}),
	field: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Field',
		description: 'Select the Field',
		required: true,
		refreshers: ['object'],
		options: async ({ auth, object }) => {
			if (auth === undefined || !object) {
				return {
					disabled: true,
					placeholder: 'connect your account first',
					options: [],
				};
			}
			try {
				const options = await getSalesforceFields(
					auth,
					object as string
				);
				const optionsBody = options.body as Record<string, unknown>;
				if (!optionsBody || typeof optionsBody !== 'object') {
					throw new Error('Invalid response body');
				}
				const fieldsArray = optionsBody['fields'] as Record<string, unknown>[];
				if (!Array.isArray(fieldsArray)) {
					throw new Error('fields is not an array');
				}
				return {
					disabled: false,
					options: fieldsArray.map((field) => {
						return {
							label: String(field['label']),
							value: String(field['name']),
						};
					}),
				};
			} catch {
				return {
					disabled: true,
					placeholder: 'could not load fields',
					options: [],
				};
			}
		},
	}),
	campaign: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Campaign',
		required: true,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			const response = await querySalesforceApi<{
				records: { Id: string; Name: string }[];
			}>(
				HttpMethod.GET,
				auth,
				'SELECT Id, Name FROM Campaign ORDER BY Name LIMIT 200'
			);
			return {
				disabled: false,
				options: response.body.records.map((record) => ({
					label: record.Name,
					value: record.Id,
				})),
			};
		},
	}),
	contact: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Contact',
		required: true,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			const response = await querySalesforceApi<{
				records: { Id: string; Name: string; Email?: string }[];
			}>(
				HttpMethod.GET,
				auth,
				'SELECT Id, Name, Email FROM Contact ORDER BY Name LIMIT 200'
			);
			return {
				disabled: false,
				options: response.body.records.map((record) => ({
					label: record.Email ? `${record.Name} — ${record.Email}` : record.Name,
					value: record.Id,
				})),
			};
		},
	}),
	lead: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Lead',
		required: true,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			const response = await querySalesforceApi<{
				records: { Id: string; Name: string }[];
			}>(
				HttpMethod.GET,
				auth,
				'SELECT Id, Name FROM Lead ORDER BY Name LIMIT 200'
			);
			return {
				disabled: false,
				options: response.body.records.map((record) => ({
					label: record.Name,
					value: record.Id,
				})),
			};
		},
	}),
	status: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Status',
		description: "The campaign member status (e.g., 'Sent', 'Responded').",
		required: true,
		refreshers: ['campaign_id'],
		options: async ({ auth, campaign_id }) => {
			if (!auth || !campaign_id) {
				return {
					disabled: true,
					placeholder: 'Select a campaign first',
					options: [],
				};
			}
			// Validate campaign_id to prevent SQL injection (Salesforce IDs are 15-18 alphanumeric characters)
			const campaignIdStr = String(campaign_id);
			if (!/^[a-zA-Z0-9]{15,18}$/.test(campaignIdStr)) {
				return {
					disabled: true,
					placeholder: 'Invalid campaign ID',
					options: [],
				};
			}
			const response = await querySalesforceApi<{
				records: { Label: string }[];
			}>(
				HttpMethod.GET,
				auth,
				`SELECT Label FROM CampaignMemberStatus WHERE CampaignId = '${campaignIdStr}'`
			);
			return {
				disabled: false,
				options: response.body.records.map((record) => ({
					label: record.Label,
					value: record.Label,
				})),
			};
		},
	}),
	leadSource: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Lead Source',
		required: false,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			try {
				const describeResponse = await getSalesforceFields(
					auth,
					'Lead'
				);
				const describeBody = describeResponse.body as Record<string, unknown>;
				const fieldsArray = describeBody['fields'] as Record<string, unknown>[];
				const leadSourceField = fieldsArray.find(
					(field) => field['name'] === 'LeadSource'
				);

				if (!leadSourceField?.['picklistValues']) {
					return {
						disabled: true,
						placeholder: 'Lead Source field not found or not a picklist',
						options: [],
					};
				}

				const picklistValues = leadSourceField['picklistValues'] as Record<string, unknown>[];
				return {
					disabled: false,
					options: picklistValues.map((value) => {
						return {
							label: String(value['label']),
							value: String(value['value']),
						};
					}),
				};
			} catch (e) {
				console.error(e);
				return {
					disabled: true,
					placeholder: "Couldn't fetch lead sources",
					options: [],
				};
			}
		},
	}),
	owner: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Owner',
		description: 'The owner of the task.',
		required: true,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			const response = await querySalesforceApi<{
				records: { Id: string; Name: string }[];
			}>(
				HttpMethod.GET,
				auth,
				'SELECT Id, Name FROM User WHERE IsActive = true ORDER BY Name'
			);
			return {
				disabled: false,
				options: response.body.records.map((record) => ({
					label: record.Name,
					value: record.Id,
				})),
			};
		},
	}),
	opportunity: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Opportunity',
		required: true,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			const response = await querySalesforceApi<{
				records: { Id: string; Name: string }[];
			}>(
				HttpMethod.GET,
				auth,
				'SELECT Id, Name FROM Opportunity ORDER BY CreatedDate DESC LIMIT 100'
			);
			return {
				disabled: false,
				options: response.body.records.map((record) => ({
					label: record.Name,
					value: record.Id,
				})),
			};
		},
	}),
	report: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Report',
		required: true,
		refreshers: [],
		refreshOnSearch: true,
		options: async ({ auth }, { searchValue }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}

			let query = 'SELECT Id, Name FROM Report';

			if (searchValue) {
				// Escape backslashes, single quotes, and LIKE wildcards
				const sanitizedSearch = searchValue
					.replaceAll('\\', '\\\\')
					.replaceAll('\'', '\\\'')
					.replaceAll('%', '\\%')
					.replaceAll('_', '\\_');
				query += ` WHERE Name LIKE '${sanitizedSearch}%'`;
			}

			query += ' ORDER BY Name';

			const response = await querySalesforceApi<{
				records: { Id: string; Name: string }[];
			}>(HttpMethod.GET, auth, query);
			return {
				disabled: false,
				options: response.body.records.map((record) => ({
					label: record.Name,
					value: record.Id,
				})),
			};
		},
	}),
	parentRecord: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Parent Record',
		description:
			'The parent record to find child records for. The list shows the 20 most recently created records.',
		required: true,
		refreshers: ['parent_object'],
		options: async ({ auth, parent_object }) => {
			if (!auth || !parent_object) {
				return {
					disabled: true,
					placeholder: 'Select a parent object first',
					options: [],
				};
			}
			if (!/^[A-Za-z0-9_]+$/.test(parent_object as string)) {
				return {
					disabled: true,
					placeholder: 'Invalid parent object name',
					options: [],
				};
			}
			const response = await querySalesforceApi<{
				records: { Id: string; Name?: string }[];
			}>(
				HttpMethod.GET,
				auth,
				`SELECT Id, Name FROM ${parent_object} ORDER BY CreatedDate DESC LIMIT 20`
			);
			return {
				disabled: false,
				options: response.body.records.map((record) => ({
					label: record.Name ?? record.Id,
					value: record.Id,
				})),
			};
		},
	}),

	childRelationship: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Child Relationship',
		description: 'The child relationship to retrieve records from.',
		required: true,
		refreshers: ['parent_object'],
		options: async ({ auth, parent_object }) => {
			if (!auth || !parent_object) {
				return {
					disabled: true,
					placeholder: 'Select a parent object first',
					options: [],
				};
			}
			try {
				const describeResponse = await getSalesforceFields(
					auth,
					parent_object as string
				);
				const describeBody = describeResponse.body as Record<string, unknown>;
				const relationships = describeBody['childRelationships'] as Record<string, unknown>[];
				if (!relationships) {
					return {
						disabled: true,
						placeholder: 'No child relationships found for this object',
						options: [],
					};
				}
				return {
					disabled: false,
					options: relationships
						.filter((rel) => rel['relationshipName'] && String(rel['relationshipName']).trim() !== '' && rel['childSObject'])
						.map((rel) => ({
							label: `${rel['relationshipName']} (${rel['childSObject']})`,
							value: String(rel['relationshipName']),
						})),
				};
			} catch (e) {
				console.error(e);
				return {
					disabled: true,
					placeholder: "Couldn't fetch child relationships",
					options: [],
				};
			}
		},
	}),
	optionalContact: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Contact',
		required: false,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			const response = await querySalesforceApi<{
				records: { Id: string; Name: string; Email?: string }[];
			}>(
				HttpMethod.GET,
				auth,
				'SELECT Id, Name, Email FROM Contact ORDER BY Name LIMIT 200'
			);
			return {
				disabled: false,
				options: response.body.records.map((record) => ({
					label: record.Email ? `${record.Name} — ${record.Email}` : record.Name,
					value: record.Id,
				})),
			};
		},
	}),
	taskStatus: createSalesforcePicklistDropdown({
		objectName: 'Task',
		fieldName: 'Status',
		displayName: 'Status',
		required: true,
	}),

	taskPriority: createSalesforcePicklistDropdown({
		objectName: 'Task',
		fieldName: 'Priority',
		displayName: 'Priority',
		required: true,
	}),

	caseStatus: createSalesforcePicklistDropdown({
		objectName: 'Case',
		fieldName: 'Status',
		displayName: 'Status',
		required: false,
	}),

	casePriority: createSalesforcePicklistDropdown({
		objectName: 'Case',
		fieldName: 'Priority',
		displayName: 'Priority',
		required: false,
	}),

	caseOrigin: createSalesforcePicklistDropdown({
		objectName: 'Case',
		fieldName: 'Origin',
		displayName: 'Origin',
		required: false,
	}),
	opportunityStage: createSalesforcePicklistDropdown({
		objectName: 'Opportunity',
		fieldName: 'StageName',
		displayName: 'Stage',
		required: true,
	}),
};

function createSalesforcePicklistDropdown(config: {
	objectName: string;
	fieldName: string;
	displayName: string;
	required: boolean;
	description?: string;
}) {
	return Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: config.displayName,
		description: config.description,
		required: config.required,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			try {
				const describeResponse = await getSalesforceFields(
					auth,
					config.objectName
				);
				const describeBody = describeResponse.body as Record<string, unknown>;
				const fieldsArray = describeBody['fields'] as Record<string, unknown>[];
				const field = fieldsArray.find(
					(f) => f['name'] === config.fieldName
				);
				if (!field?.['picklistValues']) {
					return {
						disabled: true,
						placeholder: `${config.fieldName} field not found or not a picklist`,
						options: [],
					};
				}
				const picklistValues = field['picklistValues'] as Record<string, unknown>[];
				return {
					disabled: false,
					options: picklistValues.map((value) => ({
						label: String(value['label']),
						value: String(value['value']),
					})),
				};
			} catch (e) {
				console.error(e);
				return {
					disabled: true,
					placeholder: `Couldn't fetch ${config.fieldName} values`,
					options: [],
				};
			}
		},
	});
}
/* v8 ignore stop */

export async function callSalesforceApi<T>(
	method: HttpMethod,
	authentication: SalesforceAuthValue,
	url: string,
	body: Record<string, unknown> | undefined
): Promise<HttpResponse<T>> {
	return await httpClient.sendRequest<T>({
		method: method,
		url: `${authentication.data['instance_url']}${url}`,
		body,
		authentication: {
			type: AuthenticationType.BEARER_TOKEN,
			token: authentication['access_token'],
		},
	});
}

export async function querySalesforceApi<T>(
	method: HttpMethod,
	authentication: SalesforceAuthValue,
	query: string
): Promise<HttpResponse<T>> {
	return await httpClient.sendRequest<T>({
		method: method,
		url: `${authentication.data['instance_url']}/services/data/${SF_API_VERSION}/query`,
		queryParams: {
			q: query,
		},
		authentication: {
			type: AuthenticationType.BEARER_TOKEN,
			token: authentication['access_token'],
		},
	});
}

export async function createBulkJob<T = unknown>(
	method: HttpMethod,
	authentication: SalesforceAuthValue,
	jobDetails: Record<string, unknown>
): Promise<HttpResponse<T>> {
	return await httpClient.sendRequest<T>({
		method: method,
		url: `${authentication.data['instance_url']}/services/data/${SF_BULK_API_VERSION}/jobs/ingest/`,
		body: jobDetails,
		authentication: {
			type: AuthenticationType.BEARER_TOKEN,
			token: authentication['access_token'],
		},
	});
}

export async function uploadToBulkJob<T>(
	method: HttpMethod,
	authentication: SalesforceAuthValue,
	jobId: string,
	csv: string
): Promise<HttpResponse<T>> {
	return await httpClient.sendRequest<T>({
		method: method,
		url: `${authentication.data['instance_url']}/services/data/${SF_BULK_API_VERSION}/jobs/ingest/${jobId}/batches`,
		headers: {
			'Content-Type': 'text/csv',
		},
		body: csv as unknown,
		authentication: {
			type: AuthenticationType.BEARER_TOKEN,
			token: authentication['access_token'],
		},
	});
}

export async function notifyBulkJobComplete<T>(
	method: HttpMethod,
	authentication: SalesforceAuthValue,
	message: Record<string, unknown>,
	jobId: string
): Promise<HttpResponse<T>> {
	return await httpClient.sendRequest<T>({
		method: method,
		url: `${authentication.data['instance_url']}/services/data/${SF_BULK_API_VERSION}/jobs/ingest/${jobId}`,
		body: message,
		authentication: {
			type: AuthenticationType.BEARER_TOKEN,
			token: authentication['access_token'],
		},
	});
}

export async function getBulkJobInfo<T>(
	method: HttpMethod,
	authentication: SalesforceAuthValue,
	jobId: string
): Promise<HttpResponse<T>> {
	return await httpClient.sendRequest<T>({
		method: method,
		url: `${authentication.data['instance_url']}/services/data/${SF_BULK_API_VERSION}/jobs/ingest/${jobId}`,
		authentication: {
			type: AuthenticationType.BEARER_TOKEN,
			token: authentication['access_token'],
		},
	});
}

/* v8 ignore start */
async function getSalesforceObjects(
	authentication: SalesforceAuthValue
): Promise<HttpResponse<Record<string, unknown>>> {
	return await httpClient.sendRequest<Record<string, unknown>>({
		method: HttpMethod.GET,
		url: `${authentication.data['instance_url']}/services/data/${SF_API_VERSION}/sobjects`,
		authentication: {
			type: AuthenticationType.BEARER_TOKEN,
			token: authentication['access_token'],
		},
	});
}
/* v8 ignore stop */
// Write function to list all fields name inside salesforce object
/* v8 ignore start */
async function getSalesforceFields(
	authentication: SalesforceAuthValue,
	object: string
): Promise<HttpResponse<Record<string, unknown>>> {
	return await httpClient.sendRequest<Record<string, unknown>>({
		method: HttpMethod.GET,
		url: `${authentication.data['instance_url']}/services/data/${SF_API_VERSION}/sobjects/${object}/describe`,
		authentication: {
			type: AuthenticationType.BEARER_TOKEN,
			token: authentication['access_token'],
		},
	});
}
/* v8 ignore stop */
