// المسح البنيوي للملف الوزاري — قراءة فقط، لا يُكتب في الملف الأصلي أبدًا.
import ExcelJS from 'exceljs';

const HEADER_KEYWORDS = ['اسم', 'الطالب', 'الطالبة', 'م', 'رقم', 'الصف', 'الشعبة', 'درجه', 'درجة', 'المجموع', 'مجموع', 'التقدير', 'اختبار', 'أداة', 'اداة', 'name', 'total'];

function cellText(cell) {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.result !== undefined) return String(v.result ?? '');
    if (v.text) return String(v.text);
    return '';
  }
  return String(v);
}

function isFormulaCell(cell) {
  return cell.formulaType !== undefined
    ? cell.formulaType !== ExcelJS.FormulaType.None
    : !!(cell.value && typeof cell.value === 'object' && ('formula' in cell.value || 'sharedFormula' in cell.value));
}

function colLetter(n) {
  let s = '';
  while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
export { colLetter };

export function colNumber(letter) {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// ضغط قائمة خلايا (E6, E7, ... H30) إلى نطاقات أعمدة (E6:E30 F6:F30 ...)
function compressCellList(cells) {
  const byCol = new Map();
  const standalone = [];
  for (const c of cells) {
    const m = c.match(/^([A-Z]+)(\d+)$/);
    if (!m) { standalone.push(c); continue; }
    if (!byCol.has(m[1])) byCol.set(m[1], []);
    byCol.get(m[1]).push(Number(m[2]));
  }
  const parts = [...standalone];
  for (const [col, rows] of byCol) {
    rows.sort((a, b) => a - b);
    let start = rows[0], prev = rows[0];
    for (let i = 1; i <= rows.length; i++) {
      if (i < rows.length && rows[i] === prev + 1) { prev = rows[i]; continue; }
      parts.push(start === prev ? `${col}${start}` : `${col}${start}:${col}${prev}`);
      if (i < rows.length) { start = prev = rows[i]; }
    }
  }
  return parts.join(' ');
}

// تخمين صف الترويسة: الصف الذي يحتوي أكبر عدد خلايا نصية قصيرة غير فارغة،
// مع نقاط إضافية للكلمات المفتاحية، ويجب أن يعلو صفوفًا فيها بيانات.
function guessHeaderRow(ws) {
  const maxScan = Math.min(ws.rowCount, 40);
  let best = { row: null, score: -1, filled: 0, keywords: 0 };
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    let filled = 0, keywords = 0;
    row.eachCell({ includeEmpty: false }, (cell) => {
      const t = cellText(cell).trim();
      if (!t) return;
      filled++;
      if (HEADER_KEYWORDS.some(k => t.includes(k))) keywords++;
    });
    if (filled < 2) continue;
    const score = filled + keywords * 3;
    if (score > best.score) best = { row: r, score, filled, keywords };
  }
  // لا تخمين: نثق فقط إن وُجدت كلمتان مفتاحيتان على الأقل مع 3 خلايا معبأة
  const confident = best.row !== null && best.keywords >= 2 && best.filled >= 3;
  return { row: best.row, confident };
}

// أول 10 صفوف كما هي خامًا — ليرى المستخدم ما يراه التطبيق قبل أي قرار
function rawPreview(ws, count = 10) {
  const rows = [];
  const maxCol = Math.min(ws.actualColumnCount || ws.columnCount || 1, 30);
  for (let r = 1; r <= Math.min(count, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const cells = [];
    for (let c = 1; c <= maxCol; c++) {
      const cell = row.getCell(c);
      let text;
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) {
        text = '⟵'; // خلية تابعة لدمج — القيمة في الخلية الرئيسة فقط
      } else if (isFormulaCell(cell)) {
        text = '=' + (cell.formula || cell.value?.formula || 'shared');
      } else {
        text = cellText(cell);
      }
      cells.push(text);
    }
    rows.push({ row: r, cells });
  }
  return { maxCol, rows };
}

function analyzeSheet(ws, headerRowOverride = null) {
  const guess = headerRowOverride
    ? { row: headerRowOverride, confident: true }
    : guessHeaderRow(ws);
  const headerRow = guess.row;
  const merges = (ws.model && ws.model.merges) ? [...ws.model.merges] : [];
  const base = {
    name: ws.name,
    rowCount: ws.rowCount,
    columnCount: ws.columnCount,
    actualRowCount: ws.actualRowCount ?? ws.rowCount,
    actualColumnCount: ws.actualColumnCount ?? ws.columnCount,
    merges,
    preview: rawPreview(ws),
    headerRowConfident: guess.confident,
  };
  const prot0 = ws.sheetProtection || null;
  base.protected = !!(prot0 && prot0.sheet);
  base.protectionDetails = prot0 ? { hasPassword: !!(prot0.algorithmName || prot0.password) } : null;

  // فشل واضح بدل التخمين: بلا صف ترويسة موثوق لا نُكمل التحليل التلقائي
  if (!guess.confident) {
    return {
      ...base,
      headerRow: null, headers: [], firstDataRow: null, lastDataRow: null,
      columns: [], validations: [],
      needsManualHeader: true,
    };
  }
  const headers = [];
  ws.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, colNum) => {
    const t = cellText(cell).trim();
    if (t) headers.push({ col: colLetter(colNum), colNum, text: t });
  });

  // نطاق صفوف الطلاب: السلسلة المتصلة الأولى بعد الترويسة —
  // نتوقف عند أول صف فارغ حتى لا تدخل صفوف الملخص السفلية (كالمتوسط) في النطاق
  let firstDataRow = null, lastDataRow = null;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    let hasValue = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (!isFormulaCell(cell) && cellText(cell).trim() !== '') hasValue = true;
    });
    if (hasValue) {
      if (firstDataRow === null) firstDataRow = r;
      lastDataRow = r;
    } else if (firstDataRow !== null) {
      break;
    }
  }

  // تحليل الأعمدة داخل نطاق الطلاب: قيم مدخلة أم معادلات
  const columns = [];
  for (const h of headers) {
    let valueCells = 0, formulaCells = 0, emptyCells = 0, sampleFormula = null;
    if (firstDataRow !== null) {
      for (let r = firstDataRow; r <= lastDataRow; r++) {
        const cell = ws.getRow(r).getCell(h.colNum);
        if (isFormulaCell(cell)) {
          formulaCells++;
          if (!sampleFormula) sampleFormula = cell.formula || (cell.value && cell.value.formula) || 'shared';
        } else if (cellText(cell).trim() !== '') {
          valueCells++;
        } else {
          emptyCells++;
        }
      }
    }
    columns.push({ ...h, valueCells, formulaCells, emptyCells, sampleFormula });
  }

  // قواعد التحقق من الصحة — تُجمَّع القواعد المتطابقة في نطاقات مضغوطة
  const dvModel = ws.dataValidations && ws.dataValidations.model ? ws.dataValidations.model : {};
  const groups = new Map(); // توقيع القاعدة -> قائمة الخلايا
  for (const [range, dv] of Object.entries(dvModel)) {
    const sig = JSON.stringify({ t: dv.type, o: dv.operator || null, f: dv.formulae || [], b: dv.allowBlank !== false });
    if (!groups.has(sig)) groups.set(sig, []);
    for (const part of range.split(/\s+/)) groups.get(sig).push(part);
  }
  const validations = [];
  for (const [sig, cells] of groups) {
    const { t, o, f, b } = JSON.parse(sig);
    validations.push({
      range: compressCellList(cells),
      type: t, operator: o, formulae: f, allowBlank: b,
    });
  }

  return {
    ...base,
    headerRow,
    headers,
    firstDataRow,
    lastDataRow,
    // فشل واضح: وجدنا الترويسة لكن لا صفوف بيانات تحتها
    needsManualRange: firstDataRow === null,
    columns,
    validations,
  };
}

