import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { db, UPLOADS_DIR, backupDatabase, audit } from '../db/index.js';
import { scanWorkbook, extractStudents, analyzeOneSheet } from '../excel/scan.js';
import { normalizeArabic, matchNames } from '../matching/names.js';

const router = express.Router();

// الملف المرفوع يُحفظ نسخة للقراءة فقط داخل data/uploads — الأصل على جهازك لا يُلمس.
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.xlsx`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function uploadPath(uploadId) {
  if (!/^[0-9a-f-]{36}$/.test(uploadId)) throw new Error('معرّف ملف غير صالح');
  const p = path.join(UPLOADS_DIR, `${uploadId}.xlsx`);
  if (!fs.existsSync(p)) throw new Error('الملف المرفوع غير موجود — أعد رفعه');
  return p;
}

// 1) رفع الملف وتشغيل المسح البنيوي
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يصل أي ملف' });
    const uploadId = path.basename(req.file.filename, '.xlsx');
    fs.writeFileSync(path.join(UPLOADS_DIR, `${uploadId}.json`),
      JSON.stringify({ originalName: req.file.originalname, uploadedAt: new Date().toISOString() }));
    const scan = await scanWorkbook(req.file.path);
    audit('import-scan', { file: req.file.originalname, result: 'ok' });
    res.json({ uploadId, originalName: req.file.originalname, scan });
  } catch (e) {
    res.status(500).json({ error: `فشل المسح البنيوي: ${e.message}` });
  }
});

// 1ب) إعادة تحليل ورقة بصف ترويسة يحدده المستخدم يدويًا (عندما يفشل الاكتشاف)
router.post('/analyze', async (req, res) => {
  try {
    const { uploadId, sheetName, headerRow } = req.body;
    const hr = Number(headerRow);
    if (!sheetName || !Number.isInteger(hr) || hr < 1) {
      return res.status(400).json({ error: 'حدد الورقة وصف الترويسة (رقم صحيح ≥ 1)' });
    }
    const sheet = await analyzeOneSheet(uploadPath(uploadId), sheetName, hr);
    res.json({ sheet });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 2) استخراج الطلاب حسب المطابقة اليدوية للأعمدة
router.post('/extract', async (req, res) => {
  try {
    const { uploadId, mapping } = req.body;
    const entries = await extractStudents(uploadPath(uploadId), mapping);
    res.json({ entries });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 3) مطابقة الأسماء مع طلاب الشعبة في قاعدة البيانات
router.post('/match', async (req, res) => {
  try {
    const { uploadId, mapping, sectionId } = req.body;
    const entries = await extractStudents(uploadPath(uploadId), mapping);
    const dbStudents = sectionId
      ? db.prepare("SELECT * FROM students WHERE section_id = ? AND status = 'active'").all(sectionId)
      : [];
    const results = matchNames(entries, dbStudents);
    // الطلاب في القاعدة غير الموجودين في الملف = مفقودون
    const matchedIds = new Set();
    for (const r of results) {
      if (r.level === 'exact') matchedIds.add(r.candidates[0].student.id);
    }
    const missing = dbStudents.filter(s => !matchedIds.has(s.id) &&
      !results.some(r => r.level === 'close' && r.candidates.some(c => c.student.id === s.id)));
    res.json({
      results,
      missing,
      summary: {
        total: results.length,
        exact: results.filter(r => r.level === 'exact').length,
        close: results.filter(r => r.level === 'close').length,
        none: results.filter(r => r.level === 'none').length,
        missingInFile: missing.length,
      },
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 4) تثبيت الاستيراد: إنشاء القالب والطلاب وقرارات المطابقة + تقرير الفروقات
router.post('/commit', async (req, res) => {
  try {
    const { uploadId, templateName, mapping, sectionId, decisions } = req.body;
    if (!templateName || !mapping || !sectionId || !Array.isArray(decisions)) {
      return res.status(400).json({ error: 'بيانات ناقصة' });
    }
    // قاعدة صارمة: كل صف يجب أن يكون محسومًا (match / new / skip)
    const undecided = decisions.filter(d => !['match', 'new', 'skip'].includes(d.action));
    if (undecided.length > 0) {
      return res.status(409).json({ error: `يوجد ${undecided.length} طالبًا غير محسوم — احسم كل الحالات أولًا` });
    }
    for (const d of decisions) {
      if (d.action === 'match' && !d.studentId) {
        return res.status(409).json({ error: `الصف ${d.row}: مطابقة بلا طالب محدد` });
      }
    }

    backupDatabase('import');
    const diff = { added: [], moved: [], removed: [], matched: 0 };

    const tx = db.transaction(() => {
      let tpl = db.prepare('SELECT * FROM templates WHERE name = ?').get(templateName);
      const scoreColsJson = JSON.stringify(mapping.scoreColumns || []);
      if (tpl) {
        db.prepare(`UPDATE templates SET sheet_name=?, header_row=?, first_data_row=?, last_data_row=?,
          name_column=?, grade_column=?, section_column=?, score_columns=? WHERE id=?`)
          .run(mapping.sheetName, mapping.headerRow, mapping.firstDataRow, mapping.lastDataRow,
            mapping.nameColumn, mapping.gradeColumn || null, mapping.sectionColumn || null, scoreColsJson, tpl.id);
        db.prepare('DELETE FROM import_matches WHERE template_id = ?').run(tpl.id);
      } else {
        const info = db.prepare(`INSERT INTO templates(name, sheet_name, header_row, first_data_row, last_data_row,
          name_column, grade_column, section_column, score_columns) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(templateName, mapping.sheetName, mapping.headerRow, mapping.firstDataRow, mapping.lastDataRow,
            mapping.nameColumn, mapping.gradeColumn || null, mapping.sectionColumn || null, scoreColsJson);
        tpl = { id: info.lastInsertRowid };
      }

      // إنشاء عناصر تقييم للشعبة من أعمدة الدرجات إن لم تكن موجودة
      const existingAssess = db.prepare('SELECT template_column FROM assessments WHERE section_id = ?').all(sectionId)
        .map(a => a.template_column);
      (mapping.scoreColumns || []).forEach((sc, i) => {
        if (!existingAssess.includes(sc.col)) {
          db.prepare('INSERT INTO assessments(section_id, name, max_score, sort_order, template_column) VALUES (?,?,?,?,?)')
            .run(sectionId, sc.header, sc.max || 20, i, sc.col);
        }
      });

      const seenStudentIds = new Set();
      for (const d of decisions) {
        if (d.action === 'skip') continue;
        let studentId;
        if (d.action === 'new') {
          const info = db.prepare('INSERT INTO students(section_id, original_name, normalized_name) VALUES (?,?,?)')
            .run(sectionId, d.name, normalizeArabic(d.name));
          studentId = info.lastInsertRowid;
          diff.added.push(d.name);
        } else {
          studentId = d.studentId;
          const st = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
          if (!st) throw new Error(`طالب غير موجود: ${studentId}`);
          if (st.section_id !== sectionId) {
            // نقل طالب لشعبة أخرى — درجاته وملاحظاته تبقى مرتبطة به وتنتقل معه
            db.prepare('INSERT INTO student_moves(student_id, from_section_id, to_section_id) VALUES (?,?,?)')
              .run(studentId, st.section_id, sectionId);
            db.prepare('UPDATE students SET section_id = ? WHERE id = ?').run(sectionId, studentId);
            diff.moved.push(st.original_name);
          }
          diff.matched++;
        }
        seenStudentIds.add(studentId);
        db.prepare(`INSERT INTO import_matches(template_id, student_id, file_row, file_name, decided_by)
          VALUES (?,?,?,?,?)`)
          .run(tpl.id, studentId, d.row, d.name, d.decidedBy || 'manual');
      }

      // الطلاب النشطون في الشعبة غير الواردين في الملف
      const activeInSection = db.prepare("SELECT * FROM students WHERE section_id = ? AND status = 'active'").all(sectionId);
      for (const st of activeInSection) {
        if (!seenStudentIds.has(st.id)) diff.removed.push({ id: st.id, name: st.original_name });
      }
      return tpl.id;
    });

    const templateId = tx();
    audit('import-commit', {
      file: templateName,
      details: { sectionId, added: diff.added.length, moved: diff.moved.length, missing: diff.removed.length },
      result: 'ok',
    });
    res.json({ ok: true, templateId, diff });
  } catch (e) {
    res.status(500).json({ error: `فشل تثبيت الاستيراد: ${e.message}` });
  }
});

export default router;
