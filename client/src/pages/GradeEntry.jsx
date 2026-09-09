import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { sendOrQueue, uuid } from '../offline.js';

// شاشة الرصد أثناء الحصة: أزرار كبيرة، لوحة أرقام داخل التطبيق (لا لوحة النظام)،
// حفظ فوري بعد كل درجة، انتقال تلقائي للتالي، وتراجع عن آخر إدخال.
export default function GradeEntry() {
  const { t } = useI18n();
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState('');
  const [assessments, setAssessments] = useState([]);
  const [assessmentId, setAssessmentId] = useState('');
  const [students, setStudents] = useState([]);
  const [scores, setScores] = useState({});      // studentId -> score
  const [activeIdx, setActiveIdx] = useState(0);
  const [buffer, setBuffer] = useState('');
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState('');
  const [lastEntry, setLastEntry] = useState(null);
  const [newAssessment, setNewAssessment] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    api('/sections').then(list => {
      setSections(list);
      const saved = localStorage.getItem('lastSection');
      const pick = saved && list.some(s => String(s.id) === saved) ? saved : (list[0] ? String(list[0].id) : '');
      setSectionId(pick);
    });
  }, []);

  useEffect(() => {
    if (!sectionId) return;
    localStorage.setItem('lastSection', sectionId);
    api(`/assessments?section_id=${sectionId}`).then(list => {
      setAssessments(list);
      setAssessmentId(list[0] ? String(list[0].id) : '');
    });
    api(`/students?section_id=${sectionId}`).then(list => {
      setStudents(list);
      setActiveIdx(0);
    });
  }, [sectionId]);

  useEffect(() => {
    if (!assessmentId || !sectionId) return;
    api(`/grades?assessment_id=${assessmentId}`).then(list => {
      setScores(Object.fromEntries(list.filter(g => g.score !== null).map(g => [g.student_id, g.score])));
    });
    setBuffer('');
    setActiveIdx(0);
  }, [assessmentId, sectionId]);

  const assessment = assessments.find(a => String(a.id) === String(assessmentId));
  const maxScore = assessment ? assessment.max_score : 20;
  const activeStudent = students[activeIdx];
  const remaining = useMemo(
    () => students.filter(s => scores[s.id] === undefined || scores[s.id] === null).length,
    [students, scores]
  );

  // تمرير الطالب النشط إلى وسط الشاشة تلقائيًا
  useEffect(() => {
    const el = listRef.current?.querySelector('.student-row.active');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIdx]);

  const flash = (text, kind = 'ok') => {
    setMsg({ text, kind });
    setTimeout(() => setMsg(null), 1800);
  };

  const saveScore = async (student, value) => {
    setErr('');
    const prev = scores[student.id];
    setScores(s => ({ ...s, [student.id]: value }));   // تحديث فوري في الواجهة
    setLastEntry({ studentId: student.id, assessmentId: Number(assessmentId), previous: prev ?? null, value });
    try {
      const res = await sendOrQueue('/grades',
        { studentId: student.id, assessmentId: Number(assessmentId), score: value, clientUuid: uuid() },
        { type: 'grade', studentId: student.id, assessmentId: Number(assessmentId), score: value });
      if (res.queued) flash(t('savedOffline'), 'warn');
    } catch (e) {
      setScores(s => ({ ...s, [student.id]: prev }));   // تراجع عن التحديث المتفائل
      setErr(e.message);
      return false;
    }
    return true;
  };

  const commitBuffer = async () => {
    if (!activeStudent || buffer === '') return;
    const value = Number(buffer);
    if (Number.isNaN(value) || value < 0 || value > maxScore) {
      setErr(`${t('scoreRange')} 0–${maxScore}`);
      setBuffer('');
      return;
    }
    const ok = await saveScore(activeStudent, value);
    setBuffer('');
    if (ok && activeIdx < students.length - 1) setActiveIdx(activeIdx + 1);  // انتقال تلقائي
  };

  const press = (key) => {
    setErr('');
    if (key === 'del') { setBuffer(b => b.slice(0, -1)); return; }
    if (key === 'ok') { commitBuffer(); return; }
    if (key === 'skip') {
      setBuffer('');
      if (activeIdx < students.length - 1) setActiveIdx(activeIdx + 1);
      return;
    }
    const next = buffer + key;
    if (Number(next) > maxScore) {
      // الرقم الثاني يتجاوز الحد → نعتبره بداية إدخال جديد للطالب التالي
      setBuffer(key);
      return;
    }
    setBuffer(next);
  };

  // إدخال تلقائي عند بلوغ عدد الخانات أقصاه (مثال: من 20 → خانتان)
  useEffect(() => {
    if (buffer === '') return;
    const maxDigits = String(maxScore).length;
    if (buffer.length >= maxDigits) {
      const timer = setTimeout(() => commitBuffer(), 350);
      return () => clearTimeout(timer);
    }
  }, [buffer]);

  const undo = async () => {
    if (!lastEntry) return;
    setErr('');
    try {
      const res = await api('/grades/undo', {
        json: { studentId: lastEntry.studentId, assessmentId: lastEntry.assessmentId },
      });
      setScores(s => ({ ...s, [lastEntry.studentId]: res.restored }));
      const idx = students.findIndex(x => x.id === lastEntry.studentId);
      if (idx >= 0) setActiveIdx(idx);
      setLastEntry(null);
      flash(t('undone'), 'warn');
    } catch (e) { setErr(e.message); }
  };

  const addAssessment = async () => {
    if (!newAssessment.trim()) return;
    try {
      const a = await api('/assessments', { json: { sectionId: Number(sectionId), name: newAssessment.trim(), maxScore: 20 } });
      setAssessments([...assessments, a]);
      setAssessmentId(String(a.id));
      setNewAssessment('');
    } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <div className="card compact">
        <div className="rowflex">
          <div className="field grow">
            <label>{t('sections')}</label>
            <select value={sectionId} onChange={e => setSectionId(e.target.value)}>
              {sections.map(s => <option key={s.id} value={s.id}>{t('grade')} {s.grade} / {s.name}</option>)}
            </select>
          </div>
          <div className="field grow">
            <label>{t('assessment')}</label>
            <select value={assessmentId} onChange={e => setAssessmentId(e.target.value)}>
              {assessments.map(a => <option key={a.id} value={a.id}>{a.name} ({a.max_score})</option>)}
            </select>
          </div>
        </div>
        {assessments.length === 0 && sectionId && (
          <div className="rowflex">
            <div className="field grow">
              <label>{t('newAssessment')}</label>
              <input value={newAssessment} onChange={e => setNewAssessment(e.target.value)} placeholder={t('assessmentName')} />
            </div>
            <div className="field"><button className="primary" onClick={addAssessment}>{t('add')}</button></div>
          </div>
        )}
        <div className="summary-chips">
          <span className="badge info">{t('students')}: {students.length}</span>
          <span className={`badge ${remaining > 0 ? 'warn' : 'ok'}`}>{t('notEntered')}: {remaining}</span>
        </div>
      </div>

      {err && <div className="alert danger">{err}</div>}
      {msg && <div className={`alert ${msg.kind}`}>{msg.text}</div>}

      {assessmentId && students.length > 0 && (
        <>
          <div className="entry-list" ref={listRef}>
            {students.map((s, i) => {
              const val = scores[s.id];
              const has = val !== undefined && val !== null;
              return (
                <button key={s.id}
                  className={`student-row ${i === activeIdx ? 'active' : ''} ${has ? 'done' : 'pending'}`}
                  onClick={() => { setActiveIdx(i); setBuffer(''); }}>
                  <span className="num">{i + 1}</span>
                  <span className="name">{s.original_name}</span>
                  <span className="score">
                    {i === activeIdx && buffer !== '' ? <b className="typing">{buffer}</b> : (has ? val : '—')}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="numpad-wrap">
            <div className="numpad-head">
              <span className="who">{activeStudent ? activeStudent.original_name : '—'}</span>
              <span className="max">{t('outOf')} {maxScore}</span>
            </div>
            <div className="numpad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(k => (
                <button key={k} onClick={() => press(k)}>{k}</button>
              ))}
              <button className="wide-del" onClick={() => press('del')}>⌫</button>
              <button onClick={() => press('0')}>0</button>
              <button className="ok" onClick={() => press('ok')}>✓</button>
            </div>
            <div className="numpad-actions">
              <button className="ghost" onClick={() => press('skip')}>{t('skipStudent')} ›</button>
              <button className="ghost" onClick={undo} disabled={!lastEntry}>↶ {t('undo')}</button>
            </div>
          </div>
        </>
      )}
      {students.length === 0 && sectionId && <div className="card"><p className="muted">{t('noStudents')}</p></div>}
    </>
  );
}
