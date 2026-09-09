import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { sendOrQueue, uuid } from '../offline.js';

// شاشة حضور سريعة: نقرة واحدة لكل طالب + تقرير غياب تراكمي مع تنبيه.
export default function Attendance() {
  const { t } = useI18n();
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [students, setStudents] = useState([]);
  const [today, setToday] = useState({});
  const [summary, setSummary] = useState({ rows: [], threshold: 5 });
  const [tab, setTab] = useState('today');
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/sections').then(list => {
      setSections(list);
      const saved = localStorage.getItem('lastSection');
      setSectionId(saved && list.some(s => String(s.id) === saved) ? saved : (list[0] ? String(list[0].id) : ''));
    });
  }, []);

  const load = () => {
    if (!sectionId) return;
    api(`/students?section_id=${sectionId}`).then(setStudents);
    api(`/attendance?section_id=${sectionId}&date=${date}`)
      .then(list => setToday(Object.fromEntries(list.map(a => [a.student_id, a.status]))));
    api(`/attendance/summary?section_id=${sectionId}`).then(setSummary);
  };
  useEffect(load, [sectionId, date]);

  const mark = async (student, status) => {
    setErr('');
    setToday(s => ({ ...s, [student.id]: status }));
    const body = { studentId: student.id, date, status, clientUuid: uuid() };
    try {
      await sendOrQueue('/attendance', body, { type: 'attendance', ...body });
      api(`/attendance/summary?section_id=${sectionId}`).then(setSummary);
    } catch (e) { setErr(e.message); }
  };

  const markAllPresent = async () => {
    for (const s of students) {
      if (!today[s.id]) await mark(s, 'present');
    }
  };

  const counts = {
    present: Object.values(today).filter(v => v === 'present').length,
    absent: Object.values(today).filter(v => v === 'absent').length,
    late: Object.values(today).filter(v => v === 'late').length,
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
          <div className="field">
            <label>{t('date')}</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
        </div>
        <div className="tabs">
          <button className={tab === 'today' ? 'on' : ''} onClick={() => setTab('today')}>{t('todayAttendance')}</button>
          <button className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>{t('absenceReport')}</button>
        </div>
      </div>

      {err && <div className="alert danger">{err}</div>}

      {tab === 'today' && (
        <div className="card">
          <div className="summary-chips">
            <span className="badge ok">{t('present')}: {counts.present}</span>
            <span className="badge danger">{t('absent')}: {counts.absent}</span>
            <span className="badge warn">{t('late')}: {counts.late}</span>
            <button className="ghost" style={{ minHeight: 36, padding: '4px 14px' }} onClick={markAllPresent}>
              {t('allPresent')}
            </button>
          </div>
          <div className="att-list">
            {students.map((s, i) => (
              <div key={s.id} className={`att-row ${today[s.id] || 'none'}`}>
                <span className="num">{i + 1}</span>
                <span className="name">{s.original_name}</span>
                <div className="att-btns">
                  <button className={`att-btn p ${today[s.id] === 'present' ? 'on' : ''}`} onClick={() => mark(s, 'present')}>{t('present')}</button>
                  <button className={`att-btn a ${today[s.id] === 'absent' ? 'on' : ''}`} onClick={() => mark(s, 'absent')}>{t('absent')}</button>
                  <button className={`att-btn l ${today[s.id] === 'late' ? 'on' : ''}`} onClick={() => mark(s, 'late')}>{t('late')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'summary' && (
        <div className="card">
          <h2>{t('absenceReport')}</h2>
          <div className="field">
            <label>{t('absenceThreshold')}</label>
            <input type="number" min="1" style={{ width: 90 }} value={summary.threshold}
              onChange={e => setSummary({ ...summary, threshold: e.target.value })}
              onBlur={async e => {
                await api('/settings/absence_alert_threshold', { method: 'PUT', json: { value: e.target.value } });
                load();
              }} />
          </div>
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr><th>{t('student')}</th><th>{t('absent')}</th><th>{t('late')}</th><th>{t('attendanceRate')}</th></tr>
              </thead>
              <tbody>
                {summary.rows.map(r => (
                  <tr key={r.id} className={r.overThreshold ? 'row-alert' : ''}>
                    <td>{r.overThreshold && '⚠ '}{r.name}</td>
                    <td>{r.absent || 0}</td>
                    <td>{r.late || 0}</td>
                    <td>{r.rate === null ? '—' : `${r.rate}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
