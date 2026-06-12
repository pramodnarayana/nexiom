import {
  createPiece,
  createCustomApiCallAction,
  PieceCategory,
  type ObjectDescriptor,
  type FieldDescriptor,
  type NormalizedRecord,
  type VendorResponse,
  type ConfigOption,
  type RelatedObjectDescriptor,
} from '@soopa/piece-framework';
import { quickbooksAuth } from './lib/auth.js';
import { quickbooksCommon, resolveEnvironment } from './lib/common.js';
import { quickbooksUniversalTrigger } from './triggers/universal-trigger.js';
import { NativeFetchAdapter, QuickBooksFetchError } from './adapters/native-fetch.adapter.js';
import type { QuickBooksAuth } from './triggers/quickbooks-polling.helper.js';

const httpAdapter = new NativeFetchAdapter();

// ── QuickBooks metadata (no describe API — schemas are stable and well-documented) ─────

// Core transactional and list entities supported by the QuickBooks Online v3 API.
/* v8 ignore start */
const QB_OBJECTS: ObjectDescriptor[] = [
  { name: 'Customer', label: 'Customer', queryable: true },
  { name: 'Vendor', label: 'Vendor', queryable: true },
  { name: 'Employee', label: 'Employee', queryable: true },
  { name: 'Item', label: 'Item (Product/Service)', queryable: true },
  { name: 'Invoice', label: 'Invoice', queryable: true },
  { name: 'Bill', label: 'Bill', queryable: true },
  { name: 'Payment', label: 'Payment', queryable: true },
  { name: 'BillPayment', label: 'Bill Payment', queryable: true },
  { name: 'Estimate', label: 'Estimate', queryable: true },
  { name: 'CreditMemo', label: 'Credit Memo', queryable: true },
  { name: 'SalesReceipt', label: 'Sales Receipt', queryable: true },
  { name: 'PurchaseOrder', label: 'Purchase Order', queryable: true },
  { name: 'Purchase', label: 'Purchase (Expense)', queryable: true },
  { name: 'JournalEntry', label: 'Journal Entry', queryable: true },
  { name: 'Account', label: 'Account (Chart of Accounts)', queryable: true },
  { name: 'TaxCode', label: 'Tax Code', queryable: true },
  { name: 'Term', label: 'Payment Term', queryable: true },
];

