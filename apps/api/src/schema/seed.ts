// import { Pool } from 'pg'; // Logic removed

const main = async () => {
    // Legacy seeding logic removed. 
    // Better Auth handles roles via the 'member' table dynamically.
    // If we need global system roles later, we will re-introduce schema and seeding here.

    console.log('Seed script: No static data to seed for Better Auth setup currently.');
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
