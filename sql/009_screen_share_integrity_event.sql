BEGIN;

DO $$
BEGIN
    BEGIN
        ALTER TYPE integrity_event_type ADD VALUE IF NOT EXISTS 'screen_share_block';
    EXCEPTION
        WHEN duplicate_object THEN
            NULL;
    END;
END $$;

CREATE OR REPLACE FUNCTION integrity_event_default_weight(p_event_type integrity_event_type)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_event_type
        WHEN 'tab_switch' THEN 1.50
        WHEN 'copy_attempt' THEN 3.00
        WHEN 'paste_attempt' THEN 2.00
        WHEN 'multiple_login' THEN 4.00
        WHEN 'ip_change' THEN 2.50
        WHEN 'device_change' THEN 3.50
        WHEN 'fullscreen_exit' THEN 2.00
        WHEN 'network_change' THEN 1.00
        WHEN 'webcam_block' THEN 4.50
        WHEN 'screen_share_block' THEN 5.00
        ELSE 1.00
    END;
$$;

COMMIT;
