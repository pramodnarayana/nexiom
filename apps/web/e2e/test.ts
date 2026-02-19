import { test as base } from '@playwright/test';
import { MailpitFixture } from './fixtures/mailpit';
import { DbFixture } from './fixtures/db';

type MyFixtures = {
    mailpit: MailpitFixture;
    db: DbFixture;
};

export const test = base.extend<MyFixtures>({
    mailpit: async ({ request }, use) => {
        const mailpit = new MailpitFixture(request);
        // eslint-disable-next-line react-hooks/rules-of-hooks
        await use(mailpit);
    },
    // eslint-disable-next-line no-empty-pattern
    db: async ({ }, use) => {
        const db = new DbFixture();
        // eslint-disable-next-line react-hooks/rules-of-hooks
        await use(db);
        // Clean up connection after test
        await db.close();
    },
});

export { expect } from '@playwright/test';
