#!/bin/bash

# Cleanup user script using psql
# Usage: ./scripts/cleanup-user.sh pramod.narayana+tenant1@gmail.com

EMAIL="${1:-pramod.narayana+tenant1@gmail.com}"

echo "🧹 Cleaning up user: $EMAIL"

# Get database connection details from .env
source .env

psql "$DATABASE_URL" <<EOF
DO \$\$
DECLARE
    target_user_id TEXT;
    target_email TEXT := '$EMAIL';
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
    
    -- Delete accounts
    DELETE FROM "account" WHERE "userId" = target_user_id;
    RAISE NOTICE 'Deleted accounts';
    
    -- Delete verification tokens
    DELETE FROM "verification" WHERE identifier = target_email;
    RAISE NOTICE 'Deleted verification tokens';
    
    -- Delete invitations
    DELETE FROM "invitation" WHERE "inviterId" = target_user_id OR email = target_email;
    RAISE NOTICE 'Deleted invitations';
    
    -- Handle organizations and memberships
    FOR org_id IN 
        SELECT DISTINCT "organizationId" FROM "member" 
        WHERE "userId" = target_user_id AND "organizationId" IS NOT NULL
    LOOP
        DELETE FROM "member" WHERE "userId" = target_user_id AND "organizationId" = org_id;
        
        SELECT COUNT(*) INTO member_count FROM "member" WHERE "organizationId" = org_id;
        
        IF member_count = 0 THEN
            DELETE FROM "organization" WHERE id = org_id;
            RAISE NOTICE 'Deleted orphaned organization: %', org_id;
        END IF;
    END LOOP;
    
    -- Delete remaining memberships
    DELETE FROM "member" WHERE "userId" = target_user_id;
    RAISE NOTICE 'Deleted memberships';
    
    -- Delete user
    DELETE FROM "user" WHERE id = target_user_id;
    RAISE NOTICE 'Deleted user: %', target_user_id;
    
    RAISE NOTICE '✅ Cleanup complete for: %', target_email;
END \$\$;
EOF

echo "✅ Done"
