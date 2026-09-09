// التسليم: الكتابة في نسخة من الملف الوزاري — أخطر عملية في التطبيق.
//
// قواعد ملزمة مطبَّقة هنا:
// 1) كل تسليم يبدأ من الأصل النظيف: ننسخ الملف الأصلي المستورد ونكتب فيه كل
//    الدرجات المتراكمة دفعة واحدة. لا نكتب أبدًا فوق نسخة سبق أن كُتب فيها.
// 2) لا كتابة لطالب غير مثبَّت المطابقة — طالب واحد غير محسوم يوقف العملية كلها.
// 3) لا كتابة خارج أعمدة الدرجات المحددة في التخطيط، ولا في خلية معادلة.
// 4) فحص قيود Data Validation قبل الكتابة.
// 5) معاينة إلزامية (dry run) قبل أي كتابة، وتقرير تحقق بعدها.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { db, audit, backupDatabase, SUBMISSIONS_DIR, UPLOADS_DIR } from '../db/index.js';
import { scanWorkbook } from '../excel/scan.js';
import { writeGradesToCopy, verifyWrittenFile, structuralCounts } from '../excel/writer.js';
import { exportTeacherCopy } from '../excel/export.js';

const router = express.Router();

function originalPathFor(template) {
  if (!template.source_upload_id) {
    throw new Error('هذا القالب لا يحمل مرجعًا للملف الوزاري الأصلي — أعد الاستيراد مرة واحدة');
  }
  const p = path.join(UPLOADS_DIR, `${template.source_upload_id}.xlsx`);
  if (!fs.existsSync(p)) throw new Error('نسخة الملف الوزاري الأصلي غير موجودة — أعد الاستيراد');
  return p;
}

