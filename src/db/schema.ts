export const SCHEMA_VERSION = 6

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS editions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS leagues (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  league_id TEXT REFERENCES leagues(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  short_name TEXT,
  primary_color TEXT NOT NULL,
  secondary_color TEXT,
  gk_color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS edition_players (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  skin_tone TEXT NOT NULL DEFAULT 'medium',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_roster (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES edition_players(id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL,
  position_label TEXT NOT NULL DEFAULT 'CM',
  UNIQUE(team_id, slot_index),
  UNIQUE(team_id, player_id)
);

CREATE TABLE IF NOT EXISTS team_kits (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kit_number INTEGER NOT NULL CHECK(kit_number IN (1, 2)),
  shirt_color TEXT NOT NULL,
  shorts_color TEXT NOT NULL,
  socks_color TEXT NOT NULL,
  PRIMARY KEY (team_id, kit_number)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_images (
  entity_type TEXT NOT NULL CHECK(entity_type IN ('league', 'team', 'player')),
  entity_id TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS team_kit_shirt (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kit_number INTEGER NOT NULL CHECK(kit_number IN (1, 2)),
  mime_type TEXT,
  data BLOB,
  uv_repeat_x REAL NOT NULL DEFAULT 1,
  uv_repeat_y REAL NOT NULL DEFAULT 1,
  uv_offset_x REAL NOT NULL DEFAULT 0,
  uv_offset_y REAL NOT NULL DEFAULT 0,
  flip_horizontal INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (team_id, kit_number)
);
`
