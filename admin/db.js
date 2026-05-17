'use strict';

const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const fs      = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'admin.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

/* ── Promise wrapper around sqlite3's callback API ─────────────────────────── */
class DB {
  constructor(db) { this._db = db; }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this._db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) =>
      this._db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) =>
      this._db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || [])));
  }

  close() {
    return new Promise((resolve, reject) =>
      this._db.close(err => err ? reject(err) : resolve()));
  }
}

/* ── Schema ─────────────────────────────────────────────────────────────────── */
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'super_admin',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hotels (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                 TEXT UNIQUE NOT NULL,
  name                 TEXT NOT NULL,
  affiliate_url        TEXT,
  location             TEXT,
  region               TEXT,
  star_rating          INTEGER DEFAULT 5,
  price_per_night_usd  REAL,
  description_override TEXT,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hotel_images (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id      INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  alt_text      TEXT DEFAULT '',
  display_order INTEGER DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  username    TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  detail      TEXT,
  ip_address  TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS build_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  status      TEXT NOT NULL DEFAULT 'pending',
  output      TEXT DEFAULT '',
  exit_code   INTEGER,
  started_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_hotel_images_hotel_id ON hotel_images(hotel_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at  ON audit_log(created_at DESC);
`;

/* ── Open and initialise ─────────────────────────────────────────────────────── */
let _db;

function openDb() {
  return new Promise((resolve, reject) => {
    const raw = new sqlite3.Database(DB_PATH, err => {
      if (err) return reject(err);
      const db = new DB(raw);
      raw.exec(SCHEMA, err2 => {
        if (err2) return reject(err2);
        resolve(db);
      });
    });
  });
}

async function getDb() {
  if (!_db) _db = await openDb();
  return _db;
}

module.exports = { getDb, DB_PATH };