// Field schemas keyed by entity name.
const QB_FIELDS: Record<string, FieldDescriptor[]> = {
  Customer: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'DisplayName', label: 'Display Name', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'GivenName', label: 'First Name', type: 'string', filterable: true, sortable: true, nillable: true },
    { name: 'FamilyName', label: 'Last Name', type: 'string', filterable: true, sortable: true, nillable: true },
    { name: 'CompanyName', label: 'Company Name', type: 'string', filterable: true, sortable: true, nillable: true },
    { name: 'PrimaryEmailAddr', label: 'Email', type: 'string', filterable: true, sortable: false, nillable: true },
    // BillAddr sub-fields
    { name: 'BillAddr.Line1', label: 'Billing Address Line 1', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'BillAddr.Line2', label: 'Billing Address Line 2', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'BillAddr.City', label: 'Billing City', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'BillAddr.CountrySubDivisionCode', label: 'Billing State / Province', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'BillAddr.PostalCode', label: 'Billing Postal Code', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'BillAddr.Country', label: 'Billing Country', type: 'string', filterable: false, sortable: false, nillable: true },
    // ShipAddr sub-fields
    { name: 'ShipAddr.Line1', label: 'Shipping Address Line 1', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'ShipAddr.Line2', label: 'Shipping Address Line 2', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'ShipAddr.City', label: 'Shipping City', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'ShipAddr.CountrySubDivisionCode', label: 'Shipping State / Province', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'ShipAddr.PostalCode', label: 'Shipping Postal Code', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'ShipAddr.Country', label: 'Shipping Country', type: 'string', filterable: false, sortable: false, nillable: true },
    // Phone / Fax (removed top-level 'PrimaryPhone' that conflicts with 'PrimaryPhone.FreeFormNumber')
    { name: 'PrimaryPhone.FreeFormNumber', label: 'Phone Number', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'Fax.FreeFormNumber', label: 'Fax Number', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'Balance', label: 'Balance', type: 'currency', filterable: true, sortable: true, nillable: true },
    { name: 'Active', label: 'Active', type: 'boolean', filterable: true, sortable: false, nillable: false },
    { name: 'MetaData.CreateTime', label: 'Created At', type: 'datetime', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.LastUpdatedTime', label: 'Updated At', type: 'datetime', filterable: true, sortable: true, nillable: false },
  ],
  Vendor: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'DisplayName', label: 'Display Name', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'GivenName', label: 'First Name', type: 'string', filterable: true, sortable: true, nillable: true },
    { name: 'FamilyName', label: 'Last Name', type: 'string', filterable: true, sortable: true, nillable: true },
    { name: 'CompanyName', label: 'Company Name', type: 'string', filterable: true, sortable: true, nillable: true },
    { name: 'PrimaryEmailAddr', label: 'Email', type: 'string', filterable: true, sortable: false, nillable: true },
    // BillAddr sub-fields (used as the primary address on Vendor records)
    { name: 'BillAddr.Line1', label: 'Billing Address Line 1', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'BillAddr.Line2', label: 'Billing Address Line 2', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'BillAddr.City', label: 'Billing City', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'BillAddr.CountrySubDivisionCode', label: 'Billing State / Province', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'BillAddr.PostalCode', label: 'Billing Postal Code', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'BillAddr.Country', label: 'Billing Country', type: 'string', filterable: false, sortable: false, nillable: true },
    // ShipAddr sub-fields (added missing Line2 and Country)
    { name: 'ShipAddr.Line1', label: 'Shipping Address Line 1', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'ShipAddr.Line2', label: 'Shipping Address Line 2', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'ShipAddr.City', label: 'Shipping City', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'ShipAddr.CountrySubDivisionCode', label: 'Shipping State / Province', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'ShipAddr.PostalCode', label: 'Shipping Postal Code', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'ShipAddr.Country', label: 'Shipping Country', type: 'string', filterable: false, sortable: false, nillable: true },
    // Phone / Fax
    { name: 'PrimaryPhone.FreeFormNumber', label: 'Phone Number', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'Fax.FreeFormNumber', label: 'Fax Number', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'Balance', label: 'Balance', type: 'currency', filterable: true, sortable: true, nillable: true },
    { name: 'Active', label: 'Active', type: 'boolean', filterable: true, sortable: false, nillable: false },
    { name: 'MetaData.CreateTime', label: 'Created At', type: 'datetime', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.LastUpdatedTime', label: 'Updated At', type: 'datetime', filterable: true, sortable: true, nillable: false },
  ],
  Employee: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'DisplayName', label: 'Display Name', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'GivenName', label: 'First Name', type: 'string', filterable: true, sortable: true, nillable: true },
    { name: 'FamilyName', label: 'Last Name', type: 'string', filterable: true, sortable: true, nillable: true },
    { name: 'PrimaryEmailAddr', label: 'Email', type: 'string', filterable: true, sortable: false, nillable: true },
    { name: 'Active', label: 'Active', type: 'boolean', filterable: true, sortable: false, nillable: false },
    { name: 'MetaData.CreateTime', label: 'Created At', type: 'datetime', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.LastUpdatedTime', label: 'Updated At', type: 'datetime', filterable: true, sortable: true, nillable: false },
  ],
  Item: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'Name', label: 'Name', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'Description', label: 'Description', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'Type', label: 'Type', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'UnitPrice', label: 'Unit Price', type: 'currency', filterable: true, sortable: true, nillable: true },
    { name: 'PurchaseCost', label: 'Purchase Cost', type: 'currency', filterable: true, sortable: true, nillable: true },
    { name: 'Active', label: 'Active', type: 'boolean', filterable: true, sortable: false, nillable: false },
    { name: 'MetaData.CreateTime', label: 'Created At', type: 'datetime', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.LastUpdatedTime', label: 'Updated At', type: 'datetime', filterable: true, sortable: true, nillable: false },
  ],
  Invoice: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'DocNumber', label: 'Invoice Number', type: 'string', filterable: true, sortable: true, nillable: true },
    { name: 'TxnDate', label: 'Transaction Date', type: 'date', filterable: true, sortable: true, nillable: false },
    { name: 'DueDate', label: 'Due Date', type: 'date', filterable: true, sortable: true, nillable: true },
    { name: 'CustomerRef.value', label: 'Customer ID', type: 'reference', filterable: true, sortable: true, nillable: false, referenceTo: ['Customer'] },
    { name: 'CustomerRef.name', label: 'Customer Name', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'TotalAmt', label: 'Total Amount', type: 'currency', filterable: true, sortable: true, nillable: false },
    { name: 'Balance', label: 'Balance Due', type: 'currency', filterable: true, sortable: true, nillable: false },
    { name: 'EmailStatus', label: 'Email Status', type: 'string', filterable: true, sortable: false, nillable: true },
    { name: 'MetaData.CreateTime', label: 'Created At', type: 'datetime', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.LastUpdatedTime', label: 'Updated At', type: 'datetime', filterable: true, sortable: true, nillable: false },
  ],
  Bill: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'DocNumber', label: 'Reference Number', type: 'string', filterable: true, sortable: true, nillable: true },
    { name: 'TxnDate', label: 'Transaction Date', type: 'date', filterable: true, sortable: true, nillable: false },
    { name: 'DueDate', label: 'Due Date', type: 'date', filterable: true, sortable: true, nillable: true },
    { name: 'VendorRef.value', label: 'Vendor ID', type: 'reference', filterable: true, sortable: true, nillable: false, referenceTo: ['Vendor'] },
    { name: 'VendorRef.name', label: 'Vendor Name', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'TotalAmt', label: 'Total Amount', type: 'currency', filterable: true, sortable: true, nillable: false },
    { name: 'Balance', label: 'Balance', type: 'currency', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.CreateTime', label: 'Created At', type: 'datetime', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.LastUpdatedTime', label: 'Updated At', type: 'datetime', filterable: true, sortable: true, nillable: false },
  ],
  Payment: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'TxnDate', label: 'Payment Date', type: 'date', filterable: true, sortable: true, nillable: false },
    { name: 'CustomerRef.value', label: 'Customer ID', type: 'reference', filterable: true, sortable: true, nillable: false, referenceTo: ['Customer'] },
    { name: 'CustomerRef.name', label: 'Customer Name', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'TotalAmt', label: 'Total Amount', type: 'currency', filterable: true, sortable: true, nillable: false },
    { name: 'UnappliedAmt', label: 'Unapplied Amount', type: 'currency', filterable: true, sortable: true, nillable: true },
    { name: 'MetaData.CreateTime', label: 'Created At', type: 'datetime', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.LastUpdatedTime', label: 'Updated At', type: 'datetime', filterable: true, sortable: true, nillable: false },
  ],
  BillPayment: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'TxnDate', label: 'Payment Date', type: 'date', filterable: true, sortable: true, nillable: false },
    { name: 'VendorRef.value', label: 'Vendor ID', type: 'reference', filterable: true, sortable: true, nillable: false, referenceTo: ['Vendor'] },
    { name: 'VendorRef.name', label: 'Vendor Name', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'TotalAmt', label: 'Total Amount', type: 'currency', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.CreateTime', label: 'Created At', type: 'datetime', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.LastUpdatedTime', label: 'Updated At', type: 'datetime', filterable: true, sortable: true, nillable: false },
  ],
  Estimate: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'DocNumber', label: 'Estimate Number', type: 'string', filterable: true, sortable: true, nillable: true },
    { name: 'TxnDate', label: 'Transaction Date', type: 'date', filterable: true, sortable: true, nillable: false },
    { name: 'ExpirationDate', label: 'Expiration Date', type: 'date', filterable: true, sortable: true, nillable: true },
    { name: 'CustomerRef.value', label: 'Customer ID', type: 'reference', filterable: true, sortable: true, nillable: false, referenceTo: ['Customer'] },
    { name: 'CustomerRef.name', label: 'Customer Name', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'TotalAmt', label: 'Total Amount', type: 'currency', filterable: true, sortable: true, nillable: false },
    { name: 'TxnStatus', label: 'Status', type: 'string', filterable: true, sortable: false, nillable: true },
    { name: 'MetaData.CreateTime', label: 'Created At', type: 'datetime', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.LastUpdatedTime', label: 'Updated At', type: 'datetime', filterable: true, sortable: true, nillable: false },
  ],
  CreditMemo: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'DocNumber', label: 'Credit Memo Number', type: 'string', filterable: true, sortable: true, nillable: true },
    { name: 'TxnDate', label: 'Transaction Date', type: 'date', filterable: true, sortable: true, nillable: false },
    { name: 'CustomerRef.value', label: 'Customer ID', type: 'reference', filterable: true, sortable: true, nillable: false, referenceTo: ['Customer'] },
    { name: 'CustomerRef.name', label: 'Customer Name', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'TotalAmt', label: 'Total Amount', type: 'currency', filterable: true, sortable: true, nillable: false },
    { name: 'RemainingCredit', label: 'Remaining Credit', type: 'currency', filterable: true, sortable: true, nillable: true },
    { name: 'MetaData.CreateTime', label: 'Created At', type: 'datetime', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.LastUpdatedTime', label: 'Updated At', type: 'datetime', filterable: true, sortable: true, nillable: false },
  ],
  SalesReceipt: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'DocNumber', label: 'Receipt Number', type: 'string', filterable: true, sortable: true, nillable: true },
    { name: 'TxnDate', label: 'Transaction Date', type: 'date', filterable: true, sortable: true, nillable: false },
    { name: 'CustomerRef.value', label: 'Customer ID', type: 'reference', filterable: true, sortable: true, nillable: true, referenceTo: ['Customer'] },
    { name: 'CustomerRef.name', label: 'Customer Name', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'TotalAmt', label: 'Total Amount', type: 'currency', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.CreateTime', label: 'Created At', type: 'datetime', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.LastUpdatedTime', label: 'Updated At', type: 'datetime', filterable: true, sortable: true, nillable: false },
  ],
  PurchaseOrder: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'DocNumber', label: 'PO Number', type: 'string', filterable: true, sortable: true, nillable: true },
    { name: 'TxnDate', label: 'Transaction Date', type: 'date', filterable: true, sortable: true, nillable: false },
    { name: 'VendorRef.value', label: 'Vendor ID', type: 'reference', filterable: true, sortable: true, nillable: false, referenceTo: ['Vendor'] },
    { name: 'VendorRef.name', label: 'Vendor Name', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'TotalAmt', label: 'Total Amount', type: 'currency', filterable: true, sortable: true, nillable: false },
    { name: 'POStatus', label: 'Status', type: 'string', filterable: true, sortable: false, nillable: true },
    { name: 'MetaData.CreateTime', label: 'Created At', type: 'datetime', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.LastUpdatedTime', label: 'Updated At', type: 'datetime', filterable: true, sortable: true, nillable: false },
  ],
  Purchase: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'TxnDate', label: 'Transaction Date', type: 'date', filterable: true, sortable: true, nillable: false },
    { name: 'PaymentType', label: 'Payment Type', type: 'string', filterable: true, sortable: false, nillable: false },
    { name: 'AccountRef.value', label: 'Account ID', type: 'reference', filterable: true, sortable: true, nillable: false, referenceTo: ['Account'] },
    { name: 'AccountRef.name', label: 'Account Name', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'TotalAmt', label: 'Total Amount', type: 'currency', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.CreateTime', label: 'Created At', type: 'datetime', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.LastUpdatedTime', label: 'Updated At', type: 'datetime', filterable: true, sortable: true, nillable: false },
  ],
  JournalEntry: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'DocNumber', label: 'Reference Number', type: 'string', filterable: true, sortable: true, nillable: true },
    { name: 'TxnDate', label: 'Transaction Date', type: 'date', filterable: true, sortable: true, nillable: false },
    { name: 'Adjustment', label: 'Is Adjustment', type: 'boolean', filterable: true, sortable: false, nillable: true },
    { name: 'TotalAmt', label: 'Total Amount', type: 'currency', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.CreateTime', label: 'Created At', type: 'datetime', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.LastUpdatedTime', label: 'Updated At', type: 'datetime', filterable: true, sortable: true, nillable: false },
  ],
  Account: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'Name', label: 'Name', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'AccountType', label: 'Account Type', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'AccountSubType', label: 'Account Sub-Type', type: 'string', filterable: true, sortable: true, nillable: true },
    { name: 'Classification', label: 'Classification', type: 'string', filterable: true, sortable: false, nillable: true },
    { name: 'Active', label: 'Active', type: 'boolean', filterable: true, sortable: false, nillable: false },
    { name: 'CurrentBalance', label: 'Current Balance', type: 'currency', filterable: true, sortable: true, nillable: true },
    { name: 'MetaData.CreateTime', label: 'Created At', type: 'datetime', filterable: true, sortable: true, nillable: false },
    { name: 'MetaData.LastUpdatedTime', label: 'Updated At', type: 'datetime', filterable: true, sortable: true, nillable: false },
  ],
  TaxCode: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'Name', label: 'Name', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'Description', label: 'Description', type: 'string', filterable: false, sortable: false, nillable: true },
    { name: 'Active', label: 'Active', type: 'boolean', filterable: true, sortable: false, nillable: false },
    { name: 'Taxable', label: 'Taxable', type: 'boolean', filterable: true, sortable: false, nillable: false },
  ],
  Term: [
    { name: 'Id', label: 'ID', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'Name', label: 'Name', type: 'string', filterable: true, sortable: true, nillable: false },
    { name: 'Active', label: 'Active', type: 'boolean', filterable: true, sortable: false, nillable: false },
    { name: 'DueDays', label: 'Due Days', type: 'integer', filterable: true, sortable: true, nillable: true },
    { name: 'DiscountDays', label: 'Discount Days', type: 'integer', filterable: true, sortable: true, nillable: true },
    { name: 'DiscountPercent', label: 'Discount Percent', type: 'decimal', filterable: true, sortable: true, nillable: true },
  ],
};
/* v8 ignore stop */

