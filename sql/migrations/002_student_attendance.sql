BEGIN;

-- Official rosters are deliberately separate from legacy names collected from chat.
CREATE TABLE IF NOT EXISTS class_rosters (
    class_name varchar(10) PRIMARY KEY REFERENCES classes(class_name),
    version integer NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS roster_students (
    id serial PRIMARY KEY,
    external_id text UNIQUE NOT NULL,
    class_name varchar(10) NOT NULL REFERENCES class_rosters(class_name),
    full_name text NOT NULL,
    aliases jsonb NOT NULL DEFAULT '[]',
    active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS roster_students_class ON roster_students(class_name) WHERE active;

CREATE TABLE IF NOT EXISTS student_attendance (
    student_id integer NOT NULL REFERENCES roster_students(id),
    date date NOT NULL,
    class_name varchar(10) NOT NULL,
    status text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'left')),
    arrived_late boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (status='left' OR arrived_late=(status='late')),
    PRIMARY KEY (student_id, date)
);
CREATE INDEX IF NOT EXISTS student_attendance_date ON student_attendance(date, class_name);

CREATE TABLE IF NOT EXISTS attendance_events (
    id bigserial PRIMARY KEY,
    student_id integer REFERENCES roster_students(id),
    date date NOT NULL,
    class_name varchar(10) NOT NULL,
    old_status text,
    new_status text,
    actor_id bigint NOT NULL,
    chat_id bigint NOT NULL,
    message_id bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Persistent clarification sessions survive PM2 restarts. Only one session
-- per class/date may remain open; a new submission supersedes the old one.
CREATE TABLE IF NOT EXISTS attendance_pending (
    id uuid PRIMARY KEY,
    class_name varchar(10) NOT NULL,
    date date NOT NULL,
    actor_id bigint NOT NULL,
    chat_id bigint NOT NULL,
    message_id bigint NOT NULL,
    prompt_id bigint,
    roster_version integer NOT NULL,
    payload jsonb NOT NULL,
    state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'done', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '2 hours',
    UNIQUE(chat_id, message_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_pending_open ON attendance_pending(class_name, date) WHERE state = 'open';

CREATE TABLE IF NOT EXISTS weekly_student_deliveries (
    week_start date NOT NULL,
    chat_id bigint NOT NULL,
    state text NOT NULL DEFAULT 'sending' CHECK (state IN ('sending','sent')),
    claimed_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    PRIMARY KEY (week_start, chat_id)
);
COMMIT;
