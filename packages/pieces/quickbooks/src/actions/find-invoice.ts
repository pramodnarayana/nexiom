import {
	createAction,
	Property,
	HttpMethod,
	httpClient,
	AuthenticationType
} from '@nexiom/connections/framework';
import { quickbooksAuth } from '../index';
import { quickbooksCommon, QuickbooksEntityResponse } from '../lib/common';

interface QuickBooksRef {
	value: string;
	name?: string;
}

interface QuickBooksAddress {
	Id?: string;
	Line1?: string;
	Line2?: string;
	Line3?: string;
	Line4?: string;
	Line5?: string;
	City?: string;
	Country?: string;
	CountrySubDivisionCode?: string;
	PostalCode?: string;
	Lat?: string;
	Long?: string;
	Tag?: string;
	PostalCodeSuffix?: string;
}

interface QuickBooksCustomField {
	DefinitionId: string;
	Name?: string;
	Type: string;
	StringValue?: string;
}

interface QuickBooksLinkedTxn {
	TxnId: string;
	TxnType: string;
}

interface QuickBooksTaxLineDetail {
	NetAmountTaxable?: number;
	TaxPercent?: number;
	TaxRateRef?: QuickBooksRef;
	PercentBased?: boolean;
}

interface QuickBooksTaxLine {
	DetailType: string;
	Amount?: number;
	TaxLineDetail?: QuickBooksTaxLineDetail;
}

interface QuickBooksInvoice {
	Id: string;
	SyncToken: string;
	MetaData?: {
		CreateTime: string;
		LastUpdatedTime: string;
	};
	CustomField?: QuickBooksCustomField[];
	DocNumber?: string;
	TxnDate?: string;
	domain?: string;
	sparse?: boolean;
	CustomerRef: QuickBooksRef;
	ProjectRef?: QuickBooksRef;
	SalesTermRef?: QuickBooksRef;
	BillEmail?: {
		Address: string;
	};
	TotalAmt?: number;
	CurrencyRef?: QuickBooksRef;
	LinkedTxn?: QuickBooksLinkedTxn[];
	Line: QuickBooksInvoiceLine[];
	TxnTaxDetail?: {
		TxnTaxCodeRef?: QuickBooksRef;
		TotalTax?: number;
		TaxLine?: QuickBooksTaxLine[];
	};
	DueDate?: string;
	Balance?: number;
	Deposit?: number;
	ApplyTaxAfterDiscount?: boolean;
	PrintStatus?: string;
	EmailStatus?: string;
	ShipAddr?: QuickBooksAddress;
	BillAddr?: QuickBooksAddress;
	CustomerMemo?: { value: string };
}

interface QuickBooksInvoiceLine {
	Id?: string;
	LineNum?: number;
	Description?: string;
	Amount: number;
	DetailType: string;
	SalesItemLineDetail?: {
		ItemRef: QuickBooksRef;
		TaxCodeRef?: QuickBooksRef;
		UnitPrice?: number;
		Qty?: number;
	};
	SubTotalLineDetail?: {
		ItemRef?: QuickBooksRef;
	};
}

export const findInvoiceAction = createAction({
	auth: quickbooksAuth,
	name: 'find_invoice',
	displayName: 'Find Invoice',
	description: 'Search for an invoice by its number in QuickBooks.',
	props: {
		invoice_number: Property.ShortText({
			displayName: 'Invoice Number',
			description: 'The document number (DocNumber) of the invoice to search for.',
			required: true,
		}),
	},
	async run(context) {
		const { invoice_number } = context.propsValue;
		const companyId = context.auth.props?.['companyId'];

		if (!companyId) {
			throw new Error('Realm ID not found in authentication data. Please reconnect your account.');
		}

		const apiUrl = quickbooksCommon.getApiUrl(companyId as string);
		const query = `SELECT * FROM Invoice WHERE DocNumber = '${invoice_number.replaceAll(
			'\'',
			String.raw`\'`,
		)}' MAXRESULTS 1`;

		const response = await httpClient.sendRequest<QuickbooksEntityResponse<QuickBooksInvoice>>({
			method: HttpMethod.GET,
			url: `${apiUrl}/query`,
			queryParams: {
				query: query,
				minorversion: '70',
			},
			authentication: {
				type: AuthenticationType.BEARER_TOKEN,
				token: context.auth.access_token,
			},
			headers: {
				Accept: 'application/json',
			},
		});

		const invoices = response.body?.QueryResponse?.['Invoice'] as QuickBooksInvoice[] | undefined;
		if (
			invoices &&
			invoices.length > 0
		) {
			return {
				found: true,
				result: invoices[0],
			};
		}

		return {
			found: false,
			result: {},
		};
	},
});
