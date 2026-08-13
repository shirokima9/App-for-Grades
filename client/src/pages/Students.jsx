import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';

export default function Students() {
  const { t } = useI18n();
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState('');
  const [students, setStudents] = useState([]);

  useEffect(() => {
    api('/sections').then(list => {
      setSections(list);
      const fromHash = new URLSearchParams(window.location.hash.split('?')[1] || '').get('section');
      if (fromHash) setSectionId(fromHash);
      else if (list.length > 0) setSectionId(String(list[0].id));
    });
  }, []);

  useEffect(() => {
    if (sectionId) api(`/students?section_id=${sectionId}`).then(setStudents);
  }, [sectionId]);

  return (
    <div className="card">
      <h2>{t('students')}</h2>
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
    </div>
  );
}
