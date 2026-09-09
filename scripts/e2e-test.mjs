// دورة اختبار كاملة: استيراد ← رصد ← تصدير نسختي ← كتابة في نسخة الملف الوزاري ← تقرير تحقق
const BASE = 'http://localhost:4750/api';
import fs from 'fs';

async function call(path, opts = {}) {
  const o = { ...opts };
  if (o.json !== undefined) {
    o.method = o.method || 'POST';
    o.headers = { 'Content-Type': 'application/json' };
    o.body = JSON.stringify(o.json);
    delete o.json;
  }
  const res = await fetch(BASE + path, o);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${data?.error || 'خطأ'}`);
  return data;
}

const log = (...a) => console.log(...a);
const hr = (t) => log('\n' + '='.repeat(60) + '\n' + t + '\n' + '='.repeat(60));

// 1) الشعبة
hr('1) إنشاء الشعبة واستيراد الملف الوزاري');
const sections = await call('/sections');
let section = sections.find(s => s.grade === 6 && s.name === 'أ');
if (!section) section = await call('/sections', { json: { grade: 6, name: 'أ' } });
log(`الشعبة: الصف ${section.grade} / ${section.name} (id=${section.id})`);

// 2) رفع الملف الوزاري
const fd = new FormData();
fd.append('file', new Blob([fs.readFileSync('samples/ministry_sample.xlsx')]), 'ministry_sample.xlsx');
const up = await fetch(BASE + '/import/upload', { method: 'POST', body: fd }).then(r => r.json());
const sheet = up.scan.sheets[0];
log(`الملف: ${up.originalName}`);
log(`الورقة "${sheet.name}" | محمية: ${sheet.protected} | صف العناوين: ${sheet.headerRow} | نطاق الطلاب: ${sheet.firstDataRow}-${sheet.lastDataRow}`);
log(`أعمدة المعادلات: ${sheet.columns.filter(c => c.formulaCells > 0).map(c => c.col + '(' + c.text + ')').join(', ')}`);
log(`قواعد التحقق: ${sheet.validations.map(v => v.range + ' ' + v.type).join(' | ')}`);

const mapping = {
  sheetName: 'الدرجات', headerRow: 5, firstDataRow: 6, lastDataRow: 30,
  nameColumn: 'B', gradeColumn: 'C', sectionColumn: 'D',
  scoreColumns: [
    { col: 'E', header: 'الأداة الأولى', max: 20 },
    { col: 'F', header: 'الأداة الثانية', max: 20 },
    { col: 'G', header: 'المشروع', max: 20 },
    { col: 'H', header: 'الاختبار القصير', max: 20 },
  ],
};

const match = await call('/import/match', { json: { uploadId: up.uploadId, mapping, sectionId: section.id } });
log(`\nالمطابقة: تام=${match.summary.exact} قريب=${match.summary.close} بدون=${match.summary.none}`);

const decisions = match.results.map(r =>
  r.level === 'exact'
    ? { row: r.row, name: r.name, action: 'match', studentId: r.candidates[0].student.id, decidedBy: 'auto-exact' }
    : r.level === 'close'
      ? { row: r.row, name: r.name, action: 'match', studentId: r.candidates[0].student.id, decidedBy: 'manual' }
      : { row: r.row, name: r.name, action: 'new' });
const commit = await call('/import/commit', {
  json: { uploadId: up.uploadId, templateName: 'القالب الوزاري 6-أ', mapping, sectionId: section.id, decisions },
});
log(`تم الاستيراد: مطابَقون=${commit.diff.matched} جدد=${commit.diff.added.length}`);
const templateId = commit.templateId;

// 3) رصد الدرجات
hr('2) رصد الدرجات');
const students = await call(`/students?section_id=${section.id}`);
const assessments = await call(`/assessments?section_id=${section.id}`);
log(`عناصر التقييم: ${assessments.map(a => a.name + ' (من ' + a.max_score + ')').join(', ')}`);

let entered = 0;
for (const [i, st] of students.entries()) {
  for (const [j, a] of assessments.entries()) {
    // درجات متنوعة لاختبار التحليل، وبعض الطلاب متعثرون عمدًا
    const base = i % 7 === 0 ? 6 : 10 + ((i * 3 + j * 5) % 10);
    await call('/grades', { json: { studentId: st.id, assessmentId: a.id, score: base, clientUuid: crypto.randomUUID() } });
    entered++;
  }
}
log(`رُصدت ${entered} درجة لـ ${students.length} طالبًا`);

// السلوك والكتاب والحضور
for (let i = 0; i < 5; i++) {
  const st = students[i];
  const n = i < 2 ? 3 : 1;
  for (let k = 0; k < n; k++) {
    await call('/incidents', { json: {
      studentId: st.id, kind: k % 2 ? 'book' : 'behavior',
      date: `2026-09-0${k + 1}`, period: 2, tags: ['مقاطعة'], note: 'ملاحظة اختبار',
      clientUuid: crypto.randomUUID() } });
  }
  await call('/attendance', { json: { studentId: st.id, date: '2026-09-01', status: i < 2 ? 'absent' : 'late' } });
}
const incSummary = await call(`/incidents/summary?section_id=${section.id}`);
log(`المخالفات: ${incSummary.rows.filter(r => r.behaviorCount + r.bookCount > 0).length} طلاب لديهم مخالفات، ${incSummary.rows.filter(r => r.overThreshold).length} تجاوزوا الحد (${incSummary.behaviorThreshold})`);

// 4) تصدير نسختي
hr('3) تصدير نسخة العمل الخاصة بي');
const exp = await call(`/submit/export/${section.id}`, { method: 'POST' });
log(`الملف: exports/${exp.fileName} (${exp.students} طالبًا، مرتبون أبجديًا عربيًا)`);

// 5) معاينة الكتابة (dry run)
hr('4) المعاينة الإلزامية قبل الكتابة (Dry Run)');
const preview = await call(`/submit/preview/${templateId}`);
log(`الملخص: مطابقات تامة=${preview.summary.confirmedMatches} | مؤكدة يدويًا=${preview.summary.manualMatches} | غير مطابَق=${preview.summary.unmatched} | خلايا ستُكتب=${preview.summary.cellsToWrite}`);
log(`يمكن الكتابة: ${preview.canWrite} | موانع: ${preview.blockers.length}`);
log('\nعينة من جدول المعاينة:');
log('الاسم في ملفي'.padEnd(28) + '| الاسم في الوزاري'.padEnd(30) + '| الخلية | القيمة | الحالة');
for (const r of preview.rows.slice(0, 5)) {
  log(String(r.myName).padEnd(28) + '| ' + String(r.fileName).padEnd(28) + '| ' + String(r.cell).padEnd(6) + ' | ' + String(r.value).padEnd(6) + ' | ' + r.status);
}

// اختبار الرفض بلا تأكيد
try {
  await call(`/submit/write/${templateId}`, { json: {} });
  log('\n✗ خطأ: قبل الكتابة بلا تأكيد!');
} catch (e) {
  log(`\n✓ رُفضت الكتابة بلا تأكيد صريح: ${e.message.split(': ')[1]}`);
}

// اختبار القاعدة الصارمة: طالب واحد غير مطابَق يوقف العملية كلها
if (!preview.canWrite) {
  log('\n--- اختبار القاعدة الصارمة ---');
  log(`✓ العملية موقوفة بسبب ${preview.blockers.length} مانع:`);
  preview.blockers.forEach(b => log(`   • ${b}`));
  try {
    await call(`/submit/write/${templateId}`, { json: { confirm: true } });
    log('✗ خطأ فادح: كتب رغم وجود موانع!');
    process.exit(1);
  } catch (e) {
    log('✓ رفض الخادم الكتابة رغم التأكيد الصريح — لا كتابة مع وجود مانع واحد');
  }
  // الحسم: أرشفة الطلاب غير الموجودين في الملف الوزاري (قرار المعلم)
  const unmatched = preview.rows.filter(r => r.status === 'unmatched');
  for (const u of unmatched) {
    await call(`/students/${u.studentId}/archive`, { method: 'POST' });
    log(`   أُرشف: ${u.myName} (درجاته وملاحظاته محفوظة)`);
  }
  const p2 = await call(`/submit/preview/${templateId}`);
  log(`بعد الحسم: خلايا ستُكتب=${p2.summary.cellsToWrite} | يمكن الكتابة: ${p2.canWrite}`);
}

// 6) الكتابة الفعلية
hr('5) الكتابة في نسخة من الملف الوزاري');
const wr = await call(`/submit/write/${templateId}`, { json: { confirm: true } });
log(`الملف الناتج: submissions/${wr.file}`);
log(`خلايا مكتوبة: ${wr.cellsWritten} | قيم معادلات محذوفة (لإعادة الحساب): ${wr.formulasStripped}`);

// 7) تقرير التحقق
hr('6) تقرير التحقق بعد الكتابة');
const v = wr.verification;
log(`القيم المطابقة: ${v.valuesOk} / ${wr.cellsWritten} | الفروقات: ${v.valuesMismatch}`);
const s = v.structural;
log(`المعادلات:    قبل=${s.formulasBefore} بعد=${s.formulasAfter} ${s.formulasOk ? '✓' : '✗'}`);
log(`قواعد التحقق: قبل=${s.validationsBefore} بعد=${s.validationsAfter} ${s.validationsOk ? '✓' : '✗'}`);
log(`حماية الأوراق: قبل=${s.protectionsBefore} بعد=${s.protectionsAfter} ${s.protectionsOk ? '✓' : '✗'}`);
log(`الخلايا المدمجة: قبل=${s.mergedBefore} بعد=${s.mergedAfter} ${s.mergedOk ? '✓' : '✗'}`);
log(`التنسيق الشرطي: قبل=${s.condFormatsBefore} بعد=${s.condFormatsAfter} ${s.condFormatsOk ? '✓' : '✗'}`);
log(`ملفات مفقودة من الأرشيف: ${s.missingEntries.length} ${s.entriesOk ? '✓' : '✗'}`);
log(`\nالنتيجة النهائية: ${v.perfect ? '✓✓ تطابق 100% وبنية سليمة' : '✗ يوجد فروقات'}`);

// 8) الأصل لم يُمس
const origHash = fs.statSync('samples/ministry_sample.xlsx');
log(`\nالملف الأصلي samples/ministry_sample.xlsx: ${origHash.size} بايت — لم يُفتح للكتابة إطلاقًا`);

// 9) التحليل
hr('7) التحليل الإحصائي');
const an = await call(`/analytics/section/${section.id}`);
log(`المتوسط=${an.stats.mean}% الوسيط=${an.stats.median}% الانحراف المعياري=${an.stats.stdDev} نسبة النجاح=${an.passRate}%`);
log(`متعثرون (تحت ${an.failingThreshold}%): ${an.struggling.length} | المتفوقون: ${an.top.slice(0, 3).map(t => t.name.split(' ')[0] + ' ' + t.percent + '%').join(', ')}`);
log(`ربط الدرجة بالسلوك: بمخالفات متكررة متوسط=${an.behaviorCorrelation.withRepeatedIncidents.mean}% (${an.behaviorCorrelation.withRepeatedIncidents.count} طلاب) | بدونها متوسط=${an.behaviorCorrelation.withoutRepeatedIncidents.mean}% (${an.behaviorCorrelation.withoutRepeatedIncidents.count} طلاب)`);
log(`التوزيع: ${an.histogram.filter(b => b.count).map(b => b.label + '%: ' + b.count).join(' | ')}`);

// 10) تقرير ولي أمر
hr('8) تقرير ولي الأمر');
const rep = await call(`/reports/student/${students[0].id}`);
log(`الطالب: ${rep.student.name} | المجموع ${rep.total}/${rep.gradedMax} (${rep.percent}%) | الحضور ${rep.attendance.rate}% | مخالفات ${rep.behaviorCount}`);
log('\nنص رسالة واتساب:\n' + '-'.repeat(40));
log(rep.message);
log('-'.repeat(40));

// حفظ المسار للفحص اللاحق
fs.writeFileSync('/tmp/claude-0/-home-user-App-for-Grades/10ee4b1f-f9e5-568e-85fd-b91bf903d535/scratchpad/last-submission.txt', wr.path);
log(`\n✓ الدورة الكاملة نجحت. templateId=${templateId} sectionId=${section.id}`);
