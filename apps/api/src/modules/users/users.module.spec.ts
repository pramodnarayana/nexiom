import { Test } from '@nestjs/testing';
import { UsersModule } from './users.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { DRIZZLE_DB } from '../../db/db.provider';
import { IdentityProvider } from '../auth/identity-provider.abstract';
import { Module, Global } from '@nestjs/common';

@Global()
@Module({
  providers: [{ provide: IdentityProvider, useValue: {} }],
  exports: [IdentityProvider],
})
class MockGenericAuthModule {}

describe('UsersModule', () => {
  it('should compile the module', async () => {
    const module = await Test.createTestingModule({
      imports: [UsersModule, MockGenericAuthModule],
    })
      .overrideProvider(DRIZZLE_DB)
      .useValue({}) // Mock DB
      .compile();

    expect(module).toBeDefined();
    expect(module.get(UsersService)).toBeDefined();
    expect(module.get(UsersController)).toBeDefined();
  });
});
