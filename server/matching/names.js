// تطبيع الأسماء العربية والمطابقة على ثلاثة مستويات.
// الاسم الأصلي يُحفظ دائمًا كما هو؛ التطبيع للمقارنة الداخلية فقط.

const TASHKEEL = /[ً-ْٰـ]/g; // التشكيل + التطويل
// علامات خفية شائعة في الملفات العربية المنسّقة:
// LRM/RLM وعلامة العربية (ALM) والأحرف صفرية العرض وBOM وعلامات التضمين الاتجاهية
const INVISIBLE = /[\u200E\u200F\u061C\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g;
// مسافات غير قياسية (منها المسافة غير القابلة للكسر NBSP) تتحول لمسافة عادية
const ODD_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
export function normalizeArabic(name) {
  if (!name) return '';
  return String(name)
    .replace(INVISIBLE, '')
    .replace(ODD_SPACES, ' ')
    .replace(TASHKEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

// "عبد الله" و"عبدالله" وأشباهها تُقارن أيضًا بصيغة بلا مسافات
function squash(s) {
  return s.replace(/ /g, '');
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

// يقارن اسمين مطبَّعين ويعيد: exact / close / none مع تفاصيل السبب
export function compareNames(normA, normB) {
  if (!normA || !normB) return { level: 'none' };
  if (normA === normB) return { level: 'exact' };
  if (squash(normA) === squash(normB)) {
    return { level: 'close', reason: 'space_diff', distance: 0 };
  }

  const partsA = normA.split(' ');
  const partsB = normB.split(' ');

  // اختلاف اسم واحد فقط من الأسماء الأربعة (مع تساوي العدد)
  if (partsA.length === partsB.length && partsA.length >= 3) {
    let diff = 0;
    for (let i = 0; i < partsA.length; i++) {
      if (partsA[i] !== partsB[i]) diff++;
    }
    if (diff === 1) return { level: 'close', reason: 'one_part_diff' };
  }

  // مسافة تحرير بسيطة على الاسم الكامل (نسبةً لطوله)
  const dist = levenshtein(squash(normA), squash(normB));
  const maxLen = Math.max(squash(normA).length, squash(normB).length);
  if (dist <= 2 || dist / maxLen <= 0.12) {
    return { level: 'close', reason: 'edit_distance', distance: dist };
  }
  return { level: 'none', distance: dist };
}

// مطابقة قائمة أسماء من الملف مع طلاب قاعدة البيانات.
// تعيد لكل اسم ملف: exact (مرشح واحد تام) / close (مرشحون للمراجعة) / none
export function matchNames(fileEntries, dbStudents) {
  const results = [];
  for (const entry of fileEntries) {
    const norm = normalizeArabic(entry.name);
    const exact = [];
    const close = [];
    for (const st of dbStudents) {
      const cmp = compareNames(norm, st.normalized_name);
      if (cmp.level === 'exact') exact.push({ student: st, ...cmp });
      else if (cmp.level === 'close') close.push({ student: st, ...cmp });
    }
    let level, candidates;
    if (exact.length === 1) {
      level = 'exact'; candidates = exact;
    } else if (exact.length > 1) {
      // اسمان متطابقان في القاعدة — لا يُقبل تلقائيًا أبدًا
      level = 'close'; candidates = exact;
    } else if (close.length > 0) {
      level = 'close'; candidates = close;
    } else {
      level = 'none'; candidates = [];
    }
    results.push({ ...entry, normalized: norm, level, candidates });
  }
  return results;
}
