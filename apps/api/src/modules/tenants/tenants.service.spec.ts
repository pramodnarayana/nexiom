import { Test, TestingModule } from '@nestjs/testing';
import { TenantsService } from './tenants.service';
import { IdentityProvider } from '../auth/identity-provider.abstract';
import { Organization } from './tenant.schema';

describe('TenantsService', () => {
  let service: TenantsService;
  let identityProvider: IdentityProvider;

  const mockOrganizations: Organization[] = [
    {
      id: '1',
      name: 'Test Org 1',
      slug: 'test-org-1',
      logo: null,
      createdAt: new Date(),
      metadata: null,
      status: 'active',
    },
    {
      id: '2',
      name: 'Test Org 2',
      slug: 'test-org-2',
      logo: null,
      createdAt: new Date(),
      metadata: null,
      status: 'disabled',
    },
  ];

  const mockIdentityProvider = {
    listTenants: jest.fn(),
    updateTenantStatus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        {
          provide: IdentityProvider,
          useValue: mockIdentityProvider,
        },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
    identityProvider = module.get<IdentityProvider>(IdentityProvider);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all tenants when no search is provided', async () => {
      mockIdentityProvider.listTenants.mockResolvedValue(mockOrganizations);

      const result = await service.findAll();

      expect(result).toEqual(mockOrganizations);
      expect(identityProvider.listTenants).toHaveBeenCalledWith(undefined);
    });

    it('should return filtered tenants when search is provided', async () => {
      const searchTerm = 'Test Org 1';
      const filteredOrgs = [mockOrganizations[0]];
      mockIdentityProvider.listTenants.mockResolvedValue(filteredOrgs);

      const result = await service.findAll(searchTerm);

      expect(result).toEqual(filteredOrgs);
      expect(identityProvider.listTenants).toHaveBeenCalledWith(searchTerm);
    });

    it('should return empty array when no tenants found', async () => {
      mockIdentityProvider.listTenants.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('updateStatus', () => {
    it('should update tenant status to active', async () => {
      const updatedOrg = { ...mockOrganizations[1], status: 'active' as const };
      mockIdentityProvider.updateTenantStatus.mockResolvedValue(updatedOrg);

      const result = await service.updateStatus('2', 'active');

      expect(result).toEqual(updatedOrg);
      expect(identityProvider.updateTenantStatus).toHaveBeenCalledWith(
        '2',
        'active',
      );
    });

    it('should update tenant status to disabled', async () => {
      const updatedOrg = {
        ...mockOrganizations[0],
        status: 'disabled' as const,
      };
      mockIdentityProvider.updateTenantStatus.mockResolvedValue(updatedOrg);

      const result = await service.updateStatus('1', 'disabled');

      expect(result).toEqual(updatedOrg);
      expect(identityProvider.updateTenantStatus).toHaveBeenCalledWith(
        '1',
        'disabled',
      );
    });

    it('should update tenant status to suspended', async () => {
      const updatedOrg = {
        ...mockOrganizations[0],
        status: 'suspended' as const,
      };
      mockIdentityProvider.updateTenantStatus.mockResolvedValue(updatedOrg);

      const result = await service.updateStatus('1', 'suspended');

      expect(result).toEqual(updatedOrg);
      expect(identityProvider.updateTenantStatus).toHaveBeenCalledWith(
        '1',
        'suspended',
      );
    });
  });
});