function describeObjects(_credentials: Record<string, unknown>): Promise<ObjectDescriptor[]> {
  return Promise.resolve(QB_OBJECTS);
}

function describeFields(
  _credentials: Record<string, unknown>,
  objectName: string,
): Promise<FieldDescriptor[]> {
  const fields = QB_FIELDS[objectName];
  if (!fields) {
    return Promise.resolve([]);
  }
  return Promise.resolve(fields);
}

function describeRelatedObjects(
  _credentials: Record<string, unknown>,
  objectName: string,
): Promise<RelatedObjectDescriptor[]> {
  const fields = QB_FIELDS[objectName];
  if (!fields) {
    return Promise.resolve([]);
  }

  const related: RelatedObjectDescriptor[] = [];
  for (const f of fields) {
    if (f.type === 'reference' && f.referenceTo?.length) {
      for (const ref of f.referenceTo) {
        related.push({ objectName: ref, relationshipType: '1:1', relationField: f.name });
      }
    }
  }

  const unique = new Map<string, RelatedObjectDescriptor>();
  for (const r of related) {
    const key = `${r.objectName}-${r.relationshipType}-${r.relationField}`;
    if (!unique.has(key)) unique.set(key, r);
  }

  return Promise.resolve(Array.from(unique.values()).sort((a, b) => a.objectName.localeCompare(b.objectName)));
}

