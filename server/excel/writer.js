// الكتابة الجراحية في نسخة الملف الوزاري.
//
// المبدأ: ملف xlsx هو أرشيف ZIP من ملفات XML. نعدّل فقط عناصر الخلايا <c>
// المستهدفة داخل XML الورقة، وكل ملف آخر في الأرشيف يُنقل كما هو دون لمس —
// المعادلات والحماية وقواعد التحقق والتنسيقات والشعارات تبقى سليمة.
//
// معالجة القيم المخزّنة للمعادلات:
// خلية المعادلة في xlsx تحتوي <f>المعادلة</f> و<v>القيمة المحسوبة سابقًا</v>.
// لو غيّرنا خلية إدخال دون معالجة، تبقى المجاميع تعرض القيم القديمة الخاطئة.
// لذلك نحذف <v> من كل خلايا المعادلات في الورقة المستهدفة، ونضبط
// fullCalcOnLoad="1" في workbook.xml ليُعيد إكسل الحساب إجباريًا عند الفتح.

import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { colNumber, colLetter } from './scan.js';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ------------------------------------------------------------------
// العثور على مسار XML للورقة المطلوبة داخل الأرشيف
// ------------------------------------------------------------------
async function resolveSheetPath(zip, sheetName) {
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');

  const sheetTags = wbXml.match(/<sheet\b[^>]*\/?>/g) || [];
  let rid = null;
  for (const tag of sheetTags) {
    const nameMatch = tag.match(/name="([^"]*)"/);
    if (!nameMatch) continue;
    const name = decodeXmlAttr(nameMatch[1]);
    if (name === sheetName) {
      const ridMatch = tag.match(/r:id="([^"]*)"/);
      rid = ridMatch ? ridMatch[1] : null;
      break;
    }
  }
  if (!rid) throw new Error(`تعذّر العثور على الورقة "${sheetName}" داخل الملف`);

  const relRe = new RegExp(`<Relationship\\b[^>]*Id="${escapeRegex(rid)}"[^>]*>`);
  const rel = relsXml.match(relRe);
  if (!rel) throw new Error(`تعذّر تحديد مسار الورقة "${sheetName}"`);
  const target = rel[0].match(/Target="([^"]*)"/)[1];
  return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
}

