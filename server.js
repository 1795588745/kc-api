const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { init, queryAll, queryOne, run, transaction } = require('./db');
const { signToken, authMiddleware } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ==================== 注册 / 登录 ====================

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: '用户名长度2-20字符' });
  if (password.length < 4) return res.status(400).json({ error: '密码至少4位' });

  const existing = queryOne('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return res.status(409).json({ error: '用户名已被注册' });

  const hash = bcrypt.hashSync(password, 10);
  run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash]);

  const user = queryOne('SELECT id FROM users WHERE username = ?', [username]);
  const token = signToken(user.id, username);
  res.json({ token, userId: user.id, username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });

  const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = signToken(user.id, user.username);
  res.json({ token, userId: user.id, username: user.username });
});

// ==================== 课程 CRUD ====================

app.get('/api/courses', authMiddleware, (req, res) => {
  const { start, end } = req.query;
  let rows;
  if (start && end) {
    rows = queryAll('SELECT * FROM courses WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date, start_time',
      [req.userId, start, end]);
  } else {
    rows = queryAll('SELECT * FROM courses WHERE user_id = ? ORDER BY date, start_time', [req.userId]);
  }
  const courses = rows.map(r => ({ ...r, students: JSON.parse(r.students || '[]') }));
  res.json({ courses });
});

app.post('/api/courses/batch', authMiddleware, (req, res) => {
  const { courses } = req.body;
  if (!Array.isArray(courses)) return res.status(400).json({ error: 'courses 必须是数组' });

  const ops = courses.map(c => ({
    sql: 'INSERT OR REPLACE INTO courses (id, user_id, date, start_time, type, duration, students, fee, note, rule_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    params: [c.id, req.userId, c.date, c.startTime, c.type, c.duration, JSON.stringify(c.students || []), c.fee || 0, c.note || '', c.ruleId || null]
  }));

  transaction(ops);
  res.json({ ok: true, count: courses.length });
});

app.post('/api/courses', authMiddleware, (req, res) => {
  const { id, date, startTime, type, duration, students, fee, note, ruleId } = req.body;
  if (!id || !date || !startTime) return res.status(400).json({ error: '缺少必填字段' });

  run('INSERT INTO courses (id, user_id, date, start_time, type, duration, students, fee, note, rule_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [id, req.userId, date, startTime, type, duration, JSON.stringify(students || []), fee || 0, note || '', ruleId || null]);
  res.json({ ok: true, id });
});

app.put('/api/courses/:id', authMiddleware, (req, res) => {
  const { date, startTime, type, duration, students, fee, note, ruleId } = req.body;
  const r = run(
    'UPDATE courses SET date=?,start_time=?,type=?,duration=?,students=?,fee=?,note=?,rule_id=? WHERE id=? AND user_id=?',
    [date, startTime, type, duration, JSON.stringify(students || []), fee || 0, note || '', ruleId || null, req.params.id, req.userId]
  );
  if (r.changes === 0) return res.status(404).json({ error: '课程不存在' });
  res.json({ ok: true });
});

app.delete('/api/courses/:id', authMiddleware, (req, res) => {
  const r = run('DELETE FROM courses WHERE id=? AND user_id=?', [req.params.id, req.userId]);
  if (r.changes === 0) return res.status(404).json({ error: '课程不存在' });
  res.json({ ok: true });
});

// ==================== 规则 CRUD ====================

app.get('/api/rules', authMiddleware, (req, res) => {
  const rows = queryAll('SELECT * FROM rules WHERE user_id = ? ORDER BY id', [req.userId]);
  const rules = rows.map(r => ({ ...r, students: JSON.parse(r.students || '[]') }));
  res.json({ rules });
});

app.post('/api/rules', authMiddleware, (req, res) => {
  const { id, dayOfWeek, startTime, type, duration, students, note, startDate, endDate } = req.body;
  if (!id || dayOfWeek == null || !startTime) return res.status(400).json({ error: '缺少必填字段' });

  run('INSERT INTO rules (id, user_id, day_of_week, start_time, type, duration, students, note, start_date, end_date) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [id, req.userId, dayOfWeek, startTime, type, duration, JSON.stringify(students || []), note || '', startDate || null, endDate || null]);
  res.json({ ok: true, id });
});

app.put('/api/rules/:id', authMiddleware, (req, res) => {
  const { dayOfWeek, startTime, type, duration, students, note, startDate, endDate } = req.body;
  const r = run(
    'UPDATE rules SET day_of_week=?,start_time=?,type=?,duration=?,students=?,note=?,start_date=?,end_date=? WHERE id=? AND user_id=?',
    [dayOfWeek, startTime, type, duration, JSON.stringify(students || []), note || '', startDate || null, endDate || null, req.params.id, req.userId]
  );
  if (r.changes === 0) return res.status(404).json({ error: '规则不存在' });
  res.json({ ok: true });
});

app.delete('/api/rules/:id', authMiddleware, (req, res) => {
  run('DELETE FROM courses WHERE rule_id=? AND user_id=?', [req.params.id, req.userId]);
  const r = run('DELETE FROM rules WHERE id=? AND user_id=?', [req.params.id, req.userId]);
  if (r.changes === 0) return res.status(404).json({ error: '规则不存在' });
  res.json({ ok: true });
});

// ==================== Detached 记录 ====================

app.get('/api/detached', authMiddleware, (req, res) => {
  const rows = queryAll('SELECT * FROM detached WHERE user_id = ?', [req.userId]);
  res.json({ detached: rows.map(r => ({ ruleId: r.rule_id, date: r.date })) });
});

app.post('/api/detached', authMiddleware, (req, res) => {
  const { ruleId, date } = req.body;
  if (!ruleId || !date) return res.status(400).json({ error: '缺少 ruleId 或 date' });
  run('INSERT OR IGNORE INTO detached (user_id, rule_id, date) VALUES (?,?,?)', [req.userId, ruleId, date]);
  res.json({ ok: true });
});

app.delete('/api/detached/:ruleId/:date', authMiddleware, (req, res) => {
  const r = run('DELETE FROM detached WHERE user_id=? AND rule_id=? AND date=?',
    [req.userId, req.params.ruleId, req.params.date]);
  res.json({ ok: true, deleted: r.changes > 0 });
});

// ==================== 健康检查 ====================

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ==================== 启动 ====================

async function start() {
  await init();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
