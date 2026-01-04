import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { CreateUser } from '../users/users.schema';
import { IdentityProvider } from '../auth/identity-provider.abstract';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createClient } = require('@zitadel/node');

@Injectable()
export class ZitadelIdentityProvider implements OnModuleInit, IdentityProvider {
    private readonly logger = new Logger(ZitadelIdentityProvider.name);
    private mgmt: any;

    async onModuleInit() {
        this.logger.log('Initializing Zitadel Connection...');

        // Read JSON Key from Env
        const keyJson = process.env.ZITADEL_SERVICE_USER_JSON;
        if (!keyJson) {
            this.logger.error('ZITADEL_SERVICE_USER_JSON is missing in .env');
            throw new Error('Missing ZITADEL_SERVICE_USER_JSON');
        }

        // Connect to Zitadel
        this.mgmt = createClient({
            issuer: process.env.ZITADEL_ISSUER || 'https://issuer.zitadel.ch',
            api: 'management',
            token: keyJson,
        });

        this.logger.log('Zitadel Connection Established.');
    }

    /**
     * Creates a Human User in the Default Org.
     */
    async createHumanUser(user: CreateUser) {
        this.logger.log(`Creating user: ${user.email}`);

        try {
            const response = await this.mgmt.addHumanUser({
                profile: {
                    firstName: user.firstName || 'New',
                    lastName: user.lastName || 'User',
                    displayName: `${user.firstName} ${user.lastName}`,
                    preferredLanguage: 'en',
                },
                email: {
                    email: user.email,
                    isVerified: true,
                },
            });

            this.logger.log(`Created User ID: ${response.userId}`);
            return response;
        } catch (error) {
            this.logger.error('Failed to create user in Zitadel', error);
            throw error;
        }
    }
}
