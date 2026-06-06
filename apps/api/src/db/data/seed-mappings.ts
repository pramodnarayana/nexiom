export interface SeedMapping {
  name: string;
  sourceDataSourceId: string;
  destDataSourceId: string;
  canonicalObject: string;
  targetObject: string;
  mappingRules: { srcPath: string; destPath: string }[];
}

export const LOCAL_SEED_MAPPINGS: SeedMapping[] = [
  {
    name: 'Revenova to QuickBooks Local Sync',
    sourceDataSourceId: '00000000-0000-0000-0000-000000000001',
    destDataSourceId: '00000000-0000-0000-0000-000000000002',
    canonicalObject: 'TMS_CARRIER',
    targetObject: 'Vendor',
    mappingRules: [
      { srcPath: 'displayName', destPath: 'DisplayName' },
      { srcPath: 'displayName', destPath: 'CompanyName' },
      { srcPath: 'tp.mcNumber', destPath: 'GivenName' },
      { srcPath: 'remitTo.billingStreet', destPath: 'BillAddr.Line1' },
      { srcPath: 'remitTo.billingCity', destPath: 'BillAddr.City' },
      {
        srcPath: 'remitTo.billingState',
        destPath: 'BillAddr.CountrySubDivisionCode',
      },
      {
        srcPath: 'remitTo.billingPostalCode',
        destPath: 'BillAddr.PostalCode',
      },
      { srcPath: 'remitTo.billingCountry', destPath: 'BillAddr.Country' },
      { srcPath: 'billingStreet', destPath: 'ShipAddr.Line1' },
      { srcPath: 'billingCity', destPath: 'ShipAddr.City' },
      {
        srcPath: 'billingState',
        destPath: 'ShipAddr.CountrySubDivisionCode',
      },
      { srcPath: 'billingPostalCode', destPath: 'ShipAddr.PostalCode' },
      { srcPath: 'billingCountry', destPath: 'ShipAddr.Country' },
      { srcPath: 'phone', destPath: 'PrimaryPhone.FreeFormNumber' },
      { srcPath: 'fax', destPath: 'Fax.FreeFormNumber' },
    ],
  },
];
