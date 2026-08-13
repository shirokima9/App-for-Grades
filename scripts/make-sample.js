// يولّد ملفًا يحاكي الملف الوزاري: ترويسة مدرسة علوية، معادلات، Data Validation،
// ورقة محمية، تنسيق شرطي — للاختبار فقط.
import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'samples', 'ministry_sample.xlsx');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

// 25 اسمًا رباعيًا — بعضها متقارب عمدًا لاختبار المطابقة:
// (1،2) اختلاف اسم واحد، (3،4) عبدالله/عبد الله، (5،6) محمد/محمود،
// (7،8) سالم/سليمان، وأسماء بهمزات وتاء مربوطة وألف مقصورة لاختبار التطبيع.
const NAMES = [
  'أحمد سالم محمد البلوشي',
  'أحمد سليم محمد البلوشي',
  'عبدالله خميس سعيد الحارثي',
  'عبد الله خميس سعود الحارثي',
  'محمد علي حمد الوهيبي',
  'محمود علي حمد الوهيبي',
  'سالم ناصر خلفان السيابي',
  'سليمان ناصر خلفان السيابي',
  'خالد يوسف عبدالله العامري',
  'هيثم سعود راشد المعمري',
  'يوسف إبراهيم خليل الزدجالي',
  'مازن حمود سالم الرواحي',
  'طارق زاهر علي المقبالي',
  'ناصر حمد سيف الهنائي',
  'بدر سعيد حمدان الشقصي',
  'فيصل عامر محسن الكندي',
  'عمار داود سليمان اللواتي',
  'حسام مبارك علي الجابري',
  'راشد صالح ماجد العبري',
  'تركي فهد ناصر القاسمي',
  'أنس محمد عوض الشحي',
  'إياد عادل حسن الريامي',
  'آدم وليد جمال البادي',
  'مصطفى أنور لطفي الفارسي',
  'حمزة عيسى موسى النعماني',
];

const wb = new ExcelJS.Workbook();
wb.creator = 'وزارة التربية والتعليم (نموذج تجريبي)';

const ws = wb.addWorksheet('الدرجات', { views: [{ rightToLeft: true }] });

// ترويسة المدرسة العلوية (ليست صف العناوين)
ws.mergeCells('A1:J1');
ws.getCell('A1').value = 'سلطنة عُمان — وزارة التربية والتعليم';
ws.mergeCells('A2:J2');
ws.getCell('A2').value = 'مدرسة النهضة للتعليم الأساسي (6-8)';
ws.mergeCells('A3:J3');
ws.getCell('A3').value = 'مادة تقنية المعلومات — الفصل الدراسي الأول — العام الدراسي 2025/2026';
for (const r of [1, 2, 3]) {
  ws.getRow(r).font = { name: 'Arial', size: 14, bold: true };
  ws.getRow(r).alignment = { horizontal: 'center' };
}
// الصف 4 فارغ عمدًا

// صف العناوين الفعلي: الصف 5
const HEADER_ROW = 5;
const headers = ['م', 'اسم الطالب', 'الصف', 'الشعبة', 'الأداة الأولى', 'الأداة الثانية', 'المشروع', 'الاختبار القصير', 'المجموع', 'التقدير'];
ws.getRow(HEADER_ROW).values = headers;
ws.getRow(HEADER_ROW).font = { bold: true };
ws.getRow(HEADER_ROW).alignment = { horizontal: 'center' };
ws.columns = [
  { width: 6 }, { width: 34 }, { width: 8 }, { width: 8 },
  { width: 12 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 10 },
];

const FIRST = HEADER_ROW + 1; // 6
NAMES.forEach((name, i) => {
  const r = FIRST + i;
  const row = ws.getRow(r);
  row.getCell(1).value = i + 1;
  row.getCell(2).value = name;
  row.getCell(3).value = 6;
  row.getCell(4).value = 'أ';
  // خلايا الدرجات (E-H) فارغة للإدخال وغير مقفلة
  for (let c = 5; c <= 8; c++) {
    row.getCell(c).protection = { locked: false };
    row.getCell(c).border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  }
  // معادلة المجموع والتقدير (مقفلة)
  row.getCell(9).value = { formula: `SUM(E${r}:H${r})` };
  row.getCell(10).value = {
    formula: `IF(I${r}>=72,"أ",IF(I${r}>=64,"ب",IF(I${r}>=52,"ج",IF(I${r}>=40,"د","هـ"))))`,
  };
});
const LAST = FIRST + NAMES.length - 1; // 30

// صف مجموع عام أسفل الجدول (معادلة أيضًا)
ws.getCell(`B${LAST + 2}`).value = 'متوسط الشعبة';
ws.getCell(`I${LAST + 2}`).value = { formula: `IFERROR(AVERAGE(I${FIRST}:I${LAST}),"")` };

// تحقق من صحة البيانات: الدرجات أعداد بين 0 و 20
ws.dataValidations.add(`E${FIRST}:H${LAST}`, {
  type: 'whole', operator: 'between', formulae: [0, 20],
  allowBlank: true, showErrorMessage: true,
  errorTitle: 'قيمة غير صحيحة', error: 'الدرجة يجب أن تكون عددًا صحيحًا بين 0 و 20',
});
// قائمة منسدلة لحالة الطالب (عمود K)
ws.getCell(`K${HEADER_ROW}`).value = 'الحالة';
ws.getRow(HEADER_ROW).getCell(11).font = { bold: true };
ws.dataValidations.add(`K${FIRST}:K${LAST}`, {
  type: 'list', formulae: ['"مستمر,منقول,منسحب"'], allowBlank: true, showErrorMessage: true,
});
for (let r = FIRST; r <= LAST; r++) ws.getCell(`K${r}`).protection = { locked: false };

// تنسيق شرطي: المجموع أقل من 40 بخلفية حمراء
ws.addConditionalFormatting({
  ref: `I${FIRST}:I${LAST}`,
  rules: [{
    type: 'cellIs', operator: 'lessThan', formulae: [40], priority: 1,
    style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } }, font: { color: { argb: 'FF9C0006' } } },
  }],
});

// حماية الورقة (خلايا الإدخال فقط غير مقفلة)
await ws.protect('moe1234', {
  selectLockedCells: true, selectUnlockedCells: true,
  formatCells: false, insertRows: false, deleteRows: false, sort: false,
});

// ورقة إرشادات محمية بالكامل
const ws2 = wb.addWorksheet('إرشادات', { views: [{ rightToLeft: true }] });
ws2.getCell('A1').value = 'تعليمات الرصد';
ws2.getCell('A2').value = 'تُدخل الدرجات في الأعمدة المخصصة فقط (من عمود الأداة الأولى إلى الاختبار القصير).';
ws2.getCell('A3').value = 'لا تعدّل على المعادلات أو الترويسة.';
await ws2.protect('moe1234', { selectLockedCells: true, selectUnlockedCells: true });

await wb.xlsx.writeFile(OUT);
console.log(`تم إنشاء الملف التجريبي: ${OUT}`);
console.log(`عدد الطلاب: ${NAMES.length} | صف العناوين: ${HEADER_ROW} | نطاق البيانات: ${FIRST}-${LAST}`);
