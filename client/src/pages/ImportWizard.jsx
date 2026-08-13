import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';

const STEPS = ['chooseFile', 'scanReport', 'mapping', 'matchStudents', 'importDone'];

function colLetterOf(n) {
  let s = '';
  while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export default function ImportWizard() {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const [sections, setSections] = useState([]);
  const [sectionId, setSectionId] = useState('');
  const [templateName, setTemplateName] = useState('');

  const [uploadInfo, setUploadInfo] = useState(null); // {uploadId, originalName, scan}
  const [sheetName, setSheetName] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [firstDataRow, setFirstDataRow] = useState(2);
  const [lastDataRow, setLastDataRow] = useState(2);
  const [nameColumn, setNameColumn] = useState('');
  const [gradeColumn, setGradeColumn] = useState('');
  const [sectionColumn, setSectionColumn] = useState('');
  const [scoreCols, setScoreCols] = useState({}); // col -> {checked, max}

  const [matchData, setMatchData] = useState(null);
  const [decisions, setDecisions] = useState({}); // row -> {action, studentId}
  const [commitResult, setCommitResult] = useState(null);
  const [manualHeader, setManualHeader] = useState('');
  const [archivedIds, setArchivedIds] = useState([]);

  // إعادة تحليل الورقة بصف ترويسة يحدده المستخدم عندما يفشل الاكتشاف التلقائي
  const reAnalyze = async () => {
    setBusy(true); setErr('');
    try {
      const { sheet: fresh } = await api('/import/analyze', {
        json: { uploadId: uploadInfo.uploadId, sheetName, headerRow: Number(manualHeader) },
      });
      setUploadInfo({
        ...uploadInfo,
        scan: { sheets: uploadInfo.scan.sheets.map(s => (s.name === fresh.name ? fresh : s)) },
      });
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const archiveStudent = async (id) => {
    setErr('');
    try {
      await api(`/students/${id}/archive`, { method: 'POST' });
      setArchivedIds([...archivedIds, id]);
    } catch (e) { setErr(e.message); }
  };

  useEffect(() => {
    api('/sections').then(list => {
      setSections(list);
      if (list.length > 0) setSectionId(String(list[0].id));
    });
  }, []);

  const sheet = useMemo(
    () => uploadInfo?.scan.sheets.find(s => s.name === sheetName),
    [uploadInfo, sheetName]
  );

  // عند اختيار ورقة: تعبئة القيم المكتشفة تلقائيًا (فقط إن كان الاكتشاف موثوقًا)
  useEffect(() => {
    if (!sheet || !sheet.headerRow) return;
    setHeaderRow(sheet.headerRow);
    setFirstDataRow(sheet.firstDataRow ?? sheet.headerRow + 1);
    setLastDataRow(sheet.lastDataRow ?? sheet.headerRow + 1);
    const nameCol = sheet.columns.find(c => c.text?.includes('اسم'))
      || sheet.columns.find(c => c.valueCells > 0 && !c.formulaCells);
    setNameColumn(nameCol ? nameCol.col : '');
    setGradeColumn(sheet.columns.find(c => c.text === 'الصف')?.col || '');
    setSectionColumn(sheet.columns.find(c => c.text?.includes('الشعبة'))?.col || '');
    // اقتراح أعمدة الدرجات: أعمدة بلا معادلات وليست أعمدة الهوية
    const suggested = {};
    for (const c of sheet.columns) {
      const isIdentity = ['م', 'اسم', 'الصف', 'الشعبة', 'الحالة'].some(k => c.text?.includes(k));
      const looksScore = c.formulaCells === 0 && !isIdentity;
      suggested[c.col] = { checked: looksScore, max: dvMaxFor(sheet, c.col) ?? 20, header: c.text };
    }
    setScoreCols(suggested);
  }, [sheet]);

  function dvMaxFor(sheetInfo, col) {
    for (const v of sheetInfo.validations) {
      if ((v.type === 'whole' || v.type === 'decimal') && v.operator === 'between'
        && rangeIncludesColumn(v.range, col)) {
        const max = Number(v.formulae?.[1]);
        if (!Number.isNaN(max)) return max;
      }
    }
    return null;
  }

  function rangeIncludesColumn(range, col) {
    for (const part of String(range).split(/\s+/)) {
      const m = part.match(/^([A-Z]+)\d+(?::([A-Z]+)\d+)?$/);
      if (!m) continue;
      const from = m[1], to = m[2] || m[1];
      if (colNum(col) >= colNum(from) && colNum(col) <= colNum(to)) return true;
    }
    return false;
  }
  function colNum(letter) {
    let n = 0;
    for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }

  const mapping = () => ({
    sheetName, headerRow: Number(headerRow),
    firstDataRow: Number(firstDataRow), lastDataRow: Number(lastDataRow),
    nameColumn, gradeColumn: gradeColumn || null, sectionColumn: sectionColumn || null,
    scoreColumns: Object.entries(scoreCols)
      .filter(([, v]) => v.checked)
      .map(([col, v]) => ({ col, header: v.header, max: Number(v.max) || 20 })),
  });

  const doUpload = async (file) => {
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const info = await api('/import/upload', { method: 'POST', body: fd });
      setUploadInfo(info);
      setSheetName(info.scan.sheets[0]?.name || '');
      if (!templateName) setTemplateName(info.originalName.replace(/\.xlsx$/i, ''));
      setStep(1);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const doMatch = async () => {
    setBusy(true); setErr('');
    try {
      const data = await api('/import/match', { json: { uploadId: uploadInfo.uploadId, mapping: mapping(), sectionId: Number(sectionId) } });
      setMatchData(data);
      // قرارات مبدئية: التام يُقبل تلقائيًا، الجديد "طالب جديد"، القريب غير محسوم
      const d = {};
      for (const r of data.results) {
        if (r.level === 'exact') d[r.row] = { action: 'match', studentId: r.candidates[0].student.id, decidedBy: 'auto-exact' };
        else if (r.level === 'none') d[r.row] = { action: 'new' };
        else d[r.row] = { action: null }; // القريب لا يُقبل تلقائيًا أبدًا
      }
      setDecisions(d);
      setStep(3);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const undecidedCount = matchData
    ? matchData.results.filter(r => !decisions[r.row]?.action).length
    : 0;

  const doCommit = async () => {
    setBusy(true); setErr('');
    try {
      const payload = matchData.results.map(r => ({
        row: r.row, name: r.name,
        action: decisions[r.row].action,
        studentId: decisions[r.row].studentId,
        decidedBy: decisions[r.row].decidedBy || 'manual',
      }));
      const res = await api('/import/commit', {
        json: { uploadId: uploadInfo.uploadId, templateName, mapping: mapping(), sectionId: Number(sectionId), decisions: payload },
      });
      setCommitResult(res);
      setStep(4);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <>
      <div className="steps">
        {STEPS.map((s, i) => (
          <span key={s} className={i === step ? 'active' : i < step ? 'done' : ''}>{i + 1}. {t(s)}</span>
        ))}
      </div>
      {err && <div className="alert danger">{t('error')}: {err}</div>}

      {step === 0 && (
        <div className="card">
          <h2>{t('importTitle')}</h2>
          <p className="alert info">{t('originalReadOnly')}</p>
          <div className="field">
            <label>{t('targetSection')}</label>
            <select value={sectionId} onChange={e => setSectionId(e.target.value)}>
              {sections.map(s => <option key={s.id} value={s.id}>{t('grade')} {s.grade} / {s.name}</option>)}
            </select>
            {sections.length === 0 && <p className="muted">{t('noSections')}</p>}
          </div>
          <div className="field">
            <label>{t('chooseFile')}</label>
            <input type="file" accept=".xlsx" disabled={busy || !sectionId}
              onChange={e => e.target.files[0] && doUpload(e.target.files[0])} />
          </div>
          {busy && <p>{t('scanning')}</p>}
        </div>
      )}

      {step === 1 && uploadInfo && (
        <div className="card">
          <h2>{t('scanReport')} — {uploadInfo.originalName}</h2>
          <div className="field">
            <label>{t('sheet')}</label>
            <select value={sheetName} onChange={e => setSheetName(e.target.value)}>
              {uploadInfo.scan.sheets.map(s => (
                <option key={s.name} value={s.name}>
                  {s.name} {s.protected ? `(${t('protected')})` : ''}
                </option>
              ))}
            </select>
          </div>
          {sheet && (
            <>
              <h3>{t('diagnostics')}</h3>
              <div className="summary-chips">
                <span className={`badge ${sheet.protected ? 'warn' : 'info'}`}>
                  {sheet.protected ? t('protected') : t('notProtected')}
                </span>
                <span className="badge info">{t('usedSize')}: {sheet.actualRowCount} × {sheet.actualColumnCount}</span>
                <span className="badge info">
                  {t('mergedCells')}: {sheet.merges.length}
                </span>
              </div>
              {sheet.merges.length > 0 && (
                <p className="muted" dir="ltr" style={{ textAlign: 'end' }}>{sheet.merges.join('  ،  ')}</p>
              )}
              <h4>{t('rawPreviewTitle')}</h4>
              <div className="tablewrap">
                <table className="data" style={{ fontSize: '0.82rem' }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      {Array.from({ length: sheet.preview.maxCol }, (_, i) => (
                        <th key={i} dir="ltr">{colLetterOf(i + 1)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.preview.rows.map(r => (
                      <tr key={r.row}>
                        <td><b>{r.row}</b></td>
                        {r.cells.map((c, i) => <td key={i}>{c}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {sheet.needsManualHeader && (
                <div className="alert warn">
                  {t('manualHeaderNeeded')}
                  <div className="rowflex" style={{ marginTop: 10 }}>
                    <input type="number" min="1" value={manualHeader}
                      onChange={e => setManualHeader(e.target.value)}
                      placeholder={t('headerRow')} style={{ width: 120 }} />
                    <button className="primary" onClick={reAnalyze} disabled={busy || !manualHeader}>
                      {t('reAnalyze')}
                    </button>
                  </div>
                </div>
              )}
              {!sheet.needsManualHeader && sheet.needsManualRange && (
                <div className="alert warn">{t('manualRangeNeeded')}</div>
              )}

              {sheet.headerRow && (
                <>
                  <h3>{t('analysis')}</h3>
                  <div className="summary-chips">
                    <span className="badge info">{t('headerRow')}: {sheet.headerRow}</span>
                    {sheet.firstDataRow && (
                      <span className="badge info">{t('dataRange')}: {sheet.firstDataRow} – {sheet.lastDataRow}</span>
                    )}
                  </div>
                </>
              )}
              <h3>{t('column')}</h3>
              <div className="tablewrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('column')}</th><th>{t('header')}</th>
                      <th>{t('values')}</th><th>{t('formulas')}</th><th>{t('empty')}</th>
                      <th>{t('sampleFormula')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.columns.map(c => (
                      <tr key={c.col}>
                        <td>{c.col}</td><td>{c.text}</td>
                        <td>{c.valueCells}</td>
                        <td>{c.formulaCells > 0 ? <span className="badge warn">{c.formulaCells}</span> : 0}</td>
                        <td>{c.emptyCells}</td>
                        <td dir="ltr" style={{ fontSize: '0.8rem' }}>{c.sampleFormula || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>{t('validations')}</h3>
              <div className="tablewrap">
                <table className="data">
                  <thead><tr><th>{t('range')}</th><th>{t('type')}</th><th>{t('allowed')}</th></tr></thead>
                  <tbody>
                    {sheet.validations.map((v, i) => (
                      <tr key={i}>
                        <td dir="ltr">{v.range}</td>
                        <td>{v.type}{v.operator ? ` (${v.operator})` : ''}</td>
                        <td dir="ltr">{(v.formulae || []).join(' … ')}</td>
                      </tr>
                    ))}
                    {sheet.validations.length === 0 && <tr><td colSpan="3">—</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="rowflex" style={{ marginTop: 12 }}>
            <button className="ghost" onClick={() => setStep(0)}>{t('back')}</button>
            <button className="primary" onClick={() => setStep(2)} disabled={!sheet?.headerRow}>{t('next')}</button>
          </div>
        </div>
      )}

      {step === 2 && sheet && (
        <div className="card">
          <h2>{t('mapping')}</h2>
          <div className="rowflex">
            <div className="field">
              <label>{t('templateName')}</label>
              <input value={templateName} onChange={e => setTemplateName(e.target.value)} />
            </div>
            <div className="field">
              <label>{t('headerRow')}</label>
              <input type="number" min="1" value={headerRow} onChange={e => setHeaderRow(e.target.value)} style={{ width: 90 }} />
            </div>
            <div className="field">
              <label>{t('dataRange')}</label>
              <span className="rowflex" style={{ alignItems: 'center' }}>
                <input type="number" min="1" value={firstDataRow} onChange={e => setFirstDataRow(e.target.value)} style={{ width: 90 }} />
                –
                <input type="number" min="1" value={lastDataRow} onChange={e => setLastDataRow(e.target.value)} style={{ width: 90 }} />
              </span>
            </div>
          </div>
          <div className="rowflex">
            {[['nameColumn', nameColumn, setNameColumn], ['gradeColumn', gradeColumn, setGradeColumn], ['sectionColumn', sectionColumn, setSectionColumn]].map(([key, val, setter]) => (
              <div className="field" key={key}>
                <label>{t(key)}</label>
                <select value={val} onChange={e => setter(e.target.value)}>
                  <option value="">—</option>
                  {sheet.columns.map(c => <option key={c.col} value={c.col}>{c.col}: {c.text}</option>)}
                </select>
              </div>
            ))}
          </div>
          <h3>{t('scoreColumns')}</h3>
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th></th><th>{t('column')}</th><th>{t('header')}</th><th>{t('maxScore')}</th><th></th></tr></thead>
              <tbody>
                {sheet.columns.map(c => (
                  <tr key={c.col}>
                    <td>
                      <input type="checkbox"
                        checked={scoreCols[c.col]?.checked || false}
                        disabled={c.formulaCells > 0}
                        onChange={e => setScoreCols({ ...scoreCols, [c.col]: { ...scoreCols[c.col], header: c.text, checked: e.target.checked } })} />
                    </td>
                    <td>{c.col}</td><td>{c.text}</td>
                    <td>
                      <input type="number" style={{ width: 80, minHeight: 36, padding: 4 }}
                        value={scoreCols[c.col]?.max ?? 20}
                        onChange={e => setScoreCols({ ...scoreCols, [c.col]: { ...scoreCols[c.col], header: c.text, max: e.target.value } })} />
                    </td>
                    <td>{c.formulaCells > 0 && <span className="badge warn">{t('formulaCol')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rowflex" style={{ marginTop: 12 }}>
            <button className="ghost" onClick={() => setStep(1)}>{t('back')}</button>
            <button className="primary" onClick={doMatch} disabled={busy || !nameColumn || !templateName.trim()}>
              {t('matchStudents')}
            </button>
          </div>
        </div>
      )}

      {step === 3 && matchData && (
        <div className="card">
          <h2>{t('matchReport')}</h2>
          <div className="summary-chips">
            <span className="badge ok">{t('exactMatches')}: {matchData.summary.exact}</span>
            <span className="badge warn">{t('closeMatches')}: {matchData.summary.close}</span>
            <span className="badge info">{t('noMatches')}: {matchData.summary.none}</span>
            <span className="badge danger">{t('missingStudents')}: {matchData.summary.missingInFile}</span>
          </div>
          {undecidedCount > 0 && <div className="alert warn">{t('commitBlocked')} ({undecidedCount})</div>}
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr><th>{t('row')}</th><th>{t('fileName')}</th><th>{t('type')}</th><th>{t('decision')}</th></tr>
              </thead>
              <tbody>
                {matchData.results.map(r => {
                  const d = decisions[r.row] || {};
                  return (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>{r.name}</td>
                      <td>
                        {r.level === 'exact' && <span className="badge ok">{t('exactMatches')}</span>}
                        {r.level === 'close' && <span className="badge warn">{t('closeMatches')}</span>}
                        {r.level === 'none' && <span className="badge info">{t('noMatches')}</span>}
                      </td>
                      <td>
                        {r.level === 'exact' && <span>{t('confirmMatch')}: {r.candidates[0].student.original_name}</span>}
                        {r.level !== 'exact' && (
                          <select
                            value={d.action === 'match' ? `match:${d.studentId}` : d.action || ''}
                            onChange={e => {
                              const v = e.target.value;
                              if (v.startsWith('match:')) {
                                setDecisions({ ...decisions, [r.row]: { action: 'match', studentId: Number(v.slice(6)) } });
                              } else {
                                setDecisions({ ...decisions, [r.row]: { action: v || null } });
                              }
                            }}>
                            <option value="">{t('undecided')}</option>
                            {r.candidates.map(c => (
                              <option key={c.student.id} value={`match:${c.student.id}`}>
                                {t('confirmMatch')}: {c.student.original_name} ({t(`reason_${c.reason}`) || c.reason || ''})
                              </option>
                            ))}
                            <option value="new">{t('newStudent')}</option>
                            <option value="skip">{t('skip')}</option>
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {matchData.missing.length > 0 && (
            <>
              <h3>{t('missingStudents')}</h3>
              <ul>{matchData.missing.map(m => <li key={m.id}>{m.original_name}</li>)}</ul>
            </>
          )}
          <div className="rowflex" style={{ marginTop: 12 }}>
            <button className="ghost" onClick={() => setStep(2)}>{t('back')}</button>
            <button className="primary" onClick={doCommit} disabled={busy || undecidedCount > 0}>
              {t('commit')}
            </button>
          </div>
        </div>
      )}

      {step === 4 && commitResult && (
        <div className="card">
          <h2>{t('importDone')} ✓</h2>
          <div className="summary-chips">
            <span className="badge ok">{t('matched')}: {commitResult.diff.matched}</span>
            <span className="badge info">{t('added')}: {commitResult.diff.added.length}</span>
            <span className="badge warn">{t('moved')}: {commitResult.diff.moved.length}</span>
            <span className="badge danger">{t('removedDiff')}: {commitResult.diff.removed.length}</span>
          </div>
          {commitResult.diff.added.length > 0 && (
            <><h3>{t('added')}</h3><ul>{commitResult.diff.added.map(n => <li key={n}>{n}</li>)}</ul></>
          )}
          {commitResult.diff.moved.length > 0 && (
            <><h3>{t('moved')}</h3><ul>{commitResult.diff.moved.map(n => <li key={n}>{n}</li>)}</ul></>
          )}
          {commitResult.diff.removed.length > 0 && (
            <>
              <h3>{t('removedDiff')}</h3>
              <p className="muted">{t('archiveNote')}</p>
              <ul>
                {commitResult.diff.removed.map(r => (
                  <li key={r.id} style={{ marginBottom: 8 }}>
                    {r.name}{' '}
                    {archivedIds.includes(r.id)
                      ? <span className="badge warn">{t('archived')} ✓</span>
                      : <button className="ghost" style={{ minHeight: 36, padding: '4px 14px' }}
                          onClick={() => archiveStudent(r.id)}>{t('archive')}</button>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <a className="btn" href="#/students" style={{ display: 'inline-block', textDecoration: 'none' }}>{t('students')}</a>
        </div>
      )}
    </>
  );
}
