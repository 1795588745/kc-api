const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.db');

let db = null;

async function init() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  // 建表
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      day_of_week INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      type TEXT NOT NULL,
      duration REAL NOT NULL,
      students TEXT NOT NULL DEFAULT '[]',
      note TEXT DEFAULT '',
      start_date TEXT,
      end_date TEXT
    );

    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      type TEXT NOT NULL,
      duration REAL NOT NULL,
      students TEXT NOT NULL DEFAULT '[]',
      fee REAL NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      rule_id TEXT
    );

    CREATE TABLE IF NOT EXISTS detached (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      rule_id TEXT NOT NULL,
      date TEXT NOT NULL,
      UNIQUE(user_id, rule_id, date)
    );
  `);

  // 索引
  db.run('CREATE INDEX IF NOT EXISTS idx_courses_user_date ON courses(user_id, date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_rules_user ON rules(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_detached_user ON detached(user_id)');

  save();
  return db;
}

function save() {
  if (!db) return;
  const data = db.export();
  const buf = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buf);
}

// 封装 sql.js 的查询：将结果数组转换为对象数组
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function run(sql, params = []) {
  db.run(sql, params);
  save();
  return { changes: db.getRowsModified() };
}

// 事务：传入 sql + params 数组的数组
function transaction(ops) {
  db.run('BEGIN');
  try {
    for (const op of ops) {
      db.run(op.sql, op.params);
    }
    db.run('COMMIT');
    save();
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }
}

module.exports = { init, save, db: () => db, queryAll, queryOne, run, transaction };
