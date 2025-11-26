-- Classes table to store class information
CREATE TABLE IF NOT EXISTS classes (
    id SERIAL PRIMARY KEY,
    class_name VARCHAR(10) UNIQUE NOT NULL,
    total_students INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert fixed class list with their total student counts
-- Note: Update total_students values based on actual data
INSERT INTO classes (class_name, total_students) VALUES
    ('1A', 0),
    ('1B', 0),
    ('2A', 0),
    ('2B', 0),
    ('3A', 0),
    ('4A', 0),
    ('5A', 0),
    ('5B', 0),
    ('6A', 0),
    ('6B', 0),
    ('7A', 0),
    ('8A', 0),
    ('8B', 0),
    ('9A', 0),
    ('9B', 0),
    ('10A', 0),
    ('10B', 0),
    ('11A', 0)
ON CONFLICT (class_name) DO NOTHING;

-- Attendance logs table to store daily attendance records
CREATE TABLE IF NOT EXISTS attendance_logs (
    id SERIAL PRIMARY KEY,
    class_name VARCHAR(10) NOT NULL,
    present_count INTEGER NOT NULL DEFAULT 0,
    total_students INTEGER NOT NULL,
    student_names JSONB DEFAULT '[]'::jsonb,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(class_name, date)
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_attendance_logs_date ON attendance_logs(date);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_class_name ON attendance_logs(class_name);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_class_date ON attendance_logs(class_name, date);

-- Authorized users (automatically receive all updates)
CREATE TABLE IF NOT EXISTS authorized_users (
    id SERIAL PRIMARY KEY,
    user_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(255),
    chat_id BIGINT NOT NULL,
    authorized_by BIGINT NOT NULL,
    authorized_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active'
);

-- Pending user requests
CREATE TABLE IF NOT EXISTS pending_user_requests (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    username VARCHAR(255),
    chat_id BIGINT NOT NULL,
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending'
);

-- Indexes for user tables
CREATE INDEX IF NOT EXISTS idx_authorized_users_user_id ON authorized_users(user_id);
CREATE INDEX IF NOT EXISTS idx_authorized_users_status ON authorized_users(status);
CREATE INDEX IF NOT EXISTS idx_pending_requests_user_id ON pending_user_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_requests_status ON pending_user_requests(status);