export async function scanWorkbook(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheets = [];
  wb.eachSheet((ws) => sheets.push(analyzeSheet(ws)));
  return { sheets };
}

// إعادة تحليل ورقة واحدة بصف ترويسة يحدده المستخدم يدويًا
export async function analyzeOneSheet(filePath, sheetName, headerRowOverride) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`الورقة غير موجودة: ${sheetName}`);
  return analyzeSheet(ws, headerRowOverride);
}

// استخراج صفوف الطلاب بعد المطابقة اليدوية للأعمدة
export async function extractStudents(filePath, mapping) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet(mapping.sheetName);
  if (!ws) throw new Error(`الورقة غير موجودة: ${mapping.sheetName}`);
  const nameCol = colNumber(mapping.nameColumn);
  const entries = [];
  for (let r = mapping.firstDataRow; r <= mapping.lastDataRow; r++) {
    const row = ws.getRow(r);
    const name = cellText(row.getCell(nameCol)).trim();
    if (!name) continue;
    const entry = { row: r, name };
    if (mapping.gradeColumn) entry.grade = cellText(row.getCell(colNumber(mapping.gradeColumn))).trim();
    if (mapping.sectionColumn) entry.section = cellText(row.getCell(colNumber(mapping.sectionColumn))).trim();
    entries.push(entry);
  }
  return entries;
}