function decodeXmlAttr(s) {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// ------------------------------------------------------------------
// ماسح عناصر XML: يميّز بين <x .../> و <x ...>...</x> بشكل صحيح.
// (المطابقة بالتعبيرات النمطية وحدها تبتلع العنصر التالي عند الإغلاق الذاتي.)
// ------------------------------------------------------------------
function* iterElements(xml, tagName) {
  const open = `<${tagName}`;
  const close = `</${tagName}>`;
  let i = 0;
  while (i < xml.length) {
    const start = xml.indexOf(open, i);
    if (start === -1) return;
    const after = xml[start + open.length];
    // نتأكد أنه اسم الوسم كاملًا وليس بداية وسم آخر (مثل <col داخل <c)
    if (after !== ' ' && after !== '>' && after !== '/' && after !== '\t' && after !== '\n' && after !== '\r') {
      i = start + open.length;
      continue;
    }
    const gt = xml.indexOf('>', start);
    if (gt === -1) return;
    const tag = xml.slice(start, gt + 1);
    let end;
    if (tag.endsWith('/>')) {
      end = gt + 1;
    } else {
      const closeIdx = xml.indexOf(close, gt);
      if (closeIdx === -1) return;
      end = closeIdx + close.length;
    }
    yield { start, end, tag, full: xml.slice(start, end) };
    i = end;
  }
}

function attrOf(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : undefined;
}

function hasFormula(cellXml) {
  for (const el of iterElements(cellXml, 'f')) return true;
  return false;
}

// ------------------------------------------------------------------
// كتابة قيمة رقمية في خلية داخل XML الورقة
// ------------------------------------------------------------------
function writeCellIntoSheetXml(xml, cellRef, value) {
  const m = cellRef.match(/^([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`مرجع خلية غير صالح: ${cellRef}`);
  const colIdx = colNumber(m[1]);
  const rowNum = String(Number(m[2]));

  // 1) الوصول لعنصر الصف
  let row = null;
  for (const el of iterElements(xml, 'row')) {
    if (attrOf(el.tag, 'r') === rowNum) { row = el; break; }
  }
  if (!row) {
    throw new Error(`الصف ${rowNum} غير موجود في الملف — لا نُنشئ صفوفًا جديدة في الملف الوزاري`);
  }

  let rowXml = row.full;
  // صف ذاتي الإغلاق <row .../> — نحوّله لصف بمحتوى دون تغيير خصائصه
  if (rowXml.endsWith('/>')) {
    rowXml = rowXml.slice(0, -2) + '></row>';
  }

  const newCellFor = (oldTag) => {
    // نحافظ على نمط التنسيق s، ونحذف t لأننا نكتب رقمًا لا نصًا
    const s = oldTag ? attrOf(oldTag, 's') : undefined;
    return `<c r="${cellRef}"${s !== undefined ? ` s="${s}"` : ''}><v>${value}</v></c>`;
  };

  // 2) البحث عن الخلية داخل الصف
  let target = null;
  let insertAt = null;
  for (const cell of iterElements(rowXml, 'c')) {
    const ref = attrOf(cell.tag, 'r');
    if (ref === cellRef) { target = cell; break; }
    if (ref) {
      const cm = ref.match(/^([A-Z]+)\d+$/);
      if (cm && colNumber(cm[1]) > colIdx && insertAt === null) insertAt = cell.start;
    }
  }

  let newRowXml;
  if (target) {
    // حماية إضافية: لا نكتب فوق خلية تحتوي معادلة إطلاقًا
    if (hasFormula(target.full)) {
      throw new Error(`الخلية ${cellRef} تحتوي معادلة — الكتابة ممنوعة`);
    }
    newRowXml = rowXml.slice(0, target.start) + newCellFor(target.tag) + rowXml.slice(target.end);
  } else if (insertAt !== null) {
    // إدراج الخلية في موضعها الصحيح حسب ترتيب الأعمدة
    newRowXml = rowXml.slice(0, insertAt) + newCellFor(null) + rowXml.slice(insertAt);
  } else {
    const closeIdx = rowXml.lastIndexOf('</row>');
    newRowXml = rowXml.slice(0, closeIdx) + newCellFor(null) + rowXml.slice(closeIdx);
  }

  return xml.slice(0, row.start) + newRowXml + xml.slice(row.end);
}

// حذف القيم المخزّنة من كل خلايا المعادلات في الورقة، ليُعاد حسابها عند الفتح.
// المعادلة <f> تبقى كما هي تمامًا؛ نحذف <v> المخزّنة فقط.
function stripCachedFormulaValues(xml) {
  let count = 0;
  let out = '';
  let last = 0;
  for (const cell of iterElements(xml, 'c')) {
    if (!hasFormula(cell.full)) continue;
    let inner = cell.full;
    let changed = false;
    for (const v of iterElements(inner, 'v')) {
      inner = inner.slice(0, v.start) + inner.slice(v.end);
      changed = true;
      break; // خلية المعادلة تحتوي قيمة مخزّنة واحدة
    }
    if (!changed) continue;
    out += xml.slice(last, cell.start) + inner;
    last = cell.end;
    count++;
  }
  out += xml.slice(last);
  return { xml: out, stripped: count };
}

// ضبط إعادة الحساب الإجبارية عند فتح الملف
function forceFullRecalc(wbXml) {
  if (/<calcPr\b[^>]*\/>/.test(wbXml)) {
    return wbXml.replace(/<calcPr\b([^>]*)\/>/, (full, attrs) => {
      let a = attrs
        .replace(/\s*fullCalcOnLoad="[^"]*"/, '')
        .replace(/\s*calcCompleted="[^"]*"/, '');
      return `<calcPr${a} fullCalcOnLoad="1" calcCompleted="0"/>`;
    });
  }
  if (/<\/workbook>/.test(wbXml)) {
    return wbXml.replace('</workbook>', '<calcPr fullCalcOnLoad="1" calcCompleted="0"/></workbook>');
  }
  return wbXml;
}

// ------------------------------------------------------------------
// عدّ العناصر البنيوية للمقارنة قبل/بعد
// ------------------------------------------------------------------
export async function structuralCounts(filePath) {
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);
  const entries = Object.keys(zip.files).filter(f => !zip.files[f].dir).sort();
  let formulas = 0, validations = 0, protections = 0, mergedCells = 0, condFormats = 0;
  for (const name of entries) {
    if (!/^xl\/worksheets\/.*\.xml$/.test(name)) continue;
    const xml = await zip.file(name).async('string');
    formulas += (xml.match(/<f[\s>\/]/g) || []).length;
    // نُحصي أيضًا الخلايا التي تحمل معادلة (للتأكد أن أيًا منها لم يُفقد)
    validations += (xml.match(/<dataValidation\b/g) || []).length;
    protections += (xml.match(/<sheetProtection\b/g) || []).length;
    mergedCells += (xml.match(/<mergeCell\b/g) || []).length;
    condFormats += (xml.match(/<conditionalFormatting\b/g) || []).length;
  }
  return { entries, formulas, validations, protections, mergedCells, condFormats };
}

// ------------------------------------------------------------------
// العملية الكاملة: نسخ الأصل ← كتابة القيم ← حفظ النسخة
// كل تسليم يبدأ من الأصل النظيف — لا نكتب أبدًا فوق نسخة سبق أن كُتب فيها.
// ------------------------------------------------------------------
export async function writeGradesToCopy({ originalPath, outPath, sheetName, writes }) {
  if (!fs.existsSync(originalPath)) throw new Error('الملف الوزاري الأصلي غير موجود');
  if (fs.existsSync(outPath)) throw new Error('ملف الوجهة موجود مسبقًا — كل تسليم ينشئ نسخة جديدة');

  const before = await structuralCounts(originalPath);

  // 1) ننسخ الأصل بايتًا ببايت. الأصل لا يُفتح للكتابة إطلاقًا.
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.copyFileSync(originalPath, outPath);

  // 2) نعمل على النسخة فقط
  const zip = await JSZip.loadAsync(fs.readFileSync(outPath));
  const sheetPath = await resolveSheetPath(zip, sheetName);
  let sheetXml = await zip.file(sheetPath).async('string');

  for (const w of writes) {
    sheetXml = writeCellIntoSheetXml(sheetXml, w.cell, w.value);
  }

  const { xml: strippedXml, stripped } = stripCachedFormulaValues(sheetXml);
  sheetXml = strippedXml;

  zip.file(sheetPath, sheetXml);

  const wbPath = 'xl/workbook.xml';
  const wbXml = await zip.file(wbPath).async('string');
  zip.file(wbPath, forceFullRecalc(wbXml));

  // حذف ذاكرة الحساب إن وُجدت (تحتوي نتائج محسوبة مسبقًا)
  if (zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml');
    const ctPath = '[Content_Types].xml';
    const ct = await zip.file(ctPath).async('string');
    zip.file(ctPath, ct.replace(/<Override[^>]*calcChain\.xml"[^>]*\/>/, ''));
  }

  const outBuf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(outPath, outBuf);

  const after = await structuralCounts(outPath);
  return { before, after, formulasStripped: stripped, sheetPath };
}

// ------------------------------------------------------------------
// تقرير التحقق بعد الكتابة: إعادة فتح الملف الناتج وقراءة كل قيمة
// ------------------------------------------------------------------
export async function verifyWrittenFile({ outPath, sheetName, writes, before, after }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(outPath);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error('تعذّر فتح الورقة في الملف الناتج');

  const rows = [];
  let ok = 0, mismatch = 0;
  for (const w of writes) {
    const cell = ws.getCell(w.cell);
    let readValue = cell.value;
    if (readValue && typeof readValue === 'object' && 'result' in readValue) readValue = readValue.result;
    const matches = Number(readValue) === Number(w.value);
    if (matches) ok++; else mismatch++;
    rows.push({
      cell: w.cell,
      studentName: w.studentName,
      expected: w.value,
      found: readValue === null || readValue === undefined ? null : readValue,
      ok: matches,
    });
  }

  // مقارنة بنيوية: لا يجوز أن يُفقد أي ملف أو قاعدة تحقق أو حماية
  const missingEntries = before.entries.filter(e => !after.entries.includes(e) && e !== 'xl/calcChain.xml');
  const structural = {
    formulasBefore: before.formulas, formulasAfter: after.formulas,
    validationsBefore: before.validations, validationsAfter: after.validations,
    protectionsBefore: before.protections, protectionsAfter: after.protections,
    mergedBefore: before.mergedCells, mergedAfter: after.mergedCells,
    condFormatsBefore: before.condFormats, condFormatsAfter: after.condFormats,
    missingEntries,
  };
  structural.formulasOk = before.formulas === after.formulas;
  structural.validationsOk = before.validations === after.validations;
  structural.protectionsOk = before.protections === after.protections;
  structural.mergedOk = before.mergedCells === after.mergedCells;
  structural.condFormatsOk = before.condFormats === after.condFormats;
  structural.entriesOk = missingEntries.length === 0;
  structural.allOk = structural.formulasOk && structural.validationsOk && structural.protectionsOk
    && structural.mergedOk && structural.condFormatsOk && structural.entriesOk;

  return {
    rows,
    valuesOk: ok,
    valuesMismatch: mismatch,
    perfect: mismatch === 0 && structural.allOk,
    structural,
  };
}

export { colLetter };
