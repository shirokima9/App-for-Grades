import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';

// تقارير أولياء الأمور: تقرير الطالب + نص واتساب مع زر نسخ + تصدير PDF.
// PDF يُنتَج عبر طباعة المتصفح: هذا يضمن تشكيل الحروف العربية والاتجاه RTL
// بشكل صحيح 100% وبالخط المضمَّن محليًا في التطبيق نفسه.
export default function Reports() {
  const { t } = useI18n();
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState('');
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState('');
  const [report, setReport] = useState(null);
  const [batch, setBatch] = useState(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');
  const printRef = useRef(null);

  useEffect(() => {
    api('/sections').then(list => {
      setSections(list);
      const saved = localStorage.getItem('lastSection');
      setSectionId(saved && list.some(s => String(s.id) === saved) ? saved : (list[0] ? String(list[0].id) : ''));
    });
  }, []);

  useEffect(() => {
    if (!sectionId) return;
    setReport(null); setBatch(null);
    api(`/students?section_id=${sectionId}`).then(list => {
      setStudents(list);
      setStudentId(list[0] ? String(list[0].id) : '');
    });
  }, [sectionId]);

  const loadOne = async () => {
    setErr(''); setBatch(null);
    try { setReport(await api(`/reports/student/${studentId}`)); }
    catch (e) { setErr(e.message); }
  };

  const loadBatch = async () => {
    setErr(''); setReport(null);
    try { setBatch(await api(`/reports/section/${sectionId}`)); }
    catch (e) { setErr(e.message); }
  };

  const copyMessage = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // بديل يعمل دون إذن الحافظة (شائع على http في الشبكة المحلية)
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const printPdf = () => window.print();

  const ReportCard = ({ r }) => (
    <div className="report-card">
      <div className="report-head">
        <h3>{t('parentReport')}</h3>
        <div className="muted">{t('date')}: {r.generatedAt}</div>
      </div>
      <table className="data report-table">
        <tbody>
          <tr><th>{t('student')}</th><td>{r.student.name}</td></tr>
          {r.section && <tr><th>{t('sections')}</th><td>{t('grade')} {r.section.grade} / {r.section.name}</td></tr>}
          <tr><th>{t('total')}</th><td>{r.total} / {r.gradedMax} {r.percent !== null && `(${r.percent}%)`}</td></tr>
          <tr><th>{t('attendanceRate')}</th><td>{r.attendance.rate === null ? '—' : `${r.attendance.rate}%`}
            {r.attendance.absent > 0 && ` — ${t('absent')}: ${r.attendance.absent}`}
            {r.attendance.late > 0 && ` — ${t('late')}: ${r.attendance.late}`}</td></tr>
          <tr><th>{t('behavior')}</th><td>{r.behaviorCount}</td></tr>
          <tr><th>{t('book')}</th><td>{r.bookCount}</td></tr>
        </tbody>
      </table>

      <h4>{t('grades')}</h4>
      <table className="data">
        <thead><tr><th>{t('assessment')}</th><th>{t('score')}</th><th>{t('maxScore')}</th></tr></thead>
        <tbody>
          {r.grades.map((g, i) => (
            <tr key={i}><td>{g.name}</td><td>{g.score === null ? '—' : g.score}</td><td>{g.max}</td></tr>
          ))}
        </tbody>
      </table>

      {r.incidents.length > 0 && (
        <>
          <h4>{t('incidentsAndNotes')}</h4>
          <table className="data">
            <thead><tr><th>{t('date')}</th><th>{t('type')}</th><th>{t('tags')}</th><th>{t('note')}</th></tr></thead>
            <tbody>
              {r.incidents.map(i => (
                <tr key={i.id}>
                  <td>{i.date}</td>
                  <td>{i.kind === 'behavior' ? t('behavior') : t('book')}</td>
                  <td>{i.tags.join('، ') || '—'}</td>
                  <td>{i.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h4 className="no-print">{t('whatsappMessage')}</h4>
      <pre className="msg-box no-print">{r.message}</pre>
      <div className="rowflex no-print">
        <button className="primary" onClick={() => copyMessage(r.message)}>
          {copied ? `✓ ${t('copied')}` : t('copyMessage')}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="card compact no-print">
        <div className="rowflex">
          <div className="field grow">
            <label>{t('sections')}</label>
            <select value={sectionId} onChange={e => setSectionId(e.target.value)}>
              {sections.map(s => <option key={s.id} value={s.id}>{t('grade')} {s.grade} / {s.name}</option>)}
            </select>
          </div>
          <div className="field grow">
            <label>{t('student')}</label>
            <select value={studentId} onChange={e => setStudentId(e.target.value)}>
              {students.map(s => <option key={s.id} value={s.id}>{s.original_name}</option>)}
            </select>
          </div>
        </div>
        <div className="rowflex">
          <button className="primary" onClick={loadOne} disabled={!studentId}>{t('showReport')}</button>
          <button className="ghost" onClick={loadBatch}>{t('batchReports')}</button>
          {(report || batch) && <button className="ghost" onClick={printPdf}>🖨 {t('exportPdf')}</button>}
        </div>
        {(report || batch) && <p className="muted">{t('pdfHint')}</p>}
      </div>

      {err && <div className="alert danger no-print">{err}</div>}

      <div ref={printRef} className="print-area">
        {report && <div className="card"><ReportCard r={report} /></div>}
        {batch && batch.reports.map(r => (
          <div className="card page-break" key={r.student.id}><ReportCard r={r} /></div>
        ))}
      </div>
    </>
  );
}
