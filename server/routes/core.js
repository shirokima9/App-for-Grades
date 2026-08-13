import express from 'express';
import { db, getSetting, setSetting } from '../db/index.js';

const router = express.Router();

router.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

router.get('/sections', (req, res) => {
  const sections = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM students st WHERE st.section_id = s.id AND st.status='active') AS student_count
    FROM sections s ORDER BY s.grade, s.name`).all();
  res.json(sections);
});

router.post('/sections', (req, res) => {
  const { grade, name } = req.body;
  if (![6, 7, 8].includes(Number(grade)) || !name?.trim()) {
    return res.status(400).json({ error: 'الصف يجب أن يكون 6 أو 7 أو 8 مع اسم شعبة' });
  }
  try {
    const info = db.prepare('INSERT INTO sections(grade, name) VALUES (?, ?)').run(Number(grade), name.trim());
    res.json(db.prepare('SELECT * FROM sections WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'هذه الشعبة موجودة مسبقًا' });
    res.status(500).json({ error: e.message });
  }
});

router.get('/students', (req, res) => {
  const { section_id } = req.query;
  const rows = section_id
    ? db.prepare("SELECT * FROM students WHERE section_id = ? AND status='active' ORDER BY original_name").all(section_id)
    : db.prepare("SELECT * FROM students WHERE status='active' ORDER BY original_name").all();
  res.json(rows);
});

router.get('/templates', (req, res) => {
  res.json(db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all());
});

router.get('/assessments', (req, res) => {
  const { section_id } = req.query;
  if (!section_id) return res.status(400).json({ error: 'section_id مطلوب' });
  res.json(db.prepare('SELECT * FROM assessments WHERE section_id = ? ORDER BY sort_order').all(section_id));
});

router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

router.put('/settings/:key', (req, res) => {
  setSetting(req.params.key, String(req.body.value));
  res.json({ ok: true });
});

router.get('/audit', (req, res) => {
  res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all());
});

export default router;
