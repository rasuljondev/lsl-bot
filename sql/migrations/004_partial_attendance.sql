BEGIN;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS names_complete boolean NOT NULL DEFAULT true;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS unresolved_names jsonb NOT NULL DEFAULT '[]';
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS source_event_at timestamptz;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS source_message_id bigint;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS status_confirmed boolean NOT NULL DEFAULT true;
COMMIT;
