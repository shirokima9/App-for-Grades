import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArabic, compareNames, matchNames } from '../matching/names.js';

test('التطبيع: الهمزات والتاء المربوطة والألف المقصورة والتشكيل والتطويل', () => {
  assert.equal(normalizeArabic('أحمد'), 'احمد');
  assert.equal(normalizeArabic('إياد'), 'اياد');
  assert.equal(normalizeArabic('آدم'), 'ادم');
  assert.equal(normalizeArabic('حمزة'), 'حمزه');
  assert.equal(normalizeArabic('مصطفى'), 'مصطفي');
  assert.equal(normalizeArabic('مُحَمَّد'), 'محمد');
  assert.equal(normalizeArabic('سـالم'), 'سالم');
  assert.equal(normalizeArabic('  أحمد   سالم  '), 'احمد سالم');
});

test('تطابق تام بعد التطبيع', () => {
  const a = normalizeArabic('أحمد سالم محمد البلوشي');
  const b = normalizeArabic('احمد سالم محمد البلوشى');
  assert.equal(compareNames(a, b).level, 'exact');
});

test('اختلاف اسم واحد من أربعة = قريب وليس تامًا', () => {
  const a = normalizeArabic('أحمد سالم محمد البلوشي');
  const b = normalizeArabic('أحمد سليم محمد البلوشي');
  const r = compareNames(a, b);
  assert.equal(r.level, 'close');
});

test('عبدالله / عبد الله = قريب (اختلاف مسافة)', () => {
  const a = normalizeArabic('عبدالله خميس سعيد الحارثي');
  const b = normalizeArabic('عبد الله خميس سعيد الحارثي');
  const r = compareNames(a, b);
  assert.equal(r.level, 'close');
  assert.equal(r.reason, 'space_diff');
});

test('اسمان مختلفان تمامًا = لا تطابق', () => {
  const a = normalizeArabic('أحمد سالم محمد البلوشي');
  const b = normalizeArabic('هيثم سعود راشد المعمري');
  assert.equal(compareNames(a, b).level, 'none');
});

test('التطابق التام لا يُخلط مع القريب عند وجود اسمين متشابهين في القاعدة', () => {
  const dbStudents = [
    { id: 1, normalized_name: normalizeArabic('أحمد سالم محمد البلوشي'), original_name: 'أحمد سالم محمد البلوشي' },
    { id: 2, normalized_name: normalizeArabic('أحمد سليم محمد البلوشي'), original_name: 'أحمد سليم محمد البلوشي' },
  ];
  const results = matchNames([{ row: 6, name: 'أحمد سالم محمد البلوشي' }], dbStudents);
  assert.equal(results[0].level, 'exact');
  assert.equal(results[0].candidates[0].student.id, 1);
});

test('تطابقان تامّان في القاعدة = يتحول لقريب ولا يُقبل تلقائيًا', () => {
  const dbStudents = [
    { id: 1, normalized_name: 'احمد سالم محمد البلوشي', original_name: 'أ' },
    { id: 2, normalized_name: 'احمد سالم محمد البلوشي', original_name: 'ب' },
  ];
  const results = matchNames([{ row: 6, name: 'أحمد سالم محمد البلوشي' }], dbStudents);
  assert.equal(results[0].level, 'close');
  assert.equal(results[0].candidates.length, 2);
});
