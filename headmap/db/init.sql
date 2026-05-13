-- headmap SOPs Builder — Database Schema
 
-- ── USERS ──────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username    TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,           -- bcrypt hash
  display_name TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
  created_at  TIMESTAMPTZ DEFAULT now()
);
 
-- ── APP DATA (one row per user) ─────────────────────────────────────────────
CREATE TABLE user_data (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme       TEXT NOT NULL DEFAULT 'white',
  roles       JSONB NOT NULL DEFAULT '[]',
  divisions   JSONB NOT NULL DEFAULT '[]',
  people      JSONB NOT NULL DEFAULT '[]',
  sops        JSONB NOT NULL DEFAULT '[]',
  updated_at  TIMESTAMPTZ DEFAULT now()
);
 
-- ── SEED: default admin account ─────────────────────────────────────────────
-- password: admin123  (bcrypt, cost 10)
INSERT INTO users (username, password, display_name, role)
VALUES (
  'admin',
  '$2a$12$juC5cg1VKh8ZVqPrqRLbau6f.LLobmFfpnTdZUEbskReMPZ85dWlG',
  'Administrator',
  'admin'
);
 
INSERT INTO user_data (user_id)
SELECT id FROM users WHERE username = 'admin';
 
