import { describe, it, expect, beforeEach } from 'vitest';
import { StoreOAuthConnectionUseCase } from './store-oauth-connection.use-case.js';
import { FakeAppConnectionRepository } from '../fakes/fake-app-connection.repository.js';
import { FakeConnectionLifecyclePort } from '../fakes/fake-connection-lifecycle.port.js';

describe('StoreOAuthConnectionUseCase', () => {
  let useCase: StoreOAuthConnectionUseCase;
  let fakeRepo: FakeAppConnectionRepository;
  let fakeLifecycle: FakeConnectionLifecyclePort;

  beforeEach(() => {
    fakeRepo = new FakeAppConnectionRepository();
    fakeLifecycle = new FakeConnectionLifecyclePort();
    useCase = new StoreOAuthConnectionUseCase(
      fakeRepo,
      fakeLifecycle,
      'us-east-1',
    );
  });

  it('should store connection and provision namespace successfully', async () => {
    const options = {
      tenantId: 'tenant-123',
      providerName: 'salesforce',
      externalId: 'ext-456',
      displayName: 'SF Conn',
      authType: 'OAUTH2' as const,
      value: 'token',
      expiresAt: new Date(),
      metadata: { foo: 'bar' },
    };

    await useCase.execute(options);

    expect(fakeRepo.callCount.storeOAuthConnection).toBe(1);
    expect(fakeLifecycle.callCount.activateAndProvision).toBe(1);

    // It should have generated an ID or stored it
    expect(fakeRepo.connections.size).toBe(1);

    // It should have provisioned the namespace based on the fake's logic
    expect(
      fakeLifecycle.provisionedNamespaces.has('schema_tenant-123_salesforce'),
    ).toBe(true);
  });

  it('should pass finalRegionContext correctly when provided', async () => {
    const options = {
      tenantId: 'tenant-123',
      providerName: 'salesforce',
      externalId: 'ext-456',
      displayName: 'SF Conn',
      authType: 'OAUTH2' as const,
      value: 'token',
      expiresAt: new Date(),
      metadata: {},
      regionContext: 'eu-west-1', // explicit override
    };

    await useCase.execute(options);

    // Check that it merged the region context
    const stored = Array.from(fakeRepo.connections.values())[0] as any;
    expect(stored.regionContext).toBe('eu-west-1');
  });

  it('should use default region context if explicit one is missing', async () => {
    const options = {
      tenantId: 'tenant-123',
      providerName: 'salesforce',
      externalId: 'ext-456',
      displayName: 'SF Conn',
      authType: 'OAUTH2' as const,
      value: 'token',
      expiresAt: new Date(),
      metadata: {},
      // regionContext is omitted
    };

    await useCase.execute(options);

    const stored = Array.from(fakeRepo.connections.values())[0] as any;
    expect(stored.regionContext).toBe('us-east-1');
  });

  it('should throw an error in production if no region context is available', async () => {
    // Override NODE_ENV
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    // Setup use case with no default
    const noDefaultUseCase = new StoreOAuthConnectionUseCase(
      fakeRepo,
      fakeLifecycle,
      undefined,
    );

    await expect(
      noDefaultUseCase.execute({
        tenantId: 'tenant-123',
        providerName: 'salesforce',
        externalId: 'ext-456',
        displayName: 'SF Conn',
        authType: 'OAUTH2',
        value: 'token',
        expiresAt: new Date(),
        metadata: {},
      }),
    ).rejects.toThrow(
      'Region context is required for connection storage in production',
    );

    // Restore NODE_ENV
    process.env.NODE_ENV = oldEnv;
  });
});
