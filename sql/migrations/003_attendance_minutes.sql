BEGIN;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS first_arrival_at timestamptz;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS last_departure_at timestamptz;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS late_minutes integer CHECK (late_minutes >= 0);
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS missing_intervals jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(missing_intervals)='array');
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS timing_complete boolean NOT NULL DEFAULT false;
ALTER TABLE student_attendance ADD COLUMN IF NOT EXISTS last_movement_at timestamptz;
ALTER TABLE attendance_events ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
-- Existing rows remain unknown: recording time cannot prove historical arrival time.
COMMIT;
