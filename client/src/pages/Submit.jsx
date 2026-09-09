import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';

// التسليم: معاينة إلزامية ← تأكيد صريح ← كتابة ← تقرير تحقق.
export default function Submit() {
  const { t } = useI18n();
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sections, setSections] = useState([]);
  const [exportSection, setExportSection] = useState('');
  const [exportMsg, setExportMsg] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    api('/templates').then(list => {
      setTemplates(list);
      if (list[0]) setTemplateId(String(list[0].id));
    });
    api('/sections').then(list => {
      setSections(list);
      if (list[0]) setExportSection(String(list[0].id));
    });
  }, []);

  const loadPreview = async (id) => {
    setBusy(true); setErr(''); setResult(null); setPreview(null);
    try {
      setPreview(await api(`/submit/preview/${id}`));
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  useEffect(() => { if (templateId) loadPreview(templateId); }, [templateId]);

  const doWrite = async () => {
    setBusy(true); setErr(''); setConfirmOpen(false);
    try {
      setResult(await api(`/submit/write/${templateId}`, { json: { confirm: true } }));
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const doExport = async () => {
    setExportMsg(''); setErr('');
    try {
      const r = await api(`/submit/export/${exportSection}`, { method: 'POST' });
      setExportMsg(`${t('exportDone')}: exports/${r.fileName}`);
    } catch (e) { setErr(e.message); }
  };

  const rows = preview?.rows.filter(r => filter === 'all' || r.status === filter) || [];

  return (
    <>
      <div className="card">
        <h2>{t('myExport')}</h2>
        <p className="muted">{t('myExportHint')}</p>
        <div className="rowflex">
          <div className="field grow">
            <select value={exportSection} onChange={e => setExportSection(e.target.value)}>
              {sections.map(s => <option key={s.id} value={s.id}>{t('grade')} {s.grade} / {s.name}</option>)}
            </select>
          </div>
          <div className="field"><button className="primary" onClick={doExport}>{t('exportMine')}</button></div>
        </div>
        {exportMsg && <div className="alert ok">{exportMsg}</div>}
      </div>

      <div className="card">
        <h2>{t('submitTitle')}</h2>
        <div className="alert info">{t('submitRules')}</div>
        <div className="field">
          <label>{t('template')}</label>
          <select value={templateId} onChange={e => setTemplateId(e.target.value)}>
            {templates.map(tp => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
          </select>
          {templates.length === 0 && <p className="muted">{t('noTemplates')}</p>}
        </div>
      </div>

      {err && <div className="alert danger">{t('error')}: {err}</div>}
      {busy && <div className="alert info">{t('loading')}</div>}

      {preview && !result && (
        <div className="card">
          <h3>{t('dryRun')}</h3>
          <div className="summary-chips">
            <span className="badge ok">{t('autoConfirmed')}: {preview.summary.confirmedMatches}</span>
            <span className="badge warn">{t('manualMatches')}: {preview.summary.manualMatches}</span>
            <span className="badge danger">{t('unmatchedCount')}: {preview.summary.unmatched}</span>
            <span className="badge info">{t('cellsToWrite')}: {preview.summary.cellsToWrite}</span>
            {preview.summary.emptyGrades > 0 && <span className="badge">{t('emptyGrades')}: {preview.summary.emptyGrades}</span>}
          </div>

          {preview.blockers.length > 0 && (
            <div className="alert danger">
              <b>{t('operationHalted')}</b>
              <ul>{preview.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </div>
          )}

          <div className="tabs">
            {['all', 'ready', 'empty', 'unmatched', 'invalid'].map(f => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {t('filter_' + f)}
              </button>
            ))}
          </div>

          <div className="tablewrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>{t('myName')}</th><th>{t('ministryName')}</th>
                  <th>{t('targetCell')}</th><th>{t('value')}</th><th>{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.status === 'unmatched' || r.status === 'invalid' ? 'row-alert' : ''}>
                    <td>{r.myName}</td>
                    <td>{r.fileName || <span className="badge danger">—</span>}</td>
                    <td dir="ltr">{r.cell || '—'}</td>
                    <td>{r.value === null ? '—' : r.value}</td>
                    <td>
                      <span className={`badge ${
                        r.status === 'ready' ? 'ok' : r.status === 'empty' ? 'info' : 'danger'}`}>
                        {t('st_' + r.status)}
                      </span>
                      {r.note && <div className="muted">{r.note}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rowflex" style={{ marginTop: 14 }}>
            <button className="primary danger-btn" disabled={!preview.canWrite || busy}
              onClick={() => setConfirmOpen(true)}>
              {t('confirmWrite')}
            </button>
            <button className="ghost" onClick={() => loadPreview(templateId)}>{t('refresh')}</button>
          </div>
          {!preview.canWrite && <p className="muted">{t('cannotWriteHint')}</p>}
        </div>
      )}

      {confirmOpen && (
        <div className="modal-backdrop" onClick={() => setConfirmOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{t('finalConfirm')}</h3>
            <p>{t('finalConfirmBody', )}</p>
            <ul>
              <li>{t('cellsToWrite')}: <b>{preview.summary.cellsToWrite}</b></li>
              <li>{t('freshCopyNote')}</li>
              <li>{t('originalUntouched')}</li>
            </ul>
            <div className="rowflex">
              <button className="primary danger-btn" onClick={doWrite}>{t('yesWrite')}</button>
              <button className="ghost" onClick={() => setConfirmOpen(false)}>{t('cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="card">
          <h3>{t('verificationReport')}</h3>
          <div className={`alert ${result.verification.perfect ? 'ok' : 'danger'}`}>
            {result.verification.perfect ? `✓ ${t('perfectMatch')}` : `✗ ${t('differencesFound')}`}
          </div>
          <p><b>{t('outputFile')}:</b> <code dir="ltr">submissions/{result.file}</code></p>
          <div className="summary-chips">
            <span className="badge ok">{t('valuesOk')}: {result.verification.valuesOk}</span>
            <span className={`badge ${result.verification.valuesMismatch ? 'danger' : 'ok'}`}>
              {t('valuesMismatch')}: {result.verification.valuesMismatch}
            </span>
            <span className="badge info">{t('formulasStripped')}: {result.formulasStripped}</span>
          </div>

          <h4>{t('structuralCheck')}</h4>
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th>{t('element')}</th><th>{t('before')}</th><th>{t('after')}</th><th>{t('status')}</th></tr></thead>
              <tbody>
                {[
                  ['formulas', result.verification.structural.formulasBefore, result.verification.structural.formulasAfter, result.verification.structural.formulasOk],
                  ['validations', result.verification.structural.validationsBefore, result.verification.structural.validationsAfter, result.verification.structural.validationsOk],
                  ['protections', result.verification.structural.protectionsBefore, result.verification.structural.protectionsAfter, result.verification.structural.protectionsOk],
                  ['merged', result.verification.structural.mergedBefore, result.verification.structural.mergedAfter, result.verification.structural.mergedOk],
                  ['condFormats', result.verification.structural.condFormatsBefore, result.verification.structural.condFormatsAfter, result.verification.structural.condFormatsOk],
                ].map(([k, b, a, ok]) => (
                  <tr key={k}>
                    <td>{t('el_' + k)}</td><td>{b}</td><td>{a}</td>
                    <td><span className={`badge ${ok ? 'ok' : 'danger'}`}>{ok ? '✓' : '✗'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="alert warn" style={{ marginTop: 14 }}>
            <b>{t('manualCheckTitle')}</b>
            <ol>
              <li>{t('manualCheck1')}</li>
              <li>{t('manualCheck2')}</li>
              <li>{t('manualCheck3')}</li>
              <li>{t('manualCheck4')}</li>
            </ol>
          </div>

          {result.verification.valuesMismatch > 0 && (
            <div className="tablewrap">
              <table className="data">
                <thead><tr><th>{t('targetCell')}</th><th>{t('student')}</th><th>{t('expected')}</th><th>{t('found')}</th></tr></thead>
                <tbody>
                  {result.verification.rows.filter(r => !r.ok).map(r => (
                    <tr key={r.cell} className="row-alert">
                      <td dir="ltr">{r.cell}</td><td>{r.studentName}</td>
                      <td>{r.expected}</td><td>{String(r.found)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button className="ghost" onClick={() => { setResult(null); loadPreview(templateId); }}>{t('back')}</button>
        </div>
      )}
    </>
  );
}