function describeConfig(
  _credentials: Record<string, unknown>,
): Promise<ConfigOption[]> {
  return Promise.resolve([
    {
      name: 'useTaxCode',
      label: 'Use Tax Code',
      type: 'boolean',
      description: 'Whether to attach a default Tax Code to transactions.',
      defaultValue: false,
    },
    {
      name: 'taxCodeDefault',
      label: 'Default Tax Code',
      type: 'string',
      description: 'The Tax Code to use when Use Tax Code is enabled.',
      defaultValue: 'NON',
    }
  ]);
}

/* v8 ignore start */
const customApiAction = createCustomApiCallAction({
  auth: quickbooksAuth,
  baseUrl: (auth: QuickBooksAuth) => {
    const companyId = auth.props?.['companyId'];
    if (!companyId || typeof companyId !== 'string' || companyId.trim() === '') {
      throw new Error('QuickBooks authentication missing or invalid companyId');
    }

    const env = resolveEnvironment(auth.props);
    const apiUrl = quickbooksCommon.getApiUrl(companyId, env === 'test');
    return apiUrl;
  },
  authMapping: async (auth: QuickBooksAuth) => {
    return {
      Authorization: `Bearer ${auth.access_token}`
    }
  }
});
/* v8 ignore stop */

export const quickbooks = createPiece({
  name: "quickbooks",
  displayName: "Quickbooks Online",
  auth: quickbooksAuth,
  defaultAppProfile: 'online',
  minimumSupportedRelease: '0.36.1',
  logoUrl: "https://cdn.activepieces.com/pieces/quickbooks.png",
  authors: [
    'onyedikachi-david'
  ],
  categories: [PieceCategory.ACCOUNTING],
  actions: [
    customApiAction
  ],
  triggers: [
    quickbooksUniversalTrigger
  ],
  describeObjects,
  describeFields,
  describeRelatedObjects,
  describeConfig,
  normalize: async (_objectType: string, _raw: Record<string, unknown>): Promise<NormalizedRecord | null> => {
    // Returns null — QuickBooks records do not map to a pre-defined CanonicalType.
    // NormalizationService (L3) handles null by storing the raw record with
    // canonicalType='RAW'. Field-level mapping is applied in L4 via field_mapping rules.
    return null;
  },
  executeAction: async (objectType: string, payload: Record<string, unknown>, credentials: Record<string, unknown>): Promise<VendorResponse> => {
    // Writes a single entity to the QuickBooks Online v3 API.
    // In local/mock mode baseUrl points to http://mock_gateway:4000/mock/quickbooks.
    // In production, baseUrl is the QB API endpoint; realmId identifies the company.
    const vendorParams = (credentials['vendorParams'] as Record<string, unknown> | undefined) || {};
    const rawRealmId = credentials['realmId'] ?? credentials['realm_id'] ?? vendorParams['companyId'];
    let realmId = '';
    if (typeof rawRealmId === 'string') {
      realmId = rawRealmId.trim();
    } else if (typeof rawRealmId === 'number' && Number.isFinite(rawRealmId)) {
      realmId = String(rawRealmId).trim();
    }

    if (!realmId || realmId === '') {
      throw new Error('QuickBooks realmId is required but not found in credentials. Check realmId, realm_id, or vendorParams.companyId.');
    }

    const rawAccessToken = credentials['access_token'] ?? credentials['accessToken'];
    let accessToken = '';
    if (typeof rawAccessToken === 'string') {
      accessToken = rawAccessToken.trim();
    }

    if (!accessToken || accessToken === '') {
      throw new Error('QuickBooks accessToken is required but not found in credentials. Check access_token or accessToken fields.');
    }
    
    const env = resolveEnvironment(vendorParams);
    const useSandbox = env === 'test';
    
    let baseUrl = quickbooksCommon.getApiUrl(realmId, useSandbox);
    if (credentials['base_url']) {
      baseUrl = `${credentials['base_url'] as string}/v3/company/${encodeURIComponent(realmId)}`;
    }
    const url = `${baseUrl}/${objectType.toLowerCase()}`;

    // Strip internal Soopa pipeline metadata before any API call.
    // Keys prefixed with `_` (e.g. `_routingEnvelope`) are never valid QB fields and
    // QB rejects them with ValidationFault code 2010 ("unsupported property").
    // This is a platform-level guarantee — independent of the application shard.
    const cleanPayload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (!k.startsWith('_')) cleanPayload[k] = v;
    }

    const executePost = async (payloadData: unknown) => {
      let resData: Record<string, unknown>;
      let status: number;
      try {
        const response = await httpAdapter.post<Record<string, unknown>>(url, {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        }, payloadData, AbortSignal.timeout(15_000));
        status = response.status;
        resData = response.data;
      } catch (err: unknown) {
        if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
          throw new Error(`QuickBooks API request timed out after 15s executing ${objectType}`);
        }
        if (err instanceof QuickBooksFetchError) {
          status = err.status;
          try {
            // Try to find JSON payload in the error message
            const braceIndex = err.message.indexOf('{');
            if (braceIndex !== -1) {
              resData = JSON.parse(err.message.substring(braceIndex));
            } else {
              resData = {};
            }
          } catch {
            resData = {};
          }
        } else {
          throw err;
        }
      }
      return { status, body: resData };
    };

    // ── Rule: SyncToken stale auto-refresh ────────────────────────────────────
    // QB requires the current SyncToken on every update (POST with Id). If it's
    // stale, QB returns a 400 ValidationFault with code 5010 or a message
    // containing "SyncToken". On detection: GET the entity to fetch the fresh
    // SyncToken and retry the update exactly once.
    const isSyncTokenError = (status: number, body: Record<string, unknown>): boolean => {
      if (status !== 400 && status !== 409) return false;
      const fault = body['Fault'] as Record<string, unknown> | undefined;
      const errors = (fault?.['Error'] ?? []) as Array<Record<string, unknown>>;
      return errors.some(e => {
        const code = String(e['code'] ?? '');
        const msg = String(e['Message'] ?? e['Detail'] ?? '').toLowerCase();
        return code === '5010' || msg.includes('synctoken') || msg.includes('stale token');
      });
    };

    const fetchLatestEntityRecord = async (entityId: string): Promise<Record<string, unknown> | null> => {
      try {
        const getUrl = `${url}/${encodeURIComponent(entityId)}`;
        const { data } = await httpAdapter.get<Record<string, unknown>>(getUrl, {
          Accept: 'application/json', Authorization: `Bearer ${accessToken}`
        }, AbortSignal.timeout(10_000));
        const matchKey = Object.keys(data).find(k => k.toLowerCase() === objectType.toLowerCase()) ?? objectType;
        return (data[matchKey] as Record<string, unknown> | undefined) ?? null;
      } catch {
        return null;
      }
    };

    // Track the payload that was ultimately accepted by QB.
    // On a clean first-attempt success this is cleanPayload.
    // On a SyncToken refresh-and-retry this is retryPayload (with fresh SyncToken).
    // sentPayload is written back to outbound_gateway by DeliveryService so the
    // customer support team always sees the exact request QB accepted.
    let sentPayload: Record<string, unknown> = cleanPayload;

    let { status, body } = await executePost(cleanPayload);

    // If the first call fails with a SyncToken error and the payload contains an Id
    // (i.e. this is an update, not a create), refresh the token and retry once.
    const payloadId = typeof cleanPayload['Id'] === 'string' ? cleanPayload['Id'] : null;

    if (isSyncTokenError(status, body) && payloadId) {
      const latestEntity = await fetchLatestEntityRecord(payloadId);
      const freshSyncToken = latestEntity?.['SyncToken'] as string | undefined;
      if (freshSyncToken) {
        const retryPayload = { ...cleanPayload, Id: payloadId, SyncToken: freshSyncToken };
        const retried = await executePost(retryPayload);
        status = retried.status;
        body = retried.body;
        // Update sentPayload to reflect the retried payload that succeeded.
        sentPayload = retryPayload;
      }
    }

    // Explicitly surface the entity ID from the response body so the pipeline
    // can write to the GEM table without needing to parse app-specific response shapes.
    const matchingKey = Object.keys(body).find(k => k.toLowerCase() === objectType.toLowerCase()) ?? objectType;
    const entityObj = body[matchingKey] as Record<string, unknown> | undefined;
    const entityId = (typeof entityObj?.['Id'] === 'string' ? entityObj['Id'] : undefined)
      ?? (typeof body['Id'] === 'string' ? body['Id'] : undefined);

    return { statusCode: status, body, entityId, sentPayload };
  },
  // NOTE: QuickBooks webhook support is intentionally disabled.
  // QB sends all company events to a single app endpoint identified by
  // payload.realmId, not a per-connection URL path. The current
  // WebhooksController resolves connections by :connectionId in the URL,
  // which is incompatible with QB's delivery model. Re-enable this once
  // the controller supports realmId-based connection resolution.
});