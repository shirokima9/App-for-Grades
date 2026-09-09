// تصدير نسخة العمل الخاصة بالمعلم (ملف جديد تمامًا في exports/).
// هذه النسخة ليست الملف الوزاري: نضيف فيها أعمدة السلوك والكتاب والملاحظات،
// ونرتب الأسماء ترتيبًا عربيًا صحيحًا. هذا الترتيب لا يُطبَّق أبدًا على الملف الوزاري.

import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { db, EXPORTS_DIR } from '../db/index.js';

// ترتيب أبجدي عربي صحيح عبر مُقارن اللغة العربية
const arabicCollator = new Intl.Collator('ar', { sensitivity: 'base', numeric: true });
export function sortArabic(names, keyFn = (x) => x) {
  return [...names].sort((a, b) => arabicCollator.compare(keyFn(a), keyFn(b)));
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, '_').trim();
}

export async function exportTeacherCopy(sectionId) {
  const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId);
  if (!section) throw new Error('الشعبة غير موجودة');

  const students = db.prepare("SELECT * FROM students WHERE section_id = ? AND status='active'").all(sectionId);
  const assessments = db.prepare('SELECT * FROM assessments WHERE section_id = ? ORDER BY sort_order').all(sectionId);
  const sorted = sortArabic(students, (s) => s.original_name);

  const gradeStmt = db.prepare('SELECT assessment_id, score FROM grades WHERE student_id = ?');
  const incStmt = db.prepare('SELECT kind, date, tags, note FROM incidents WHERE student_id = ? ORDER BY date');
  const attStmt = db.prepare("SELECT status, COUNT(*) c FROM attendance WHERE student_id = ? GROUP BY status");

  const wb = new ExcelJS.Workbook();
  wb.creator = 'درجاتي — نسخة عمل المعلم';
  wb.created = new Date();
  const ws = wb.addWorksheet(`${section.grade}-${section.name}`, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });

  const headers = ['م', 'اسم الطالب', ...assessments.map(a => a.name), 'المجموع',
    'السلوك', 'الكتاب', 'الغياب', 'التأخر', 'الملاحظات'];
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true, size: 12 };
  ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEFEC' } };

  sorted.forEach((st, i) => {
    const grades = Object.fromEntries(gradeStmt.all(st.id).map(g => [g.assessment_id, g.score]));
    const incidents = incStmt.all(st.id);
    const behavior = incidents.filter(x => x.kind === 'behavior').length;
    const book = incidents.filter(x => x.kind === 'book').length;
    const att = Object.fromEntries(attStmt.all(st.id).map(a => [a.status, a.c]));

    // الملاحظات تُجمَع مع تواريخها
    const notes = incidents
      .filter(x => (x.note && x.note.trim()) || (x.tags && x.tags !== '[]'))
      .map(x => {
        const tags = x.tags ? JSON.parse(x.tags) : [];
        const label = x.kind === 'behavior' ? 'سلوك' : 'كتاب';
        const parts = [x.date, label];
        if (tags.length) parts.push(tags.join('، '));
        if (x.note && x.note.trim()) parts.push(x.note.trim());
        return parts.join(' — ');
      })
      .join(' | ');

    const scores = assessments.map(a => (grades[a.id] ?? null));
    const total = scores.reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);

    const row = ws.addRow([
      i + 1, st.original_name, ...scores, total,
      behavior, book, att.absent || 0, att.late || 0, notes,
    ]);
    row.alignment = { vertical: 'middle' };
    // تمييز بصري: مخالفات متكررة
    if (behavior >= 3) {
      row.getCell(headers.indexOf('السلوك') + 1).fill =
        { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
    }
  });

  ws.columns.forEach((col, i) => {
    col.width = i === 1 ? 34 : (headers[i] === 'الملاحظات' ? 60 : 11);
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  const fileName = `درجاتي_${safeName(section.grade + '-' + section.name)}_${stamp()}.xlsx`;
  const outPath = path.join(EXPORTS_DIR, fileName);
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  await wb.xlsx.writeFile(outPath);
  return { fileName, outPath, students: sorted.length };
}
