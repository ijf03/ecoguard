import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { mediaApi } from '../api/media';
import { fileSize, friendlyError, validateFile } from '../forms';

type UploadResult = { filename: string; state: 'uploaded' | 'duplicate' | 'failed' | 'processing failed'; message: string };
export function UploadForm({ onChanged, onBusyChange }: { onChanged: () => Promise<void>; onBusyChange: (busy: boolean) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState('');
  const [results, setResults] = useState<UploadResult[]>([]);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!files.length) { setError('Select at least one file.'); return; }
    try { for (const file of files) validateFile(file); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Check the selected files.'); return; }
    setBusy(true); onBusyChange(true); setResults([]);
    for (const file of files) {
      setCurrent(file.name);
      try {
        const result = await mediaApi.upload(file, visibility);
        const failed = result.media.processingStatus === 'failed';
        setResults(previous => [...previous, { filename: file.name, state: result.duplicate ? 'duplicate' : failed ? 'processing failed' : 'uploaded',
          message: result.duplicate ? 'Already in your collection; no new copy was stored.' : failed ? 'Original saved, but automatic processing failed. Use Retry in the collection.' : result.media.processingStatus === 'pending' ? 'Original saved; processing is pending.' : 'Saved and processed successfully.' }]);
      } catch (reason) {
        setResults(previous => [...previous, { filename: file.name, state: 'failed', message: friendlyError(reason) }]);
      }
    }
    setCurrent(''); setFiles([]); if (input.current) input.current.value = '';
    await onChanged(); setBusy(false); onBusyChange(false);
  }
  return <section className="panel upload-panel" aria-labelledby="upload-heading">
    <div className="eyebrow">CONTRIBUTE A SIGHTING</div><h2 id="upload-heading">Every sighting tells a story.</h2>
    <p className="muted">Add wildlife photos or short videos. We’ll identify animals and organise the results for you.</p>
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <label className="file-drop">Choose photos or videos
          <span>JPEG, PNG, WebP up to 10 MiB · MP4/H.264 up to 50 MiB and 120 seconds</span>
          <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4" onChange={event => { setFiles(Array.from(event.target.files ?? [])); setError(''); setResults([]); }} />
        </label>
        {files.length > 0 && <ul className="chosen-files">{files.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}</span><span>{fileSize(file.size)}</span></li>)}</ul>}
        <label className="field">Who can find this sighting?<select value={visibility} onChange={event => setVisibility(event.target.value as 'private' | 'public')}><option value="private">Private collection</option><option value="public">Public sighting</option></select></label>
        <p className="hint">Public sightings can appear in other members’ lost-pet searches. Choose private for personal media.</p>
        <button className="button primary" type="submit" disabled={!files.length}>{busy ? 'Uploading and processing…' : `Upload ${files.length > 1 ? `${files.length} files` : 'sighting'}`}<span aria-hidden="true">↑</span></button>
      </fieldset>
    </form>
    {error && <p role="alert" className="notice error">{error}</p>}
    {busy && <p role="status" className="notice">Uploading and processing {current}. Please keep this page open.</p>}
    {results.length > 0 && <ul className="upload-results" aria-live="polite">{results.map((result, index) => <li key={index} className={result.state.includes('failed') ? 'result-error' : ''}><strong>{result.filename}</strong><span className="status">{result.state}</span><p>{result.message}</p></li>)}</ul>}
  </section>;
}
