import express from 'express';
import { db, getSetting } from '../db/index.js';

const router = express.Router();

// ------------------------- الدرجات -------------------------

router.get('/grades', (req, res) => {
  const { section_id, assessment_id } = req.query;
  if (assessment_id) {
    return res.json(db.prepare('SELECT * FROM grades WHERE assessment_id = ?').all(assessment_id));
  }
  if (!section_id) return res.status(400).json({ error: 'section_id أو assessment_id مطلوب' });
  res.json(db.prepare(`
    SELECT g.* FROM grades g
    JOIN students s ON s.id = g.student_id
    WHERE s.section_id = ?`).all(section_id));
});

// حفظ فوري بعد كل درجة. client_uuid يمنع التكرار عند إعادة المزامنة.
const saveGrade = db.transaction(({ studentId, assessmentId, score, clientUuid }) => {
  if (clientUuid) {
    const dup = db.prepare('SELECT id FROM grades WHERE client_uuid = ?').get(clientUuid);
    if (dup) return { duplicate: true, id: dup.id };
  }
  const prev = db.prepare('SELECT score FROM grades WHERE student_id = ? AND assessment_id = ?')
    .get(studentId, assessmentId);
  db.prepare(`
    INSERT INTO grades(student_id, assessment_id, score, client_uuid, updated_at)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(student_id, assessment_id) DO UPDATE SET
      score = excluded.score,
      client_uuid = excluded.client_uuid,
      updated_at = excluded.updated_at`)
    .run(studentId, assessmentId, score, clientUuid || null);
  db.prepare('INSERT INTO grade_history(student_id, assessment_id, old_score, new_score) VALUES (?,?,?,?)')
    .run(studentId, assessmentId, prev ? prev.score : null, score);
  return { ok: true, previous: prev ? prev.score : null };
});

