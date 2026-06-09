export class SalesforceCredentials {
  private constructor(
    public readonly instanceUrl: string,
    public readonly accessToken: string,
  ) {}

  public static fromRecord(credentials: Record<string, unknown>): SalesforceCredentials {
    const data = credentials['data'] as Record<string, unknown> | undefined;
    
    let instanceUrl = '';
    if (typeof credentials['instance_url'] === 'string') {
      instanceUrl = credentials['instance_url'];
    } else if (data && typeof data['instance_url'] === 'string') {
      instanceUrl = data['instance_url'];
    }

    if (!instanceUrl) {
      throw new Error('Salesforce credentials missing instance_url');
    }

    let accessToken = '';
    if (typeof credentials['accessToken'] === 'string') {
      accessToken = credentials['accessToken'];
    } else if (typeof credentials['access_token'] === 'string') {
      accessToken = credentials['access_token'];
    }

    if (!accessToken) {
      throw new Error('Salesforce credentials missing accessToken');
    }

    return new SalesforceCredentials(instanceUrl.replace(/\/$/, ''), accessToken);
  }
}
