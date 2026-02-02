-- Simple cleanup script for pramod.narayana+tenant1@gmail.com
-- Copy and paste each section separately in Drizzle Studio SQL Console

-- 1. Find and display user info
SELECT id, email, "emailVerified", "createdAt" 
FROM "user" 
WHERE email = 'pramod.narayana+tenant1@gmail.com';

-- 2. Delete sessions (copy user id from step 1)
-- Replace 'USER_ID_HERE' with the actual user ID from step 1
DELETE FROM "session" WHERE "userId" = 'USER_ID_HERE';

-- 3. Delete accounts
DELETE FROM "account" WHERE "userId" = 'USER_ID_HERE';

-- 4. Delete verification tokens
DELETE FROM "verification" WHERE identifier = 'pramod.narayana+tenant1@gmail.com';

-- 5. Delete invitations sent by user
DELETE FROM "invitation" WHERE "inviterId" = 'USER_ID_HERE';

-- 6. Delete invitations to user
DELETE FROM "invitation" WHERE email = 'pramod.narayana+tenant1@gmail.com';

-- 7. Find organizations this user is a member of
SELECT "organizationId", COUNT(*) as member_count
FROM "member"
WHERE "organizationId" IN (
    SELECT "organizationId" FROM "member" WHERE "userId" = 'USER_ID_HERE'
)
GROUP BY "organizationId";

-- 8. Delete memberships
DELETE FROM "member" WHERE "userId" = 'USER_ID_HERE';

-- 9. Delete orphaned organizations (if member_count was 1 in step 7)
-- Replace 'ORG_ID_HERE' with organization IDs that had only 1 member
DELETE FROM "organization" WHERE id = 'ORG_ID_HERE';

-- 10. Finally, delete the user
DELETE FROM "user" WHERE id = 'USER_ID_HERE';

-- 11. Verify deletion
SELECT COUNT(*) as user_exists 
FROM "user" 
WHERE email = 'pramod.narayana+tenant1@gmail.com';
