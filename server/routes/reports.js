import express from 'express';
import { db, getSetting } from '../db/index.js';

const router = express.Router();

function buildStudentReport(studentId) {
  const st = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!st) throw new Error('الطالب غير موجود');
  const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(st.section_id);
  const assessments = db.prepare('SELECT * FROM assessments WHERE section_id = ? ORDER BY sort_order').all(st.section_id);
  const gradeRows = db.prepare('SELECT assessment_id, score FROM grades WHERE student_id = ?').all(studentId);
  const byAssessment = Object.fromEntries(gradeRows.map(g => [g.assessment_id, g.score]));

  const grades = assessments.map(a => ({
    name: a.name, max: a.max_score,
    score: typeof byAssessment[a.id] === 'number' ? byAssessment[a.id] : null,
  }));
  const scored = grades.filter(g => g.score !== null);
  const total = scored.reduce((s, g) => s + g.score, 0);
  const gradedMax = scored.reduce((s, g) => s + g.max, 0);
  const percent = gradedMax > 0 ? Math.round((total / gradedMax) * 1000) / 10 : null;

  const incidents = db.prepare('SELECT * FROM incidents WHERE student_id = ? ORDER BY date DESC, id DESC').all(studentId)
    .map(i => ({ ...i, tags: i.tags ? JSON.parse(i.tags) : [] }));

  const att = db.prepare(`SELECT
      SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) present,
      SUM(CASE WHEN status='absent' THEN 1 ELSE 0 END) absent,
      SUM(CASE WHEN status='late' THEN 1 ELSE 0 END) late,
      COUNT(*) total FROM attendance WHERE student_id = ?`).get(studentId);
  const attendanceRate = att.total > 0 ? Math.round((att.present / att.total) * 1000) / 10 : null;

  return {
    student: { id: st.id, name: st.original_name },
    section: section ? { grade: section.grade, name: section.name } : null,
    grades, total, gradedMax, percent,
    attendance: { ...att, rate: attendanceRate },
    incidents,
    behaviorCount: incidents.filter(i => i.kind === 'behavior').length,
    bookCount: incidents.filter(i => i.kind === 'book').length,
    generatedAt: new Date().toISOString().slice(0, 10),
  };
}

// نص رسالة عربية مهذبة ومختصرة جاهز للنسخ إلى واتساب
function whatsappMessage(r) {
  const lines = [];
  lines.push('السلام عليكم ورحمة الله وبركاته');
  lines.push('');
  lines.push(`ولي أمر الطالب: ${r.student.name}`);
  if (r.section) lines.push(`الصف: ${r.section.grade} / الشعبة: ${r.section.name}`);
  lines.push('مادة: تقنية المعلومات');
  lines.push('');

  if (r.grades.some(g => g.score !== null)) {
    lines.push('*الدرجات:*');
    for (const g of r.grades) {
      if (g.score !== null) lines.push(`• ${g.name}: ${g.score} من ${g.max}`);
    }
    if (r.percent !== null) lines.push(`• المجموع: ${r.total} من ${r.gradedMax} (${r.percent}%)`);
    lines.push('');
  }

  if (r.attendance.total > 0) {
    lines.push('*الحضور:*');
    lines.push(`• نسبة الحضور: ${r.attendance.rate}%`);
    if (r.attendance.absent > 0) lines.push(`• أيام الغياب: ${r.attendance.absent}`);
    if (r.attendance.late > 0) lines.push(`• مرات التأخر: ${r.attendance.late}`);
    lines.push('');
  }

  if (r.behaviorCount > 0 || r.bookCount > 0) {
    lines.push('*ملاحظات:*');
    if (r.behaviorCount > 0) lines.push(`• مخالفات سلوكية: ${r.behaviorCount}`);
    if (r.bookCount > 0) lines.push(`• عدم إحضار الكتاب: ${r.bookCount}`);
    const recent = r.incidents.slice(0, 3);
    for (const i of recent) {
      const label = i.kind === 'behavior' ? 'سلوك' : 'الكتاب';
      const detail = [i.tags.join('، '), i.note].filter(Boolean).join(' — ');
      lines.push(`  - ${i.date} (${label})${detail ? ': ' + detail : ''}`);
    }
    lines.push('');
    lines.push('نرجو منكم متابعة الطالب والتعاون معنا لمصلحته.');
  } else {
    lines.push('نشكر لكم متابعتكم، ونثني على التزام الطالب.');
  }

  lines.push('');
  lines.push('وتفضلوا بقبول فائق الاحترام،');
  lines.push('معلم مادة تقنية المعلومات');
  return lines.join('\n');
}

router.get('/reports/student/:id', (req, res) => {
  try {
    const r = buildStudentReport(Number(req.params.id));
    res.json({ ...r, message: whatsappMessage(r) });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// توليد تقارير شعبة كاملة دفعة واحدة
router.get('/reports/section/:id', (req, res) => {
  try {
    const sectionId = Number(req.params.id);
    const students = db.prepare("SELECT id FROM students WHERE section_id = ? AND status='active'").all(sectionId);
    const reports = students.map(s => {
      const r = buildStudentReport(s.id);
      return { ...r, message: whatsappMessage(r) };
    });
    const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId);
    res.json({ section, reports });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
