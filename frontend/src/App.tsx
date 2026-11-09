import { useEffect, useRef, useState } from 'react';
import { mediaApi } from './api/media';
import type { Media } from './api/media';
import { fileSize, friendlyError, tagsFromText } from './forms';
import { MediaViewer } from './components/MediaViewer';
import { UploadForm } from './components/UploadForm';
import { LostPetForm, SearchForms } from './components/SearchForms';
import { ChatPanel } from './components/ChatPanel';
import './App.css';

type Page = 'collection' | 'upload' | 'search' | 'lost' | 'chat';
const pages: { id: Page; label: string; icon: string }[] = [
  { id: 'collection', label: 'Collection', icon: '▦' },
  { id: 'upload', label: 'Add a sighting', icon: '↑' },
  { id: 'search', label: 'Explore & search', icon: '⌕' },
  { id: 'lost', label: 'Find a lost pet', icon: '♡' },
  { id: 'chat', label: 'Ask EcoGuard', icon: '◇' },
];
const titles: Record<Page, [string, string]> = {
  collection: ['Your field journal.', 'A little closer to the wild.'],
  upload: ['Make a difference.', 'One sighting at a time.'],
  search: ['Follow your curiosity.', 'Discover what’s out there.'],
  lost: ['Let’s bring them home.', 'Together, we see more.'],
  chat: ['Follow the conversation.', 'Find a familiar face.'],
};
function message(error: unknown) { return friendlyError(error); }
function MediaCard({ item, selected, onSelect, onView, onRetry, busy, onCopy }: {
  item: Media; selected: boolean; onSelect: () => void; onView: () => void;
  onRetry: () => void; busy: boolean; onCopy: () => void;
}) {
  const previewSource = item.thumbnailDownloadUrl ?? item.thumbnailUrl;
  const [failedPreview, setFailedPreview] = useState<string>();
  const imageError = Boolean(previewSource) && failedPreview === previewSource;
  const video = item.contentType === 'video/mp4';
  return <article className={`media-card${selected ? ' selected' : ''}`}>
    <div className="card-preview">
      <label className="select-card"><input type="checkbox" aria-label={`Select ${item.filename}`} checked={selected} disabled={busy || item.canEdit === false} onChange={onSelect} /></label>
      <button className="preview-button" disabled={item.originalAvailable === false} onClick={onView} aria-label={`View ${item.filename}`}>
        {item.thumbnailUrl && !imageError ? <img src={previewSource} alt={item.filename} loading="lazy" onError={() => setFailedPreview(previewSource)} /> : <span className="preview-placeholder"><span aria-hidden="true">{video ? '▷' : '▧'}</span>{video ? 'Video sighting' : imageError ? 'Preview unavailable' : 'Preview pending'}</span>}
      </button>
      <span className="media-kind">{video ? 'VIDEO' : 'PHOTO'}</span>
    </div>
    <div className="card-body"><div className="card-meta"><span>{new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><span>{item.visibility}</span></div>
      <h3><button disabled={item.originalAvailable === false} onClick={onView} title={item.filename}>{item.filename}</button></h3>
      <div className="tag-list">{Object.entries(item.species).map(([tag, count]) => <span className="tag" key={tag}>{tag} <b>{count}</b></span>)}{item.manualTags.map(tag => <span className="tag manual" key={tag}>{tag}</span>)}</div>
      {!Object.keys(item.species).length && !item.manualTags.length && <p className="hint">{item.processingStatus === 'complete' ? 'No supported animals detected.' : 'Tags not available yet.'}</p>}
      <div className="card-bottom"><span className={`status ${item.processingStatus}`}>{item.processingStatus === 'complete' ? 'Processed' : item.processingStatus === 'failed' ? 'Processing failed' : 'Processing pending'}</span><span>{fileSize(item.size)}</span></div>
      {item.processingStatus === 'failed' && <><p className="hint processing-error">{item.processingError === 'INVALID_MEDIA' ? 'This file could not be decoded. Remove it and upload a valid image.' : 'Automatic animal detection could not finish. Retry when processing is available.'}</p>{item.canEdit !== false && item.processingError !== 'INVALID_MEDIA' && <button className="text-button" disabled={busy} onClick={onRetry}>↻ Retry processing</button>}</>}
      {item.processingStatus === 'pending' && item.canEdit !== false && <button className="text-button" disabled={busy} onClick={onRetry}>↻ Process sighting</button>}
      {item.canEdit === false && <p className="hint">Public sighting · view only</p>}
      {item.thumbnailUrl && <button className="text-button thumbnail-copy" onClick={onCopy}>Copy thumbnail URL</button>}
    </div>
  </article>;
}
export default function App({ accountName, onSignOut }: { accountName?: string; onSignOut?: () => Promise<void> } = {}) {
  const [page, setPage] = useState<Page>('collection');
  const [items, setItems] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<Media>();
  const [resultLabel, setResultLabel] = useState('');
  const [hasResults, setHasResults] = useState(false);
  const [bulkTags, setBulkTags] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteRef = useRef<HTMLDialogElement>(null);
  const requestNumber = useRef(0);
  const pollingStarted = useRef(0);
  // New requests supersede prior results, including Strict Mode's initial reload.
  async function load() {
    const request = ++requestNumber.current;
    setLoading(true); setError('');
    try {
      const result = await mediaApi.list();
      if (request !== requestNumber.current) return;
      setItems(result.media); setSelected(new Set()); setHasResults(true); setResultLabel('All sightings');
    } catch (reason) { if (request === requestNumber.current) setError(message(reason)); }
    finally { if (request === requestNumber.current) setLoading(false); }
  }
  useEffect(() => {
    const request = ++requestNumber.current;
    let active = true;
    mediaApi.list().then(result => {
      if (!active || request !== requestNumber.current) return;
      setItems(result.media); setHasResults(true); setResultLabel('All sightings');
    }).catch(reason => {
      if (active && request === requestNumber.current) setError(message(reason));
    }).finally(() => {
      if (active && request === requestNumber.current) setLoading(false);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const pending = items.some(item => item.processingStatus === 'pending');
    if (page !== 'collection' || !pending) { pollingStarted.current = 0; return; }
    if (busy || loading) return;
    if (!pollingStarted.current) pollingStarted.current = Date.now();
    if (Date.now() - pollingStarted.current > 15 * 60_000) return;
    let active = true;
    let inFlight = false;
    const request = requestNumber.current;
    const timer = window.setInterval(() => {
      if (Date.now() - pollingStarted.current > 15 * 60_000) { window.clearInterval(timer); return; }
      if (document.visibilityState !== 'visible' || inFlight) return;
      inFlight = true;
      void mediaApi.list().then(result => {
        if (active && request === requestNumber.current) setItems(result.media);
      }).catch(() => { /* Keep existing cards and the manual Refresh control on a transient failure. */ }).finally(() => { inFlight = false; });
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [page, items, busy, loading]);
  useEffect(() => { if (deleteOpen) deleteRef.current?.showModal(); }, [deleteOpen]);
  function navigate(next: Page) {
    setPage(next); setError(''); setNotice(''); setSelected(new Set());
    setHasResults(next === 'collection'); setResultLabel(next === 'collection' ? 'All sightings' : '');
    if (next === 'collection') void load();
  }
  async function search(work: () => Promise<Media[]>, label: string) {
    const request = ++requestNumber.current;
    setBusy(true); setError(''); setNotice(''); setHasResults(false); setSelected(new Set());
    try {
      const results = await work();
      if (request !== requestNumber.current) return;
      setItems(results); setResultLabel(label); setHasResults(true);
    } catch (reason) { if (request === requestNumber.current) setError(message(reason)); }
    finally { if (request === requestNumber.current) setBusy(false); }
  }
  async function view(item: Media) {
    setBusy(true); setError('');
    try {
      // Reauthorize and refresh a short-lived download capability when opening a viewer.
      const fresh = (await mediaApi.get(item.id)).media;
      if (fresh.originalAvailable === false) throw new Error('This file is awaiting validation or could not be decoded.');
      setViewer(fresh);
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }
  async function retry(item: Media) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await mediaApi.process(item.id);
      setItems(previous => previous.map(entry => entry.id === item.id ? result.media : entry));
      if (result.media.processingStatus === 'failed') setError(`${item.filename}: animal detection could not finish. The original is still saved. Please try again later.`);
      else setNotice(`${item.filename}: processing ${result.media.processingStatus}.`);
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }
  function toggle(id: string) { setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function editTags(operation: 0 | 1) {
    setError(''); setNotice('');
    try {
      const tags = tagsFromText(bulkTags);
      if (!tags.length) throw new Error('Enter one or more tags, separated by commas.');
      setBusy(true);
      const result = await mediaApi.editTags(items.filter(item => selected.has(item.id)).map(item => item.originalUrl), tags, operation);
      const updated = new Map(result.media.map(item => [item.id, item]));
      setItems(previous => previous.map(item => updated.get(item.id) ?? item));
      setNotice(`${operation === 1 ? 'Added' : 'Removed'} tags for ${result.media.length} sighting${result.media.length === 1 ? '' : 's'}.`); setBulkTags('');
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await mediaApi.delete(items.filter(item => selected.has(item.id)).map(item => item.originalUrl));
      setItems(previous => previous.filter(item => !selected.has(item.id)));
      setSelected(new Set()); setDeleteOpen(false);
      setNotice(`Deleted ${result.deleted} sighting${result.deleted === 1 ? '' : 's'}.${result.cleanupPending ? ' Storage cleanup is pending; do not assume all stored bytes have been removed yet.' : ''}`);
    } catch (reason) { setError(message(reason)); setDeleteOpen(false); }
    finally { setBusy(false); }
  }
  async function copyThumbnail(item: Media) {
    try { await navigator.clipboard.writeText(new URL(item.thumbnailUrl!, window.location.origin).href); setNotice('Thumbnail URL copied. Use it in Explore & search → A thumbnail URL.'); }
    catch { setError('The browser could not copy the URL. You can copy the thumbnail link address directly from the image.'); }
  }
  const editableItems = items.filter(item => item.canEdit !== false);
  const allSelected = editableItems.length > 0 && editableItems.length <= 100 && selected.size === editableItems.length;
  return <div className="app-shell"><a href="#main" className="skip-link">Skip to content</a>
    <aside className="sidebar"><a className="brand" href="#" onClick={event => { event.preventDefault(); if (!busy) navigate('collection'); }}><span className="brand-mark" aria-hidden="true">❋</span><span>EcoGuard<small>FRIENDS & FOES</small></span></a>
      <div className="sidebar-rule" /><div className="nav-label">YOUR OBSERVATORY</div>
      <nav aria-label="Main navigation">{pages.map(entry => <button key={entry.id} aria-current={page === entry.id ? 'page' : undefined} disabled={busy} onClick={() => navigate(entry.id)}><span aria-hidden="true">{entry.icon}</span>{entry.label}{entry.id === 'lost' && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-note"><span aria-hidden="true">↗</span><p>Small sightings.<br />A bigger picture.</p><small>For Australia’s wildlife<br />and the pets we call family.</small></div>
      <div className="sidebar-footer">AUSTRALIA · FIELD NOTES</div>
    </aside>
    <div className="main-shell"><header className="topbar"><span>AUSSIE ECOGUARD</span>{accountName ? <span className="account-controls"><span>{accountName}</span><button className="text-button" disabled={busy} onClick={() => { void onSignOut?.(); }}>Sign out</button></span> : <span className="topbar-right"><i /> FRIENDS, FOES & EVERYTHING BETWEEN</span>}</header>
      <main id="main"><div className="page-heading"><div><div className="eyebrow">THE ECOGUARD OBSERVATORY</div><h1>{titles[page][0]}<em>{titles[page][1]}</em></h1></div><span className="heading-art" aria-hidden="true">❋</span></div>
        {page === 'collection' && <div className="intro-strip"><span className="intro-icon" aria-hidden="true">⌁</span><p>A shared view of our natural world.<br /><strong>Document a sighting. Discover a species. Help a pet find home.</strong></p><button className="button primary" disabled={busy} onClick={() => navigate('upload')}>Add a sighting <span aria-hidden="true">↑</span></button></div>}
        {page === 'upload' && <UploadForm onChanged={load} onBusyChange={setBusy} />}
        {page === 'search' && <SearchForms busy={busy} search={search} />}
        {page === 'lost' && <LostPetForm busy={busy} search={search} />}
        {page === 'chat' && <ChatPanel onView={item => { void view(item); }} onBusyChange={setBusy} />}
        {error && <div className="notice error" role="alert"><strong>We couldn’t complete that.</strong><p>{error}</p>{page === 'collection' && <button className="text-button" disabled={loading || busy} onClick={() => void load()}>Try loading again</button>}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}
        {page !== 'upload' && page !== 'chat' && <section className="collection-section" aria-labelledby="collection-heading" aria-busy={loading || busy}>
          <div className="section-heading"><div><div className="eyebrow">{page === 'collection' ? 'COLLECTED MOMENTS' : 'SEARCH RESULTS'}</div><h2 id="collection-heading">{page === 'collection' ? 'Your sightings' : resultLabel || 'Matching sightings'}{hasResults && !loading && <span className="count-badge">{items.length}</span>}</h2></div>
            {page === 'collection' && <button className="button secondary" disabled={loading || busy} onClick={() => void load()}>{loading ? 'Loading…' : '↻ Refresh'}</button>}</div>
          {loading || busy && !hasResults ? <div className="empty-state" role="status"><span className="loading-ring" />{loading ? 'Loading your collection…' : 'Searching sightings…'}</div> : hasResults && items.length > 0 ? <>
            <div className="selection-row"><label><input type="checkbox" disabled={busy || !editableItems.length || editableItems.length > 100} checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(editableItems.map(item => item.id)))} />Select editable{editableItems.length > 100 ? ' (maximum 100 per batch)' : ''}</label><span>{selected.size ? `${selected.size} selected` : 'Select your sightings to edit tags or delete'}</span></div>
            {selected.size > 0 && <div className="bulk-toolbar"><label className="field">Tags for selected sightings<input value={bulkTags} disabled={busy} onChange={event => setBulkTags(event.target.value)} placeholder="e.g. ginger, collar" /></label><button className="button secondary" disabled={busy} onClick={() => void editTags(1)}>Add tags</button><button className="button secondary" disabled={busy} onClick={() => void editTags(0)}>Remove tags</button><button className="button danger" disabled={busy} onClick={() => setDeleteOpen(true)}>Delete selected</button><button className="text-button" disabled={busy} onClick={() => setSelected(new Set())}>Clear selection</button></div>}
            <div className="media-grid">{items.map(item => <MediaCard key={item.id} item={item} selected={selected.has(item.id)} busy={busy || selected.size >= 100 && !selected.has(item.id)} onSelect={() => toggle(item.id)} onView={() => { void view(item); }} onRetry={() => void retry(item)} onCopy={() => void copyThumbnail(item)} />)}</div>
          </> : <div className="empty-state"><span className="empty-symbol" aria-hidden="true">⌕</span><h3>{error ? page === 'collection' ? 'Your collection is unavailable.' : 'The search could not finish.' : !hasResults ? 'Start with a little curiosity.' : page === 'collection' ? 'Your field journal starts here.' : 'No matching sightings yet.'}</h3><p>{error ? 'Check the connection and try again.' : !hasResults ? 'Choose your search above to find matching sightings.' : page === 'collection' ? 'Add a photo or video to begin your collection.' : 'Try fewer tags, lower counts or a different date window.'}</p>{page === 'collection' && !error && <button className="button primary" onClick={() => navigate('upload')}>Add your first sighting ↑</button>}</div>}
        </section>}
        <footer className="main-footer"><span>OBSERVE. UNDERSTAND. PROTECT.</span><span>Made for a wilder, kinder Australia.</span></footer>
      </main>
    </div>
    {viewer && <MediaViewer item={viewer} onClose={() => setViewer(undefined)} />}
    {deleteOpen && <dialog ref={deleteRef} className="confirm-dialog" aria-labelledby="delete-title" onCancel={event => { if (busy) event.preventDefault(); else setDeleteOpen(false); }}><h2 id="delete-title">Delete {selected.size} sighting{selected.size === 1 ? '' : 's'}?</h2><p>The selected originals, thumbnails and records will be removed. This cannot be undone.</p><div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={() => setDeleteOpen(false)}>Keep sightings</button><button className="button danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete permanently'}</button></div></dialog>}
  </div>;
}
