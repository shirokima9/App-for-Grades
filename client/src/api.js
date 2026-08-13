export async function api(path, options = {}) {
  const opts = { ...options };
  if (opts.json !== undefined) {
    opts.method = opts.method || 'POST';
    opts.headers = { 'Content-Type': 'application/json', ...opts.headers };
    opts.body = JSON.stringify(opts.json);
    delete opts.json;
  }
  const res = await fetch(`/api${path}`, opts);
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}
