import { Module, Global } from '@nestjs/common';
import { ZitadelIdentityProvider } from './zitadel.provider';
import { IdentityProvider } from '../auth/identity-provider.abstract';

/**
 * Global Module for Zitadel Integration.
 * Exports IdentityProvider logic.
 */
@Global()
@Module({
    providers: [
        ZitadelIdentityProvider,
        {
            provide: IdentityProvider,
            useExisting: ZitadelIdentityProvider,
        },
    ],
    exports: [IdentityProvider],
})
export class ZitadelModule { }
