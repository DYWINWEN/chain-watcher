// Thin wrapper around fetch — adds JSON parsing + error toast on non-2xx.
import { toast } from './ui/toast.js';

export async function apiGet(path) {
  const r = await fetch(path);
  if (!r.ok) {
    toast({ kind: 'error', message: `GET ${path} → ${r.status}` });
    throw new Error(`${r.status}`);
  }
  return r.json();
}

export async function apiPatch(path, body) {
  const r = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    toast({ kind: 'error', message: `PATCH ${path} → ${r.status}` });
    throw new Error(`${r.status}`);
  }
  return r.json();
}

export async function apiPost(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    toast({ kind: 'error', message: `POST ${path} → ${r.status}` });
    throw new Error(`${r.status}`);
  }
  return r.json();
}

export async function apiDelete(path) {
  const r = await fetch(path, { method: 'DELETE' });
  if (!r.ok) {
    toast({ kind: 'error', message: `DELETE ${path} → ${r.status}` });
    throw new Error(`${r.status}`);
  }
  return r.json();
}
