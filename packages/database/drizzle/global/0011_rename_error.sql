DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'stitch_outbox'
           AND column_name  = 'last_error'
    ) THEN
        ALTER TABLE "stitch_outbox" RENAME COLUMN last_error TO error_message;
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'scheduler_outbox'
           AND column_name  = 'last_error'
    ) THEN
        ALTER TABLE "scheduler_outbox" RENAME COLUMN last_error TO error_message;
    END IF;
END $$;