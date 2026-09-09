// اختبارات محرك الكتابة الجراحية.
// نبني ملفًا يحاكي ما يحفظه إكسل فعلًا: خلايا المعادلات تحمل قيمًا محسوبة
// مخزّنة <v>، وهي المشكلة التي تجعل المجاميع تعرض قيمًا قديمة خاطئة.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import JSZip from 'jszip';
import { writeGradesToCopy, verifyWrittenFile, structuralCounts } from '../excel/writer.js';

const SAMPLE = path.resolve('samples/ministry_sample.xlsx');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grades-test-'));

// يحقن قيمًا محسوبة مخزّنة في خلايا المعادلات + calcChain، كما يفعل إكسل
async function makeFileWithCachedValues(src, dest) {
  const zip = await JSZip.loadAsync(fs.readFileSync(src));
  const sheetPath = 'xl/worksheets/sheet1.xml';
  let xml = await zip.file(sheetPath).async('string');
  let injected = 0;
  xml = xml.replace(/(<f>[^<]*<\/f>)(?!<v>)/g, (m) => {
    injected++;
    return `${m}<v>999</v>`; // قيمة قديمة خاطئة عمدًا
  });
  zip.file(sheetPath, xml);
  zip.file('xl/calcChain.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="I6" i="1"/></calcChain>');
  const ct = await zip.file('[Content_Types].xml').async('string');
  if (!ct.includes('calcChain')) {
    zip.file('[Content_Types].xml', ct.replace('</Types>',
      '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>'));
  }
  fs.writeFileSync(dest, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return injected;
}

async function readSheetXml(file, sheetPath = 'xl/worksheets/sheet1.xml') {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  return zip.file(sheetPath).async('string');
}

test('القيم المخزّنة للمعادلات تُحذف وتُضبط إعادة الحساب الإجبارية', async () => {
  const src = path.join(tmpDir, 'with-cached.xlsx');
  const out = path.join(tmpDir, 'written-1.xlsx');
  const injected = await makeFileWithCachedValues(SAMPLE, src);
  assert.ok(injected > 0, 'يجب أن تُحقَن قيم مخزّنة للاختبار');

  const beforeXml = await readSheetXml(src);
  assert.ok(beforeXml.includes('<v>999</v>'), 'الملف المصدر يجب أن يحتوي قيمًا مخزّنة قديمة');

  const res = await writeGradesToCopy({
    originalPath: src, outPath: out, sheetName: 'الدرجات',
    writes: [
      { cell: 'E6', value: 15, studentName: 'اختبار' },
      { cell: 'F6', value: 12, studentName: 'اختبار' },
    ],
  });

  const afterXml = await readSheetXml(out);
  // 1) لا قيم مخزّنة قديمة باقية في خلايا المعادلات
  assert.ok(!afterXml.includes('<v>999</v>'), 'يجب حذف كل القيم المخزّنة القديمة');
  assert.ok(res.formulasStripped >= injected, `عدد القيم المحذوفة ${res.formulasStripped} < المحقونة ${injected}`);
  // 2) المعادلات نفسها لم تُمس
  assert.ok(afterXml.includes('SUM(E6:H6)'), 'معادلة المجموع يجب أن تبقى كما هي');
  assert.equal(res.before.formulas, res.after.formulas, 'عدد المعادلات يجب ألا يتغير');
  // 3) إعادة الحساب الإجبارية مضبوطة
  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  assert.match(wbXml, /fullCalcOnLoad="1"/, 'يجب ضبط fullCalcOnLoad');
  // 4) ذاكرة الحساب القديمة محذوفة
  assert.equal(zip.file('xl/calcChain.xml'), null, 'يجب حذف calcChain.xml');
  const ctXml = await zip.file('[Content_Types].xml').async('string');
  assert.ok(!ctXml.includes('calcChain'), 'يجب حذف مرجع calcChain من Content_Types');
  // 5) القيم الجديدة مكتوبة فعلًا
  assert.match(afterXml, /<c r="E6"[^>]*><v>15<\/v><\/c>/);
});

test('البنية محفوظة بالكامل: تحقق وحماية وتنسيق شرطي ودمج', async () => {
  const src = path.join(tmpDir, 'with-cached-2.xlsx');
  const out = path.join(tmpDir, 'written-2.xlsx');
  await makeFileWithCachedValues(SAMPLE, src);
  const writes = [{ cell: 'E7', value: 18, studentName: 'اختبار' }];
  const { before, after } = await writeGradesToCopy({ originalPath: src, outPath: out, sheetName: 'الدرجات', writes });
  const v = await verifyWrittenFile({ outPath: out, sheetName: 'الدرجات', writes, before, after });
  assert.equal(v.valuesMismatch, 0, 'يجب ألا يوجد فرق في القيم');
  assert.ok(v.structural.validationsOk, 'قواعد التحقق يجب أن تبقى');
  assert.ok(v.structural.protectionsOk, 'حماية الأوراق يجب أن تبقى');
  assert.ok(v.structural.condFormatsOk, 'التنسيق الشرطي يجب أن يبقى');
  assert.ok(v.structural.mergedOk, 'الخلايا المدمجة يجب أن تبقى');
  assert.ok(v.structural.entriesOk, 'لا يجوز فقد أي ملف من الأرشيف');
  assert.ok(v.perfect, 'يجب أن يكون التحقق مثاليًا');
});

test('الكتابة في خلية معادلة مرفوضة', async () => {
  const src = path.join(tmpDir, 'with-cached-3.xlsx');
  const out = path.join(tmpDir, 'written-3.xlsx');
  await makeFileWithCachedValues(SAMPLE, src);
  await assert.rejects(
    () => writeGradesToCopy({
      originalPath: src, outPath: out, sheetName: 'الدرجات',
      writes: [{ cell: 'I6', value: 50, studentName: 'اختبار' }], // I = عمود المجموع (معادلة)
    }),
    /معادلة/,
  );
});

test('الكتابة فوق نسخة موجودة مرفوضة — كل تسليم من الأصل النظيف', async () => {
  const src = path.join(tmpDir, 'with-cached-4.xlsx');
  const out = path.join(tmpDir, 'written-4.xlsx');
  await makeFileWithCachedValues(SAMPLE, src);
  const writes = [{ cell: 'E6', value: 10, studentName: 'اختبار' }];
  await writeGradesToCopy({ originalPath: src, outPath: out, sheetName: 'الدرجات', writes });
  await assert.rejects(
    () => writeGradesToCopy({ originalPath: src, outPath: out, sheetName: 'الدرجات', writes }),
    /موجود مسبقًا/,
  );
});

test('الملف الأصلي لا يتغير إطلاقًا بعد الكتابة', async () => {
  const src = path.join(tmpDir, 'with-cached-5.xlsx');
  const out = path.join(tmpDir, 'written-5.xlsx');
  await makeFileWithCachedValues(SAMPLE, src);
  const beforeBytes = fs.readFileSync(src);
  await writeGradesToCopy({
    originalPath: src, outPath: out, sheetName: 'الدرجات',
    writes: [{ cell: 'E6', value: 11, studentName: 'اختبار' }],
  });
  const afterBytes = fs.readFileSync(src);
  assert.ok(beforeBytes.equals(afterBytes), 'الملف الأصلي يجب أن يبقى مطابقًا بايتًا ببايت');
});

test('الكتابة في خلية غير موجودة أصلًا في XML تُدرَج في موضعها الصحيح', async () => {
  const src = path.join(tmpDir, 'with-cached-6.xlsx');
  const out = path.join(tmpDir, 'written-6.xlsx');
  await makeFileWithCachedValues(SAMPLE, src);
  // E..H فارغة في الملف التجريبي — بعضها قد لا يكون له عنصر <c> إطلاقًا
  const writes = [
    { cell: 'H10', value: 7, studentName: 'اختبار' },
    { cell: 'E10', value: 8, studentName: 'اختبار' },
  ];
  const { before, after } = await writeGradesToCopy({ originalPath: src, outPath: out, sheetName: 'الدرجات', writes });
  const xml = await readSheetXml(out);
  // ترتيب الأعمدة داخل الصف يجب أن يبقى تصاعديًا (شرط صحة ملف xlsx)
  const rowMatch = xml.match(/<row[^>]*\br="10"[^>]*>([\s\S]*?)<\/row>/);
  assert.ok(rowMatch, 'الصف 10 موجود');
  const refs = [...rowMatch[1].matchAll(/<c r="([A-Z]+)10"/g)].map(m => m[1]);
  const colNum = (l) => [...l].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const nums = refs.map(colNum);
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b), `ترتيب الأعمدة غير صحيح: ${refs.join(',')}`);
  const v = await verifyWrittenFile({ outPath: out, sheetName: 'الدرجات', writes, before, after });
  assert.ok(v.perfect, 'التحقق يجب أن يكون مثاليًا');
});
