import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { sendOrQueue, uuid } from '../offline.js';

// السلوك والكتاب: تسجيل بالحدث لا بالحضور — لا رصد لكل طالب كل حصة.
export default function Behavior() {
  const { t } = useI18n();
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState('');
  const [summary, setSummary] = useState({ rows: [], behaviorThreshold: 3 });
  const [tags, setTags] = useState([]);
  const [sheet, setSheet] = useState(null);   // {student, kind}
  const [pickedTags, setPickedTags] = useState([]);
  const [note, setNote] = useState('');
  const [period, setPeriod] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [newTag, setNewTag] = useState('');

  useEffect(() => {
    api('/sections').then(list => {
      setSections(list);
      const saved = localStorage.getItem('lastSection');
      setSectionId(saved && list.some(s => String(s.id) === saved) ? saved : (list[0] ? String(list[0].id) : ''));
    });
    api('/settings').then(s => setTags(JSON.parse(s.incident_tags || '[]')));
  }, []);

  const load = () => {
    if (!sectionId) return;
    api(`/incidents/summary?section_id=${sectionId}`).then(setSummary).catch(e => setErr(e.message));
  };
  useEffect(load, [sectionId]);

  const openSheet = (student, kind) => {
    setSheet({ student, kind });
    setPickedTags([]); setNote(''); setPeriod('');
  };

  const save = async () => {
    setErr('');
    const today = new Date().toISOString().slice(0, 10);
    const body = {
      studentId: sheet.student.id, kind: sheet.kind, date: today,
      period: period ? Number(period) : null, tags: pickedTags, note: note.trim() || null,
      clientUuid: uuid(),
    };
    try {
      const res = await sendOrQueue('/incidents', body, { type: 'incident', ...body });
      setSheet(null);
      setMsg(res.queued ? t('savedOffline') : t('incidentSaved'));
      setTimeout(() => setMsg(''), 2000);
      load();
    } catch (e) { setErr(e.message); }
  };

  const saveTags = async (list) => {
    setTags(list);
    await api('/settings/incident_tags', { method: 'PUT', json: { value: JSON.stringify(list) } });
  };

  const setThreshold = async (v) => {
    await api('/settings/behavior_alert_threshold', { method: 'PUT', json: { value: String(v) } });
    load();
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
            <label>{t('alertThreshold')}</label>
            <input type="number" min="1" style={{ width: 90 }} value={summary.behaviorThreshold}
              onChange={e => setSummary({ ...summary, behaviorThreshold: e.target.value })}
              onBlur={e => setThreshold(e.target.value)} />
          </div>
        </div>
      </div>

      {err && <div className="alert danger">{err}</div>}
      {msg && <div className="alert ok">{msg}</div>}

      <div className="card">
        <h2>{t('repeatScreen')}</h2>
        <p className="muted">{t('repeatHint')}</p>
        <div className="incident-list">
          {summary.rows.map(r => (
            <div key={r.student.id} className={`incident-row ${r.overThreshold ? 'alert-row' : ''}`}>
              <div className="incident-main">
                <button className="incident-name" onClick={() => setExpanded(expanded === r.student.id ? null : r.student.id)}>
                  {r.overThreshold && <span className="badge danger">⚠</span>} {r.student.name}
                </button>
                <div className="incident-counts">
                  <span className={`badge ${r.behaviorCount >= summary.behaviorThreshold ? 'danger' : r.behaviorCount ? 'warn' : 'ok'}`}>
                    {t('behavior')}: {r.behaviorCount}
                  </span>
                  <span className={`badge ${r.bookCount ? 'warn' : 'ok'}`}>{t('book')}: {r.bookCount}</span>
                </div>
              </div>
              <div className="incident-actions">
                <button className="quick behavior" onClick={() => openSheet(r.student, 'behavior')}>+ {t('behavior')}</button>
                <button className="quick book" onClick={() => openSheet(r.student, 'book')}>+ {t('book')}</button>
              </div>
              {expanded === r.student.id && (
                <div className="incident-details">
                  {r.incidents.length === 0 && <p className="muted">{t('noIncidents')}</p>}
                  {r.incidents.map(i => (
                    <div key={i.id} className="incident-item">
                      <span className={`badge ${i.kind === 'behavior' ? 'danger' : 'warn'}`}>
                        {i.kind === 'behavior' ? t('behavior') : t('book')}
                      </span>
                      <span>{i.date}{i.period ? ` — ${t('period')} ${i.period}` : ''}</span>
                      {i.tags.length > 0 && <span className="muted">{i.tags.join('، ')}</span>}
                      {i.note && <span className="muted">— {i.note}</span>}
                      <button className="linkbtn" onClick={async () => { await api(`/incidents/${i.id}`, { method: 'DELETE' }); load(); }}>
                        {t('delete')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>{t('quickTags')}</h3>
        <div className="tag-row">
          {tags.map(tg => (
            <span key={tg} className="tag-chip">
              {tg}
              <button onClick={() => saveTags(tags.filter(x => x !== tg))}>×</button>
            </span>
          ))}
        </div>
        <div className="rowflex">
          <input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder={t('newTag')} />
          <button className="ghost" onClick={() => { if (newTag.trim()) { saveTags([...tags, newTag.trim()]); setNewTag(''); } }}>
            {t('add')}
          </button>
        </div>
      </div>

      {sheet && (
        <div className="modal-backdrop" onClick={() => setSheet(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{sheet.kind === 'behavior' ? t('behaviorViolation') : t('bookMissing')}</h3>
            <p><b>{sheet.student.name}</b></p>
            <p className="muted">{t('autoDateHint')} — {new Date().toISOString().slice(0, 10)}</p>
            <div className="field">
              <label>{t('period')}</label>
              <div className="period-row">
                {[1, 2, 3, 4, 5, 6, 7].map(p => (
                  <button key={p} className={`period-btn ${String(period) === String(p) ? 'on' : ''}`}
                    onClick={() => setPeriod(p)}>{p}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>{t('tags')}</label>
              <div className="tag-row">
                {tags.map(tg => (
                  <button key={tg} className={`tag-pick ${pickedTags.includes(tg) ? 'on' : ''}`}
                    onClick={() => setPickedTags(p => p.includes(tg) ? p.filter(x => x !== tg) : [...p, tg])}>
                    {tg}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>{t('noteOptional')}</label>
              <textarea rows="2" value={note} onChange={e => setNote(e.target.value)} />
            </div>
            <div className="rowflex">
              <button className="primary" onClick={save}>{t('save')}</button>
              <button className="ghost" onClick={() => setSheet(null)}>{t('cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
