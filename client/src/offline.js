// طبقة العمل دون اتصال: كل إدخال يُحفظ في IndexedDB أولًا،
// ثم يُرسل فورًا إن توفر الخادم، أو يُصطف ويُرسَل تلقائيًا عند عودة الاتصال.
// كل عملية تحمل معرّفًا فريدًا (UUID) يمنع التكرار عند إعادة الإرسال.

const DB_NAME = 'grades-offline';
const STORE = 'queue';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'clientUuid' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out?.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
  });
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function enqueue(op) {
  await tx('readwrite', (s) => s.put(op));
  notify();
}

export async function pendingOps() {
  return tx('readonly', (s) => s.getAll());
}

export async function pendingCount() {
  const all = await pendingOps();
  return all.length;
}

async function remove(clientUuid) {
  await tx('readwrite', (s) => s.delete(clientUuid));
}

const listeners = new Set();
export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
async function notify() {
  const count = await pendingCount().catch(() => 0);
  const state = { pending: count, online: navigator.onLine, syncing };
  listeners.forEach(fn => fn(state));
}

let syncing = false;

// إرسال كل العمليات المعلّقة دفعة واحدة
export async function flush() {
  if (syncing || !navigator.onLine) return { skipped: true };
  const ops = await pendingOps();
  if (ops.length === 0) { notify(); return { synced: 0 }; }
  syncing = true;
  notify();
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations: ops }),
    });
    if (!res.ok) throw new Error('فشل المزامنة');
    const data = await res.json();
    for (const r of data.results) {
      // العمليات الفاشلة بسبب بيانات غير صالحة تُزال حتى لا تعلق الطابور للأبد
      if (r.ok || /غير موجود|غير معروف/.test(r.error || '')) await remove(r.clientUuid);
    }
    return data;
  } catch (e) {
    return { error: e.message };
  } finally {
    syncing = false;
    notify();
  }
}

// إرسال فوري مع الاصطفاف عند الفشل — تُستخدم لكل إدخال في الحصة
export async function sendOrQueue(path, body, offlineOp) {
  const op = { ...offlineOp, clientUuid: body.clientUuid };
  if (!navigator.onLine) {
    await enqueue(op);
    return { queued: true };
  }
  try {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // خطأ في البيانات (مثل درجة خارج المدى) لا يُصطف — يُبلَّغ عنه فورًا
      if (res.status >= 400 && res.status < 500) throw new Error(data?.error || 'بيانات غير صالحة');
      throw new Error(data?.error || 'خطأ في الخادم');
    }
    notify();
    return data;
  } catch (e) {
    if (/بيانات غير صالحة|بين 0 و/.test(e.message)) throw e;
    await enqueue(op);
    return { queued: true, reason: e.message };
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { notify(); flush(); });
  window.addEventListener('offline', notify);
  // محاولة مزامنة دورية للعمليات العالقة
  setInterval(() => { if (navigator.onLine) flush(); }, 30000);
  setTimeout(() => { notify(); flush(); }, 800);
}
