DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum
        WHERE enumtypid = 'submission_status'::regtype
          AND enumlabel = 'closed'
    ) THEN
        ALTER TYPE submission_status ADD VALUE 'closed';
    END IF;
END $$;
