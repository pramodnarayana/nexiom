-- Cleanup script for user: user@example.com
-- Run this in Drizzle Studio SQL console or via psql

-- Start transaction
BEGIN;

-- Store user ID in a variable (PostgreSQL)
DO $$
DECLARE
    target_user_id TEXT;
    target_email TEXT := 'user@example.com';
    org_id TEXT;
    member_count INT;
BEGIN
    -- Get user ID
    SELECT id INTO target_user_id FROM "user" WHERE email = target_email;
    
    IF target_user_id IS NULL THEN
        RAISE NOTICE 'User not found: %', target_email;
        RETURN;
    END IF;
    
    RAISE NOTICE 'Found user: %', target_user_id;
    
    -- Delete sessions
    DELETE FROM "session" WHERE "userId" = target_user_id;
    RAISE NOTICE 'Deleted sessions';
    
    -- Delete accounts (social logins)
    DELETE FROM "account" WHERE "userId" = target_user_id;
    RAISE NOTICE 'Deleted accounts';
    
    -- Delete verification tokens
    DELETE FROM "verification" WHERE identifier = target_email;
    RAISE NOTICE 'Deleted verification tokens';
    
    -- Delete invitations sent by user
    DELETE FROM "invitation" WHERE "inviterId" = target_user_id;
    RAISE NOTICE 'Deleted invitations sent by user';
    
    -- Delete invitations to user
    DELETE FROM "invitation" WHERE email = target_email;
    RAISE NOTICE 'Deleted invitations to user';
    
    -- Store organization IDs before deleting memberships
    FOR org_id IN 
        SELECT DISTINCT "organizationId" FROM "member" 
        WHERE "userId" = target_user_id AND "organizationId" IS NOT NULL
    LOOP
        -- Delete memberships for this user
        DELETE FROM "member" WHERE "userId" = target_user_id AND "organizationId" = org_id;
        
        -- Check if organization is now empty
        SELECT COUNT(*) INTO member_count FROM "member" WHERE "organizationId" = org_id;
        
        IF member_count = 0 THEN
            -- Delete orphaned organization
            DELETE FROM "organization" WHERE id = org_id;
            RAISE NOTICE 'Deleted orphaned organization: %', org_id;
        END IF;
    END LOOP;
    
    -- Delete any remaining memberships (system memberships without org)
    DELETE FROM "member" WHERE "userId" = target_user_id;
    RAISE NOTICE 'Deleted all memberships';
    
    -- Finally, delete the user
    DELETE FROM "user" WHERE id = target_user_id;
    RAISE NOTICE 'Deleted user: %', target_user_id;
    
    RAISE NOTICE 'Cleanup complete for: %', target_email;
END $$;

-- Commit transaction
COMMIT;

-- Verify deletion
SELECT 'User exists: ' || CASE WHEN EXISTS(SELECT 1 FROM "user" WHERE email = 'user@example.com') THEN 'YES' ELSE 'NO' END as status;
