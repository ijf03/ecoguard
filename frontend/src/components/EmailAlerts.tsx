import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { mediaApi } from '../api/media';
import { friendlyError, tagsFromText } from '../forms';

export function EmailAlerts({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const [state, setState] = useState<{ enabled: boolean; pending: boolean; tags: string[] }>();
  const [tags, setTags] = useState('dog');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    mediaApi.notificationStatus().then(result => { if (active) { setState(result); if (result.tags.length) setTags(result.tags.join(', ')); } }).catch(reason => { if (active) setError(friendlyError(reason)); });
    return () => { active = false; };
  }, []);
  async function work(action: () => Promise<{ enabled: boolean; pending: boolean; tags: string[] }>, message = '') {
    setBusy(true); onBusyChange(true); setError(''); setNotice('');
    try { const result = await action(); setState(result); setNotice(message); }
    catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); onBusyChange(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const values = tagsFromText(tags);
      if (!values.length || values.length > 20) throw new Error('Choose 1–20 watched tags.');
      if (!state?.enabled && !consent) throw new Error('Confirm that you want email alerts.');
      void work(() => mediaApi.subscribe(values), 'Preferences saved. If this is your first subscription, confirm the AWS email before expecting alerts.');
    } catch (reason) { setError(friendlyError(reason)); }
  }
  return <section className="panel" aria-labelledby="alerts-heading"><div className="eyebrow">KEEP AN EYE OUT</div><h2 id="alerts-heading">A sighting worth knowing about.</h2>
    <p className="muted">Receive an email when a new or updated sighting matches any watched species or tag. You can receive your own private sightings and other members’ public sightings.</p>
    {state && <p role="status" className="notice">{!state.enabled ? 'Email alerts are off.' : state.pending ? 'Check your account email and confirm the AWS subscription, then refresh the status here.' : `Email alerts are confirmed for: ${state.tags.join(', ')}.`}</p>}
    {error && <p role="alert" className="notice error">{error}</p>}{notice && <p role="status" className="notice">{notice}</p>}
    <form onSubmit={submit}><fieldset disabled={busy}><label className="field">Watched species or tags<input required value={tags} onChange={event => setTags(event.target.value)} placeholder="dog, fox, collar" /><span className="hint">Separate tags with commas. A match on any watched tag can trigger an alert.</span></label>
      {!state?.enabled && <label className="consent-row"><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} />Send a confirmation email and matching sighting alerts to my verified account email.</label>}
      <button className="button primary" disabled={busy}>{busy ? 'Saving…' : state?.enabled ? 'Update watched tags' : 'Subscribe to email alerts'}</button>
    </fieldset></form>
    <div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={() => void work(() => mediaApi.notificationStatus())}>Refresh confirmation status</button>{state?.enabled && <button className="text-button" disabled={busy} onClick={() => void work(() => mediaApi.unsubscribe(), 'Email alerts stopped.')}>Stop email alerts</button>}</div>
    <p className="hint">Alerts normally process within a minute. AWS filter changes can take up to 15 minutes. Email may arrive more than once; opening a sighting always requires sign-in.</p>
  </section>;
}
