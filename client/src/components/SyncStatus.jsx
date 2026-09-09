import React, { useEffect, useState } from 'react';
import { onSyncChange, pendingCount, flush } from '../offline.js';
import { useI18n } from '../i18n.jsx';

export default function SyncStatus() {
  const { t } = useI18n();
  const [state, setState] = useState({ pending: 0, online: navigator.onLine, syncing: false });

  useEffect(() => {
    const off = onSyncChange(setState);
    pendingCount().then(p => setState(s => ({ ...s, pending: p })));
    return off;
  }, []);

  let cls = 'sync ok', label = t('synced');
  if (!state.online) { cls = 'sync off'; label = t('offlineMode'); }
  else if (state.syncing) { cls = 'sync busy'; label = t('syncing'); }
  else if (state.pending > 0) { cls = 'sync busy'; label = `${t('pendingSync')} (${state.pending})`; }

  return (
    <button className={cls} onClick={() => flush()} title={t('tapToSync')}>
      <span className="dot" />
      {label}
      {state.pending > 0 && state.online && <span className="count">{state.pending}</span>}
    </button>
  );
}
