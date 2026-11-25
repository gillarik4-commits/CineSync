/**
 * fetch + JSON with readable errors. A non-JSON reply (e.g. an HTML 404 from an
 * out-of-date server) becomes a plain message instead of a JSON parse error.
 */
export async function api(path, { method = 'GET', body, query } = {}) {
  const url = query ? `${path}?${new URLSearchParams(query)}` : path;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error("Can't reach the CineSync server. Is it still running?");
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new Error(
      res.ok
        ? 'The server sent an unexpected response.'
        : `The server couldn't handle that request (${res.status}). Try restarting CineSync.`
    );
  }
  if (!res.ok || data?.error) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
