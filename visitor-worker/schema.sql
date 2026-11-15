-- One row per recorded visit (owner-only; served by /log)
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  ip TEXT,
  city TEXT,
  region TEXT,
  country TEXT,
  lat REAL,
  lon REAL,
  org TEXT,
  ref TEXT,
  path TEXT,
  ua TEXT
);

-- Running per-city totals for the public globe (/points)
CREATE TABLE IF NOT EXISTS places (
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  lat REAL,
  lon REAL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (country, city)
);

-- Running totals by kind ('total', 'country', 'ref', 'browser') for /stats
CREATE TABLE IF NOT EXISTS tallies (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, key)
);
