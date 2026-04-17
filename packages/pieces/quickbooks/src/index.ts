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
} from '@nexiom/piece-framework';
import { quickbooksAuth } from './lib/auth.js';
import { quickbooksCommon, resolveEnvironment } from './lib/common.js';
import { quickbooksUniversalTrigger } from './triggers/universal-trigger.js';
import type { QuickBooksAuth } from './triggers/quickbooks-polling.helper.js';

// ── QuickBooks metadata (no describe API — schemas are stable and well-documented) ─────

// Core transactional and list entities supported by the QuickBooks Online v3 API.
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

export const quickbooks = createPiece({
  name: "quickbooks",
  displayName: "Quickbooks Online",
  auth: quickbooksAuth,
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
    const realmId = (credentials['realmId'] as string | undefined) ?? (credentials['realm_id'] as string | undefined) ?? 'stub';
    const accessToken = (credentials['access_token'] as string | undefined) ?? (credentials['accessToken'] as string | undefined) ?? 'stub';
    const baseUrl = (credentials['base_url'] as string | undefined) ?? 'https://quickbooks.api.intuit.com';
    const url = `${baseUrl}/v3/company/${encodeURIComponent(realmId)}/${objectType.toLowerCase()}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err: unknown) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw new Error(`QuickBooks API request timed out after 15s executing ${objectType}`);
      }
      throw err;
    }

    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    return { statusCode: res.status, body };
  },
  // NOTE: QuickBooks webhook support is intentionally disabled.
  // QB sends all company events to a single app endpoint identified by
  // payload.realmId, not a per-connection URL path. The current
  // WebhooksController resolves connections by :connectionId in the URL,
  // which is incompatible with QB's delivery model. Re-enable this once
  // the controller supports realmId-based connection resolution.
});