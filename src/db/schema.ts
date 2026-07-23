export const SCHEMA_VERSION = 10

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
  country_id TEXT REFERENCES countries(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS countries (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  nationality_label TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  league_id TEXT REFERENCES leagues(id) ON DELETE SET NULL,
  country_id TEXT REFERENCES countries(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  short_name TEXT,
  primary_color TEXT NOT NULL,
  secondary_color TEXT,
  gk_color TEXT NOT NULL,
  is_national_team INTEGER NOT NULL DEFAULT 0,
  national_team_label TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS edition_players (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  skin_tone TEXT NOT NULL DEFAULT 'medium',
  country_id TEXT REFERENCES countries(id) ON DELETE SET NULL,
  preferred_shirt_number INTEGER,
  has_custom_glb INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS player_attributes (
  player_id TEXT PRIMARY KEY REFERENCES edition_players(id) ON DELETE CASCADE,
  pace INTEGER NOT NULL DEFAULT 65,
  acceleration INTEGER NOT NULL DEFAULT 65,
  stamina INTEGER NOT NULL DEFAULT 65,
  strength INTEGER NOT NULL DEFAULT 65,
  agility INTEGER NOT NULL DEFAULT 65,
  dribbling INTEGER NOT NULL DEFAULT 65,
  passing INTEGER NOT NULL DEFAULT 65,
  shot_power INTEGER NOT NULL DEFAULT 65,
  finishing INTEGER NOT NULL DEFAULT 65,
  tackling INTEGER NOT NULL DEFAULT 65,
  vision INTEGER NOT NULL DEFAULT 65,
  goalkeeping INTEGER NOT NULL DEFAULT 65
);

CREATE TABLE IF NOT EXISTS team_roster (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES edition_players(id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL,
  position_label TEXT NOT NULL DEFAULT 'CM',
  shirt_number INTEGER,
  UNIQUE(team_id, slot_index),
  UNIQUE(team_id, player_id)
);

CREATE TABLE IF NOT EXISTS team_tactics (
  team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  formation_preset_id TEXT NOT NULL DEFAULT '4-4-2',
  mentality TEXT NOT NULL DEFAULT 'balanced',
  build_up TEXT NOT NULL DEFAULT 'mixed',
  chance_creation TEXT NOT NULL DEFAULT 'balanced',
  defensive_style TEXT NOT NULL DEFAULT 'balanced',
  width INTEGER NOT NULL DEFAULT 50,
  depth INTEGER NOT NULL DEFAULT 50,
  press_intensity INTEGER NOT NULL DEFAULT 50,
  tempo INTEGER NOT NULL DEFAULT 50
);

CREATE TABLE IF NOT EXISTS team_formation_slots (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL,
  x REAL NOT NULL,
  z REAL NOT NULL,
  position_label TEXT NOT NULL,
  role TEXT NOT NULL,
  lane TEXT NOT NULL DEFAULT 'C',
  PRIMARY KEY (team_id, slot_index)
);

CREATE TABLE IF NOT EXISTS team_player_instructions (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES edition_players(id) ON DELETE CASCADE,
  support_runs TEXT NOT NULL DEFAULT 'balanced',
  attacking_runs TEXT NOT NULL DEFAULT 'mixed',
  interceptions TEXT NOT NULL DEFAULT 'normal',
  positioning_freedom TEXT NOT NULL DEFAULT 'balanced',
  PRIMARY KEY (team_id, player_id)
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
  entity_type TEXT NOT NULL CHECK(entity_type IN ('league', 'team', 'player', 'country')),
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
