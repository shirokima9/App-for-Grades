import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';

export default function Home() {
  const { t } = useI18n();
  const [sections, setSections] = useState([]);
  const [grade, setGrade] = useState('6');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  const load = () => api('/sections').then(setSections).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);

  const addSection = async () => {
    setErr('');
    try {
      await api('/sections', { json: { grade: Number(grade), name } });
      setName('');
      load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <div className="card">
        <h2>{t('sections')}</h2>
        {err && <div className="alert danger">{err}</div>}
        {sections.length === 0 && <p className="muted">{t('noSections')}</p>}
        <div className="tablewrap">
          {sections.length > 0 && (
            <table className="data">
              <thead>
                <tr><th>{t('grade')}</th><th>{t('sectionName')}</th><th>{t('studentCount')}</th></tr>
              </thead>
              <tbody>
                {sections.map(s => (
                  <tr key={s.id}>
                    <td>{s.grade}</td>
                    <td><a href={`#/students?section=${s.id}`}>{s.name}</a></td>
                    <td>{s.student_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="card">
        <h3>{t('addSection')}</h3>
        <div className="rowflex">
          <div className="field">
            <label>{t('grade')}</label>
            <select value={grade} onChange={e => setGrade(e.target.value)}>
              <option value="6">6</option><option value="7">7</option><option value="8">8</option>
            </select>
          </div>
          <div className="field">
            <label>{t('sectionName')}</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="أ" />
          </div>
          <div className="field">
            <button className="primary" onClick={addSection} disabled={!name.trim()}>{t('add')}</button>
          </div>
        </div>
      </div>
    </>
  );
}
