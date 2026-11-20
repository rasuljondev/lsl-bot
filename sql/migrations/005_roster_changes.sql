-- Audit trail for student-list edits made through the bot (additive, safe to rerun).
BEGIN;
CREATE TABLE IF NOT EXISTS roster_changes (
    id bigserial PRIMARY KEY,
    actor_id bigint NOT NULL,
    class_name varchar(10) NOT NULL,
    student_id integer REFERENCES roster_students(id),
    action text NOT NULL CHECK (action IN ('add', 'reactivate', 'remove', 'rename')),
    old_name text,
    new_name text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roster_changes_class ON roster_changes(class_name, created_at);
COMMIT;
