import React, { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, Cell,
} from 'recharts';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';

const COLORS = {
  primary: '#0f766e',
  accent: '#b45309',
  danger: '#b91c1c',
  neutral: '#64748b',
};

function StatTile({ label, value, suffix = '', tone = '' }) {
  return (
    <div className={`stat-tile ${tone}`}>
      <div className="stat-value">{value === null || value === undefined ? '—' : value}{suffix}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export default function Analytics() {
  const { t, lang } = useI18n();
  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState('');
  const [data, setData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [tab, setTab] = useState('section');
  const [err, setErr] = useState('');
  const [progressStudent, setProgressStudent] = useState('');

  useEffect(() => {
    api('/sections').then(list => {
      setSections(list);
      const saved = localStorage.getItem('lastSection');
      setSectionId(saved && list.some(s => String(s.id) === saved) ? saved : (list[0] ? String(list[0].id) : ''));
    });
    api('/analytics/overview').then(setOverview).catch(e => setErr(e.message));
  }, []);

  useEffect(() => {
    if (!sectionId) return;
    api(`/analytics/section/${sectionId}`).then(setData).catch(e => setErr(e.message));
  }, [sectionId]);

  // تطور طالب واحد عبر عناصر التقييم المتتالية
  const progressionData = data && progressStudent
    ? data.progression.map(p => ({
        name: p.assessment,
        value: p.values.find(v => v.name === progressStudent)?.percent ?? null,
      }))
    : [];

  const axisProps = {
    tick: { fontSize: 12, fill: 'var(--muted)' },
    stroke: 'var(--border)',
  };

  return (
    <>
      <div className="card compact">
        <div className="tabs">
          <button className={tab === 'section' ? 'on' : ''} onClick={() => setTab('section')}>{t('bySection')}</button>
          <button className={tab === 'compare' ? 'on' : ''} onClick={() => setTab('compare')}>{t('compareAll')}</button>
        </div>
        {tab === 'section' && (
          <div className="field">
            <label>{t('sections')}</label>
            <select value={sectionId} onChange={e => setSectionId(e.target.value)}>
              {sections.map(s => <option key={s.id} value={s.id}>{t('grade')} {s.grade} / {s.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {err && <div className="alert danger">{err}</div>}

      {tab === 'section' && data && (
        <>
          <div className="card">
            <h3>{t('keyStats')}</h3>
            <div className="stat-grid">
              <StatTile label={t('mean')} value={data.stats.mean} suffix="%" />
              <StatTile label={t('median')} value={data.stats.median} suffix="%" />
              <StatTile label={t('stdDev')} value={data.stats.stdDev} />
              <StatTile label={t('passRate')} value={data.passRate} suffix="%" tone={data.passRate >= 70 ? 'good' : 'warn'} />
              <StatTile label={t('graded')} value={data.stats.count} />
              <StatTile label={t('strugglingCount')} value={data.struggling.length} tone={data.struggling.length ? 'bad' : 'good'} />
            </div>
          </div>

          <div className="card">
            <h3>{t('distribution')}</h3>
            <p className="muted">{t('distributionHint')}</p>
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={data.histogram} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis allowDecimals={false} {...axisProps} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
                    formatter={(v) => [v, t('studentsCount')]} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {data.histogram.map((b, i) => (
                      <Cell key={i} fill={b.to <= data.failingThreshold ? COLORS.danger : COLORS.primary} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <h3>{t('behaviorVsGrades')}</h3>
            <p className="muted">{t('behaviorVsGradesHint', )} ({data.behaviorCorrelation.threshold}+)</p>
            <div className="stat-grid">
              <StatTile label={t('withIncidents')}
                value={data.behaviorCorrelation.withRepeatedIncidents.mean} suffix="%" tone="bad" />
              <StatTile label={t('withIncidentsCount')}
                value={data.behaviorCorrelation.withRepeatedIncidents.count} />
              <StatTile label={t('withoutIncidents')}
                value={data.behaviorCorrelation.withoutRepeatedIncidents.mean} suffix="%" tone="good" />
              <StatTile label={t('withoutIncidentsCount')}
                value={data.behaviorCorrelation.withoutRepeatedIncidents.count} />
            </div>
            {data.behaviorCorrelation.withRepeatedIncidents.count === 0 && (
              <p className="muted">{t('noRepeatedIncidents')}</p>
            )}
          </div>

          <div className="card">
            <h3>{t('studentProgress')}</h3>
            <div className="field">
              <select value={progressStudent} onChange={e => setProgressStudent(e.target.value)}>
                <option value="">{t('chooseStudent')}</option>
                {data.students.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            {progressStudent && (
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <LineChart data={progressionData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" {...axisProps} />
                    <YAxis domain={[0, 100]} {...axisProps} />
                    <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }} />
                    <Line type="monotone" dataKey="value" stroke={COLORS.primary} strokeWidth={3}
                      dot={{ r: 5, fill: COLORS.primary }} connectNulls name={t('percent')} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="card">
            <h3>{t('struggling')} ({t('below')} {data.failingThreshold}%)</h3>
            {data.struggling.length === 0 && <p className="muted">{t('noneStruggling')}</p>}
            {data.struggling.length > 0 && (
              <div className="tablewrap">
                <table className="data">
                  <thead><tr><th>{t('student')}</th><th>{t('percent')}</th><th>{t('behavior')}</th></tr></thead>
                  <tbody>
                    {data.struggling.map(s => (
                      <tr key={s.id} className="row-alert">
                        <td>{s.name}</td><td>{s.percent}%</td><td>{s.behaviorCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h3>{t('topStudents')}</h3>
            <ol>{data.top.map(s => <li key={s.id}>{s.name} — <b>{s.percent}%</b></li>)}</ol>
          </div>
        </>
      )}

      {tab === 'compare' && overview && (
        <>
          <div className="card">
            <h3>{t('compareSections')}</h3>
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={overview.bySection} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis domain={[0, 100]} {...axisProps} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="mean" name={t('mean')} fill={COLORS.primary} radius={[6, 6, 0, 0]} />
                  <Bar dataKey="passRate" name={t('passRate')} fill={COLORS.accent} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="tablewrap">
              <table className="data">
                <thead>
                  <tr><th>{t('sectionName')}</th><th>{t('students')}</th><th>{t('mean')}</th>
                    <th>{t('median')}</th><th>{t('stdDev')}</th><th>{t('passRate')}</th></tr>
                </thead>
                <tbody>
                  {overview.bySection.map(s => (
                    <tr key={s.id}>
                      <td>{s.label}</td><td>{s.students}</td>
                      <td>{s.mean ?? '—'}</td><td>{s.median ?? '—'}</td>
                      <td>{s.stdDev ?? '—'}</td><td>{s.passRate ?? '—'}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3>{t('compareGrades')}</h3>
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={overview.byGrade} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="grade" {...axisProps} tickFormatter={(g) => `${t('grade')} ${g}`} />
                  <YAxis domain={[0, 100]} {...axisProps} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
                    labelFormatter={(g) => `${t('grade')} ${g}`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="mean" name={t('mean')} fill={COLORS.primary} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </>
  );
}