router.post('/grades', (req, res) => {
  try {
    const { studentId, assessmentId, score, clientUuid } = req.body;
    if (!studentId || !assessmentId) return res.status(400).json({ error: 'studentId و assessmentId مطلوبان' });
    const assessment = db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId);
    if (!assessment) return res.status(404).json({ error: 'عنصر التقييم غير موجود' });
    const value = score === null || score === '' ? null : Number(score);
    if (value !== null && (Number.isNaN(value) || value < 0 || value > assessment.max_score)) {
      return res.status(400).json({ error: `الدرجة يجب أن تكون بين 0 و ${assessment.max_score}` });
    }
    res.json(saveGrade({ studentId, assessmentId, score: value, clientUuid }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// تراجع عن آخر إدخال: نعيد القيمة السابقة من سجل التعديلات
router.post('/grades/undo', (req, res) => {
  try {
    const { studentId, assessmentId } = req.body;
    const last = db.prepare(`SELECT * FROM grade_history WHERE student_id = ? AND assessment_id = ?
      ORDER BY id DESC LIMIT 1`).get(studentId, assessmentId);
    if (!last) return res.status(404).json({ error: 'لا يوجد إدخال للتراجع عنه' });
    db.prepare(`UPDATE grades SET score = ?, updated_at = datetime('now','localtime')
      WHERE student_id = ? AND assessment_id = ?`).run(last.old_score, studentId, assessmentId);
    db.prepare('DELETE FROM grade_history WHERE id = ?').run(last.id);
    res.json({ ok: true, restored: last.old_score });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/assessments', (req, res) => {
  const { sectionId, name, maxScore } = req.body;
  if (!sectionId || !name?.trim()) return res.status(400).json({ error: 'الشعبة والاسم مطلوبان' });
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) m FROM assessments WHERE section_id = ?').get(sectionId).m;
  const info = db.prepare('INSERT INTO assessments(section_id, name, max_score, sort_order) VALUES (?,?,?,?)')
    .run(sectionId, name.trim(), Number(maxScore) || 20, max + 1);
  res.json(db.prepare('SELECT * FROM assessments WHERE id = ?').get(info.lastInsertRowid));
});

// ------------------------- السلوك والكتاب -------------------------

router.get('/incidents', (req, res) => {
  const { section_id, student_id } = req.query;
  if (student_id) {
    return res.json(db.prepare('SELECT * FROM incidents WHERE student_id = ? ORDER BY date DESC, id DESC').all(student_id));
  }
  if (!section_id) return res.status(400).json({ error: 'section_id مطلوب' });
  res.json(db.prepare(`
    SELECT i.* FROM incidents i JOIN students s ON s.id = i.student_id
    WHERE s.section_id = ? ORDER BY i.date DESC, i.id DESC`).all(section_id));
});

router.post('/incidents', (req, res) => {
  try {
    const { studentId, kind, date, period, tags, note, clientUuid } = req.body;
    if (!studentId || !['behavior', 'book'].includes(kind)) {
      return res.status(400).json({ error: 'نوع المخالفة يجب أن يكون behavior أو book' });
    }
    if (clientUuid) {
      const dup = db.prepare('SELECT id FROM incidents WHERE client_uuid = ?').get(clientUuid);
      if (dup) return res.json({ duplicate: true, id: dup.id });
    }
    const info = db.prepare(`INSERT INTO incidents(student_id, kind, date, period, tags, note, client_uuid)
      VALUES (?,?,?,?,?,?,?)`).run(
      studentId, kind,
      date || new Date().toISOString().slice(0, 10),
      period || null,
      JSON.stringify(tags || []),
      note || null,
      clientUuid || null
    );
    const count = db.prepare('SELECT COUNT(*) c FROM incidents WHERE student_id = ? AND kind = ?')
      .get(studentId, kind).c;
    const threshold = Number(getSetting('behavior_alert_threshold') || 3);
    res.json({ ok: true, id: info.lastInsertRowid, count, alert: count >= threshold, threshold });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/incidents/:id', (req, res) => {
  const info = db.prepare('DELETE FROM incidents WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'غير موجود' });
  res.json({ ok: true });
});

// شاشة التكرار: لكل طالب عدد المخالفات وتواريخها
router.get('/incidents/summary', (req, res) => {
  const { section_id } = req.query;
  if (!section_id) return res.status(400).json({ error: 'section_id مطلوب' });
  const students = db.prepare("SELECT * FROM students WHERE section_id = ? AND status='active'").all(section_id);
  const stmt = db.prepare('SELECT * FROM incidents WHERE student_id = ? ORDER BY date DESC, id DESC');
  const behaviorThreshold = Number(getSetting('behavior_alert_threshold') || 3);
  const rows = students.map(s => {
    const list = stmt.all(s.id);
    const behavior = list.filter(x => x.kind === 'behavior');
    const book = list.filter(x => x.kind === 'book');
    return {
      student: { id: s.id, name: s.original_name },
      behaviorCount: behavior.length,
      bookCount: book.length,
      overThreshold: behavior.length >= behaviorThreshold,
      incidents: list.map(x => ({ ...x, tags: x.tags ? JSON.parse(x.tags) : [] })),
    };
  });
  rows.sort((a, b) => (b.behaviorCount + b.bookCount) - (a.behaviorCount + a.bookCount));
  res.json({ rows, behaviorThreshold });
});

// ------------------------- الحضور -------------------------

router.get('/attendance', (req, res) => {
  const { section_id, date } = req.query;
  if (!section_id) return res.status(400).json({ error: 'section_id مطلوب' });
  if (date) {
    return res.json(db.prepare(`
      SELECT a.* FROM attendance a JOIN students s ON s.id = a.student_id
      WHERE s.section_id = ? AND a.date = ?`).all(section_id, date));
  }
  res.json(db.prepare(`
    SELECT a.* FROM attendance a JOIN students s ON s.id = a.student_id
    WHERE s.section_id = ? ORDER BY a.date DESC`).all(section_id));
});

router.post('/attendance', (req, res) => {
  try {
    const { studentId, date, status, clientUuid } = req.body;
    if (!studentId || !['present', 'absent', 'late'].includes(status)) {
      return res.status(400).json({ error: 'الحالة يجب أن تكون present أو absent أو late' });
    }
    const d = date || new Date().toISOString().slice(0, 10);
    db.prepare(`INSERT INTO attendance(student_id, date, status, client_uuid) VALUES (?,?,?,?)
      ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status`)
      .run(studentId, d, status, clientUuid || null);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// تقرير غياب تراكمي مع تنبيه عند تجاوز الحد
router.get('/attendance/summary', (req, res) => {
  const { section_id } = req.query;
  if (!section_id) return res.status(400).json({ error: 'section_id مطلوب' });
  const threshold = Number(getSetting('absence_alert_threshold') || 5);
  const rows = db.prepare(`
    SELECT s.id, s.original_name AS name,
      SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END) AS absent,
      SUM(CASE WHEN a.status='late' THEN 1 ELSE 0 END) AS late,
      SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS present,
      COUNT(a.id) AS total
    FROM students s LEFT JOIN attendance a ON a.student_id = s.id
    WHERE s.section_id = ? AND s.status='active'
    GROUP BY s.id ORDER BY absent DESC`).all(section_id);
  res.json({
    threshold,
    rows: rows.map(r => ({
      ...r,
      rate: r.total > 0 ? Math.round((r.present / r.total) * 100) : null,
      overThreshold: r.absent >= threshold,
    })),
  });
});

// ------------------------- المزامنة دون اتصال -------------------------
// دفعة من العمليات المتراكمة في IndexedDB تُرسَل عند عودة الاتصال.
router.post('/sync', (req, res) => {
  const { operations } = req.body;
  if (!Array.isArray(operations)) return res.status(400).json({ error: 'operations مطلوبة' });
  const results = [];
  for (const op of operations) {
    try {
      if (op.type === 'grade') {
        const a = db.prepare('SELECT * FROM assessments WHERE id = ?').get(op.assessmentId);
        if (!a) throw new Error('عنصر التقييم غير موجود');
        saveGrade({ studentId: op.studentId, assessmentId: op.assessmentId, score: op.score, clientUuid: op.clientUuid });
      } else if (op.type === 'incident') {
        const dup = op.clientUuid && db.prepare('SELECT id FROM incidents WHERE client_uuid = ?').get(op.clientUuid);
        if (!dup) {
          db.prepare(`INSERT INTO incidents(student_id, kind, date, period, tags, note, client_uuid)
            VALUES (?,?,?,?,?,?,?)`).run(op.studentId, op.kind, op.date, op.period || null,
            JSON.stringify(op.tags || []), op.note || null, op.clientUuid || null);
        }
      } else if (op.type === 'attendance') {
        db.prepare(`INSERT INTO attendance(student_id, date, status, client_uuid) VALUES (?,?,?,?)
          ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status`)
          .run(op.studentId, op.date, op.status, op.clientUuid || null);
      } else {
        throw new Error(`نوع عملية غير معروف: ${op.type}`);
      }
      results.push({ clientUuid: op.clientUuid, ok: true });
    } catch (e) {
      results.push({ clientUuid: op.clientUuid, ok: false, error: e.message });
    }
  }
  res.json({ results, synced: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length });
});

export default router;
