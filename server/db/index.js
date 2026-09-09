import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const BACKUPS_DIR = path.join(ROOT, 'backups');
export const EXPORTS_DIR = path.join(ROOT, 'exports');
export const SUBMISSIONS_DIR = path.join(ROOT, 'submissions');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

for (const d of [DATA_DIR, BACKUPS_DIR, EXPORTS_DIR, SUBMISSIONS_DIR, UPLOADS_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'school.db');
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grade INTEGER NOT NULL,            -- 6 / 7 / 8
  name TEXT NOT NULL,                -- اسم الشعبة مثل "أ"
  UNIQUE(grade, name)
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES sections(id),
  original_name TEXT NOT NULL,       -- الاسم كما ورد في الملف الوزاري، لا يُعدَّل
  normalized_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active / removed
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_students_section ON students(section_id);
CREATE INDEX IF NOT EXISTS idx_students_norm ON students(normalized_name);

CREATE TABLE IF NOT EXISTS student_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  from_section_id INTEGER REFERENCES sections(id),
  to_section_id INTEGER NOT NULL REFERENCES sections(id),
  moved_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES sections(id),
  name TEXT NOT NULL,
  max_score REAL NOT NULL DEFAULT 20,
  sort_order INTEGER NOT NULL DEFAULT 0,
  template_column TEXT               -- حرف العمود في الملف الوزاري إن كان مرتبطًا
);

CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  assessment_id INTEGER NOT NULL REFERENCES assessments(id),
  score REAL,
  client_uuid TEXT UNIQUE,           -- لمنع التكرار عند المزامنة دون اتصال
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(student_id, assessment_id)
);

CREATE TABLE IF NOT EXISTS grade_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  assessment_id INTEGER NOT NULL,
  old_score REAL,
  new_score REAL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  kind TEXT NOT NULL,                -- behavior / book
  date TEXT NOT NULL,
  period INTEGER,                    -- الحصة
  tags TEXT,                         -- JSON array
  note TEXT,
  client_uuid TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL,              -- present / absent / late
  client_uuid TEXT UNIQUE,
  UNIQUE(student_id, date)
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sheet_name TEXT NOT NULL,
  header_row INTEGER NOT NULL,
  first_data_row INTEGER NOT NULL,
  last_data_row INTEGER NOT NULL,
  name_column TEXT NOT NULL,         -- حرف عمود اسم الطالب
  grade_column TEXT,                 -- حرف عمود الصف إن وجد
  section_column TEXT,               -- حرف عمود الشعبة إن وجد
  score_columns TEXT NOT NULL,       -- JSON: [{col, header, max}]
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS import_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  file_row INTEGER NOT NULL,         -- رقم الصف في الملف الوزاري
  file_name TEXT NOT NULL,           -- الاسم كما في الملف
  decided_by TEXT NOT NULL,          -- auto-exact / manual
  decided_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(template_id, student_id),
  UNIQUE(template_id, file_row)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,              -- import / export / submit / backup
  file TEXT,
  cells_written INTEGER,
  details TEXT,                      -- JSON
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// هجرات بسيطة: إضافة أعمدة جديدة للقوالب القديمة دون فقد بيانات
const templateCols = db.prepare('PRAGMA table_info(templates)').all().map(c => c.name);
if (!templateCols.includes('source_upload_id')) {
  db.exec('ALTER TABLE templates ADD COLUMN source_upload_id TEXT');
}
if (!templateCols.includes('section_id')) {
  db.exec('ALTER TABLE templates ADD COLUMN section_id INTEGER');
}

const defaultSettings = {
  behavior_alert_threshold: '3',
  absence_alert_threshold: '5',
  failing_threshold_percent: '50',
  incident_tags: JSON.stringify(['مقاطعة', 'عدم إنجاز', 'استخدام الجوال', 'تأخر']),
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaultSettings)) insSetting.run(k, v);

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function audit(action, { file = null, cellsWritten = null, details = null, result = null } = {}) {
  db.prepare('INSERT INTO audit_log(action, file, cells_written, details, result) VALUES (?, ?, ?, ?, ?)')
    .run(action, file, cellsWritten, details ? JSON.stringify(details) : null, result);
}

// نسخة احتياطية من قاعدة البيانات قبل أي عملية حساسة
export function backupDatabase(reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(BACKUPS_DIR, `school-${stamp}-${reason}.db`);
  db.pragma('wal_checkpoint(TRUNCATE)');
  fs.copyFileSync(DB_PATH, dest);
  audit('backup', { file: dest, result: 'ok', details: { reason } });
  return dest;
}
