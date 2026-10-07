// Real React editor with an isolated transport; no DSH home or credentials.
import { createRoot } from 'react-dom/client';
import { ClassmatesPage } from '../../src/ui/ClassmatesPage.js';
import type { ClassmatesClient } from '../../src/contracts.js';

async function request(path: string, body?: unknown) {
  const response = await fetch(path, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
const client: ClassmatesClient = {
  load: () => request('/state'),
  save: (role, revision) => request('/role', { role, revision }),
  remove: (id, roleRevision, revision) => request('/remove-role', { id, roleRevision, revision }),
  saveModelProfile: (profile, revision) => request('/profile', { profile, revision }),
  removeModelProfile: (id, profileRevision, revision) => request('/remove-profile', { id, profileRevision, revision }),
};
const active = new URLSearchParams(location.search).get('locale') ?? 'en';
createRoot(document.getElementById('root')!).render(<ClassmatesPage client={client} locale={{
  getSnapshot: () => ({ active }), subscribe: () => () => {},
}} />);
