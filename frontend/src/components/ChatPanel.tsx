import { useState } from 'react';
import type { FormEvent } from 'react';
import { mediaApi } from '../api/media';
import type { Media } from '../api/media';
import { friendlyError } from '../forms';

type Message = { role: 'user' | 'assistant'; text: string; media?: Media[] };
export function ChatPanel({ onView, onBusyChange }: { onView: (item: Media) => void; onBusyChange: (busy: boolean) => void }) {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', text: 'Tell me what you’re looking for. I can search animal species and counts, or look for possible public sightings of a missing pet.' }]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = text.trim(); if (!message || busy) return;
    setMessages(previous => [...previous, { role: 'user', text: message }]); setText(''); setBusy(true); onBusyChange(true);
    try {
      const result = await mediaApi.chat(message, sessionId);
      setMessages(previous => [...previous, { role: 'assistant', text: result.reply, media: result.media }]);
    } catch (error) { setMessages(previous => [...previous, { role: 'assistant', text: friendlyError(error) }]); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <section className="panel" aria-labelledby="chat-heading"><div className="eyebrow">ASK ECOGUARD</div><h2 id="chat-heading">A little help finding your sighting.</h2>
    <p className="hint">Ask naturally. Animal counts are minimums; multiple species and descriptions must all match. Lost-pet searches use public sightings only.</p>
    <div className="chat-log" role="log" aria-live="polite" aria-label="Conversation">{messages.map((message, index) => <div className={`chat-message ${message.role}`} key={index}><strong>{message.role === 'user' ? 'You' : 'EcoGuard'}</strong><p>{message.text}</p>
      {!!message.media?.length && <div className="chat-results">{message.media.map(item => <button className="chat-result" key={item.id} onClick={() => onView(item)} disabled={busy || item.originalAvailable === false}>
        {item.thumbnailDownloadUrl && <img src={item.thumbnailDownloadUrl} alt="" loading="lazy" />}<span><strong>{item.filename}</strong><small>{Object.entries(item.species).map(([name, count]) => `${name}: ${count}`).join(' · ')} · {item.visibility}</small></span><span aria-hidden="true">↗</span>
      </button>)}</div>}</div>)}</div>
    {busy && <p role="status" className="hint">Finding matching sightings…</p>}
    <div className="chat-examples"><button type="button" className="text-button" disabled={busy} onClick={() => setText('Show me dogs')}>Show me dogs</button><button type="button" className="text-button" disabled={busy} onClick={() => setText('Show two cats and one dog')}>Two cats and one dog</button><button type="button" className="text-button" disabled={busy} onClick={() => setText('Help me find my lost ginger cat')}>Find a lost ginger cat</button></div>
    <form onSubmit={submit}><label className="field">Your message<input required maxLength={512} value={text} disabled={busy} onChange={event => setText(event.target.value)} placeholder="e.g. Show me dogs spotted today" autoComplete="off" /></label><button className="button primary" disabled={busy || !text.trim()}>{busy ? 'Searching…' : 'Send message'}</button></form>
  </section>;
}