function colNum(letter) {
  let n = 0;
  for (const ch of String(letter).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// هل يقع مرجع الخلية داخل نطاق قاعدة تحقق؟
function rangeIncludesCell(range, colLetterStr, rowNum) {
  for (const part of String(range).split(/\s+/)) {
    const m = part.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
    if (!m) continue;
    const c1 = colNum(m[1]), r1 = Number(m[2]);
    const c2 = m[3] ? colNum(m[3]) : c1, r2 = m[4] ? Number(m[4]) : r1;
    const c = colNum(colLetterStr);
    if (c >= Math.min(c1, c2) && c <= Math.max(c1, c2)
      && rowNum >= Math.min(r1, r2) && rowNum <= Math.max(r1, r2)) return true;
  }
  return false;
}

function checkValidation(validations, colLetterStr, rowNum, value) {
  for (const v of validations) {
    if (!rangeIncludesCell(v.range, colLetterStr, rowNum)) continue;
    if (v.type === 'whole' || v.type === 'decimal') {
      const a = Number(v.formulae?.[0]), b = Number(v.formulae?.[1]);
      if (v.type === 'whole' && !Number.isInteger(value)) {
        return { ok: false, reason: `الخلية تقبل أعدادًا صحيحة فقط (القيمة ${value})` };
      }
      if (v.operator === 'between' && !Number.isNaN(a) && !Number.isNaN(b)) {
        if (value < a || value > b) {
          return { ok: false, reason: `القيمة ${value} خارج المدى المسموح ${a}–${b}` };
        }
      }
    }
  }
  return { ok: true };
}

// بناء خطة الكتابة المشتركة بين المعاينة والتنفيذ
async function buildPlan(templateId) {
  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
  if (!template) throw new Error('القالب غير موجود');
  const sectionId = template.section_id;
  if (!sectionId) throw new Error('القالب غير مرتبط بشعبة — أعد الاستيراد');

  const originalPath = originalPathFor(template);
  const scan = await scanWorkbook(originalPath);
  const sheet = scan.sheets.find(s => s.name === template.sheet_name);
  if (!sheet) throw new Error(`الورقة ${template.sheet_name} غير موجودة في الملف الأصلي`);

  const scoreColumns = JSON.parse(template.score_columns || '[]');
  const students = db.prepare("SELECT * FROM students WHERE section_id = ? AND status='active' ORDER BY id").all(sectionId);
  const matches = db.prepare('SELECT * FROM import_matches WHERE template_id = ?').all(templateId);
  const matchByStudent = new Map(matches.map(m => [m.student_id, m]));
  const assessments = db.prepare('SELECT * FROM assessments WHERE section_id = ?').all(sectionId);
  const assessByCol = new Map(assessments.filter(a => a.template_column).map(a => [a.template_column, a]));
  const gradeStmt = db.prepare('SELECT score FROM grades WHERE student_id = ? AND assessment_id = ?');

  const rows = [];
  const writes = [];
  const blockers = [];

  for (const st of students) {
    const match = matchByStudent.get(st.id);
    if (!match) {
      // قاعدة صارمة: طالب بلا مطابقة مثبَّتة يوقف العملية كلها
      blockers.push(`الطالب "${st.original_name}" ليست له مطابقة مثبَّتة في الملف الوزاري`);
      rows.push({
        studentId: st.id, myName: st.original_name, fileName: null,
        cell: null, value: null, status: 'unmatched',
        note: 'بلا مطابقة مثبَّتة',
      });
      continue;
    }
    for (const sc of scoreColumns) {
      const assessment = assessByCol.get(sc.col);
      if (!assessment) continue;
      const g = gradeStmt.get(st.id, assessment.id);
      if (!g || g.score === null || g.score === undefined) {
        rows.push({
          studentId: st.id, myName: st.original_name, fileName: match.file_name,
          cell: `${sc.col}${match.file_row}`, value: null,
          status: 'empty', note: `لا توجد درجة مرصودة (${assessment.name})`,
          assessment: assessment.name,
        });
        continue;
      }
      const cellRef = `${sc.col}${match.file_row}`;
      // لا نكتب أبدًا خارج نطاق الصفوف المحدد في التخطيط
      if (match.file_row < template.first_data_row || match.file_row > template.last_data_row) {
        blockers.push(`الخلية ${cellRef} خارج نطاق صفوف الطلاب المحدد`);
        rows.push({ studentId: st.id, myName: st.original_name, fileName: match.file_name,
          cell: cellRef, value: g.score, status: 'blocked', note: 'خارج نطاق الصفوف', assessment: assessment.name });
        continue;
      }
      // لا نلمس خلية معادلة إطلاقًا
      const colInfo = sheet.columns.find(c => c.col === sc.col);
      if (colInfo && colInfo.formulaCells > 0) {
        blockers.push(`العمود ${sc.col} يحتوي معادلات — الكتابة فيه ممنوعة`);
        rows.push({ studentId: st.id, myName: st.original_name, fileName: match.file_name,
          cell: cellRef, value: g.score, status: 'blocked', note: 'عمود معادلات', assessment: assessment.name });
        continue;
      }
      // فحص قيود التحقق من الصحة قبل الكتابة
      const dv = checkValidation(sheet.validations, sc.col, match.file_row, g.score);
      if (!dv.ok) {
        blockers.push(`${st.original_name} — ${cellRef}: ${dv.reason}`);
        rows.push({ studentId: st.id, myName: st.original_name, fileName: match.file_name,
          cell: cellRef, value: g.score, status: 'invalid', note: dv.reason, assessment: assessment.name });
        continue;
      }
      rows.push({
        studentId: st.id, myName: st.original_name, fileName: match.file_name,
        cell: cellRef, value: g.score, status: 'ready',
        note: match.decided_by === 'auto-exact' ? 'مطابقة تامة'
          : match.decided_by === 'auto-new' ? 'طالب أُنشئ من هذا الصف'
          : 'مطابقة مؤكدة يدويًا',
        assessment: assessment.name,
      });
      writes.push({ cell: cellRef, value: g.score, studentName: st.original_name, studentId: st.id, assessmentId: assessment.id });
    }
  }

  const summary = {
    students: students.length,
    confirmedMatches: matches.filter(m => m.decided_by === 'auto-exact' || m.decided_by === 'auto-new').length,
    manualMatches: matches.filter(m => m.decided_by === 'manual').length,
    unmatched: rows.filter(r => r.status === 'unmatched').length,
    cellsToWrite: writes.length,
    emptyGrades: rows.filter(r => r.status === 'empty').length,
    invalid: rows.filter(r => r.status === 'invalid').length,
    blocked: rows.filter(r => r.status === 'blocked').length,
  };

  return { template, sheet, rows, writes, blockers, summary, originalPath };
}

// 1) المعاينة الإلزامية — لا يُكتب شيء هنا إطلاقًا
router.get('/preview/:templateId', async (req, res) => {
  try {
    const plan = await buildPlan(Number(req.params.templateId));
    res.json({
      templateName: plan.template.name,
      sheetName: plan.template.sheet_name,
      rows: plan.rows,
      summary: plan.summary,
      blockers: plan.blockers,
      canWrite: plan.blockers.length === 0 && plan.writes.length > 0,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 2) التنفيذ — بعد ضغط زر التأكيد الصريح فقط
router.post('/write/:templateId', async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: 'الكتابة تتطلب تأكيدًا صريحًا' });
    }
    const plan = await buildPlan(Number(req.params.templateId));
    if (plan.blockers.length > 0) {
      return res.status(409).json({
        error: 'العملية موقوفة — يوجد ما يمنع الكتابة',
        blockers: plan.blockers,
      });
    }
    if (plan.writes.length === 0) {
      return res.status(400).json({ error: 'لا توجد درجات للكتابة' });
    }

    backupDatabase('submit');

    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
    const safe = plan.template.name.replace(/[\\/:*?"<>|]/g, '_');
    const outName = `${safe}_تسليم_${stamp}.xlsx`;
    const outPath = path.join(SUBMISSIONS_DIR, outName);

    const { before, after, formulasStripped } = await writeGradesToCopy({
      originalPath: plan.originalPath,   // دائمًا الأصل النظيف
      outPath,
      sheetName: plan.template.sheet_name,
      writes: plan.writes,
    });

    const verification = await verifyWrittenFile({
      outPath, sheetName: plan.template.sheet_name,
      writes: plan.writes, before, after,
    });

    audit('submit-write', {
      file: outName,
      cellsWritten: plan.writes.length,
      details: {
        template: plan.template.name,
        formulasStripped,
        structural: verification.structural,
        valuesOk: verification.valuesOk,
        valuesMismatch: verification.valuesMismatch,
      },
      result: verification.perfect ? 'تطابق 100%' : 'يوجد فروقات — راجع التقرير',
    });

    res.json({
      ok: true,
      file: outName,
      path: outPath,
      cellsWritten: plan.writes.length,
      formulasStripped,
      verification,
    });
  } catch (e) {
    audit('submit-write', { result: `فشل: ${e.message}` });
    res.status(500).json({ error: e.message });
  }
});

// 3) تصدير نسخة العمل الخاصة بالمعلم
router.post('/export/:sectionId', async (req, res) => {
  try {
    const result = await exportTeacherCopy(Number(req.params.sectionId));
    audit('export', { file: result.fileName, result: 'ok', details: { students: result.students } });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/files', (req, res) => {
  const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.xlsx')) : [])
    .map(f => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, mtime: st.mtime };
    }).sort((a, b) => b.mtime - a.mtime);
  res.json({
    exports: list(path.join(SUBMISSIONS_DIR, '..', 'exports')),
    submissions: list(SUBMISSIONS_DIR),
  });
});

export default router;
