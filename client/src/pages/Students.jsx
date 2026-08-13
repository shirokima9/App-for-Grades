import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';

export default function Students() {
  const { t } = useI18n();
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState('');
  const [students, setStudents] = useState([]);
  const [archived, setArchived] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/sections').then(list => {
      setSections(list);
      const fromHash = new URLSearchParams(window.location.hash.split('?')[1] || '').get('section');
      if (fromHash) setSectionId(fromHash);
      else if (list.length > 0) setSectionId(String(list[0].id));
    });
  }, []);

  const load = () => {
    if (!sectionId) return;
    api(`/students?section_id=${sectionId}`).then(setStudents).catch(e => setErr(e.message));
    api(`/students?section_id=${sectionId}&status=archived`).then(setArchived).catch(() => {});
  };
  useEffect(load, [sectionId]);

  const restore = async (id) => {
    setErr('');
    try {
      await api(`/students/${id}/restore`, { method: 'POST' });
      load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="card">
      <h2>{t('students')}</h2>
      {err && <div className="alert danger">{err}</div>}
      <div className="field">
        <label>{t('sections')}</label>
        <select value={sectionId} onChange={e => setSectionId(e.target.value)}>
          {sections.map(s => <option key={s.id} value={s.id}>{t('grade')} {s.grade} / {s.name}</option>)}
        </select>
      </div>
      <p className="muted">{students.length} {t('students_label')}</p>
      <div className="tablewrap">
        <table className="data">
          <thead><tr><th>#</th><th>{t('fileName')}</th></tr></thead>
          <tbody>
            {students.map((s, i) => (
              <tr key={s.id}><td>{i + 1}</td><td>{s.original_name}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      {archived.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button className="ghost" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? t('hideArchived') : t('showArchived')} ({archived.length})
          </button>
          {showArchived && (
            <>
              <p className="muted">{t('archiveNote')}</p>
              <ul>
                {archived.map(s => (
                  <li key={s.id} style={{ marginBottom: 8 }}>
                    {s.original_name}{' '}
                    <button className="ghost" style={{ minHeight: 36, padding: '4px 14px' }}
                      onClick={() => restore(s.id)}>{t('restore')}</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
