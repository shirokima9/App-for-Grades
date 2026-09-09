import express from 'express';
import { db, getSetting } from '../db/index.js';

const router = express.Router();

function stats(values) {
  const v = values.filter(x => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return { count: 0, mean: null, median: null, stdDev: null, min: null, max: null };
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  const variance = v.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  return {
    count: n,
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    stdDev: Math.round(Math.sqrt(variance) * 100) / 100,
    min: v[0], max: v[n - 1],
  };
}

// مجموع درجات الطالب ونسبته المئوية عبر كل عناصر التقييم
function studentTotals(sectionId) {
  const assessments = db.prepare('SELECT * FROM assessments WHERE section_id = ?').all(sectionId);
  const maxTotal = assessments.reduce((s, a) => s + a.max_score, 0);
  const students = db.prepare("SELECT * FROM students WHERE section_id = ? AND status='active'").all(sectionId);
  const gradeStmt = db.prepare('SELECT assessment_id, score FROM grades WHERE student_id = ?');
  return {
    maxTotal,
    assessments,
    rows: students.map(st => {
      const gs = gradeStmt.all(st.id);
      const byAssessment = Object.fromEntries(gs.map(g => [g.assessment_id, g.score]));
      const scored = gs.filter(g => typeof g.score === 'number');
      const total = scored.reduce((s, g) => s + g.score, 0);
      const gradedMax = scored.reduce((s, g) => {
        const a = assessments.find(x => x.id === g.assessment_id);
        return s + (a ? a.max_score : 0);
      }, 0);
      return {
        id: st.id, name: st.original_name,
        total, gradedMax, byAssessment,
        percent: gradedMax > 0 ? Math.round((total / gradedMax) * 1000) / 10 : null,
        graded: scored.length,
      };
    }),
  };
}

// توزيع الدرجات (histogram) بفئات 10%
function histogram(percents) {
  const bins = Array.from({ length: 10 }, (_, i) => ({
    label: `${i * 10}–${i * 10 + 10}`,
    from: i * 10, to: i * 10 + 10, count: 0,
  }));
  for (const p of percents) {
    if (typeof p !== 'number') continue;
    const idx = Math.min(9, Math.floor(p / 10));
    bins[idx].count++;
  }
  return bins;
}

router.get('/analytics/section/:id', (req, res) => {
  try {
    const sectionId = Number(req.params.id);
    const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId);
    if (!section) return res.status(404).json({ error: 'الشعبة غير موجودة' });

    const failingThreshold = Number(getSetting('failing_threshold_percent') || 50);
    const { rows, assessments, maxTotal } = studentTotals(sectionId);
    const percents = rows.map(r => r.percent).filter(p => p !== null);
    const s = stats(percents);

    // ربط الدرجة بالسلوك
    const incStmt = db.prepare("SELECT COUNT(*) c FROM incidents WHERE student_id = ? AND kind='behavior'");
    const withBehavior = [], withoutBehavior = [];
    const behaviorThreshold = Number(getSetting('behavior_alert_threshold') || 3);
    const enriched = rows.map(r => {
      const behaviorCount = incStmt.get(r.id).c;
      if (r.percent !== null) (behaviorCount >= behaviorThreshold ? withBehavior : withoutBehavior).push(r.percent);
      return { ...r, behaviorCount };
    });

    res.json({
      section,
      maxTotal,
      assessments: assessments.map(a => ({ id: a.id, name: a.name, max: a.max_score })),
      students: enriched,
      stats: s,
      histogram: histogram(percents),
      passRate: percents.length
        ? Math.round((percents.filter(p => p >= failingThreshold).length / percents.length) * 1000) / 10
        : null,
      failingThreshold,
      struggling: enriched.filter(r => r.percent !== null && r.percent < failingThreshold)
        .sort((a, b) => a.percent - b.percent),
      top: enriched.filter(r => r.percent !== null).sort((a, b) => b.percent - a.percent).slice(0, 5),
      behaviorCorrelation: {
        threshold: behaviorThreshold,
        withRepeatedIncidents: stats(withBehavior),
        withoutRepeatedIncidents: stats(withoutBehavior),
      },
      // تطور كل طالب عبر عناصر التقييم المتتالية
      progression: assessments.map(a => ({
        assessment: a.name,
        max: a.max_score,
        values: enriched.map(r => ({
          name: r.name,
          percent: typeof r.byAssessment[a.id] === 'number'
            ? Math.round((r.byAssessment[a.id] / a.max_score) * 1000) / 10 : null,
        })),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// مقارنة بين كل الشعب وبين الصفوف
router.get('/analytics/overview', (req, res) => {
  try {
    const failingThreshold = Number(getSetting('failing_threshold_percent') || 50);
    const sections = db.prepare('SELECT * FROM sections ORDER BY grade, name').all();
    const bySection = sections.map(sec => {
      const { rows } = studentTotals(sec.id);
      const percents = rows.map(r => r.percent).filter(p => p !== null);
      const s = stats(percents);
      return {
        id: sec.id, grade: sec.grade, name: sec.name,
        label: `${sec.grade}/${sec.name}`,
        students: rows.length,
        graded: percents.length,
        ...s,
        passRate: percents.length
          ? Math.round((percents.filter(p => p >= failingThreshold).length / percents.length) * 1000) / 10
          : null,
      };
    });
    const byGrade = [6, 7, 8].map(g => {
      const secs = bySection.filter(s => s.grade === g);
      const all = [];
      for (const sec of secs) {
        const { rows } = studentTotals(sec.id);
        for (const r of rows) if (r.percent !== null) all.push(r.percent);
      }
      return {
        grade: g, sections: secs.length, students: secs.reduce((s, x) => s + x.students, 0),
        ...stats(all),
        passRate: all.length
          ? Math.round((all.filter(p => p >= failingThreshold).length / all.length) * 1000) / 10 : null,
      };
    }).filter(g => g.sections > 0);

    res.json({ bySection, byGrade, failingThreshold });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
