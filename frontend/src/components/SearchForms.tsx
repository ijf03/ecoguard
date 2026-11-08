import { useState } from 'react';
import type { FormEvent } from 'react';
import { mediaApi } from '../api/media';
import type { Media } from '../api/media';
import { countFilters, queryDates, tagsFromText, validateFile } from '../forms';

type Search = (work: () => Promise<Media[]>, label: string) => Promise<void>;
export function SearchForms({ busy, search }: { busy: boolean; search: Search }) {
  const [mode, setMode] = useState('tags');
  const [rows, setRows] = useState([{ tag: '', count: '1' }]);
  const [image, setImage] = useState<File>();
  const [url, setUrl] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search(async () => {
      if (mode === 'tags') return (await mediaApi.search(countFilters(rows))).media;
      if (mode === 'thumbnail') {
        if (!url.trim()) throw new Error('Paste a thumbnail URL from your collection.');
        let path = url.trim();
        if (path.startsWith('http://') || path.startsWith('https://')) {
          const parsed = new URL(path);
          if (parsed.origin !== window.location.origin) throw new Error('Use a thumbnail URL from this application.');
          path = parsed.pathname;
        }
        return [(await mediaApi.fromThumbnail(path)).media];
      }
      if (!image) throw new Error('Choose an image to search with.');
      validateFile(image, true);
      return (await mediaApi.searchImage(image)).media;
    }, mode === 'tags' ? 'Tag search' : mode === 'thumbnail' ? 'Thumbnail lookup' : 'Image search');
  }
  return <section className="panel" aria-labelledby="search-heading"><div className="eyebrow">EXPLORE THE COLLECTION</div><h2 id="search-heading">Find your next discovery.</h2>
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label className="field">Search by<select value={mode} onChange={event => setMode(event.target.value)}><option value="tags">Species, tags and counts</option><option value="image">An example image</option><option value="thumbnail">A thumbnail URL</option></select></label>
      {mode === 'tags' && <><p className="hint">Results must match every filter. Manual tags count as one occurrence.</p>
        <div className="filter-list">{rows.map((row, index) => <div className="filter-row" key={index}>
          <label className="field">Species or tag<input required maxLength={80} placeholder="e.g. cat" value={row.tag} onChange={event => setRows(rows.map((entry, i) => i === index ? { ...entry, tag: event.target.value } : entry))} /></label>
          <label className="field">At least<input required type="number" min="1" step="1" value={row.count} onChange={event => setRows(rows.map((entry, i) => i === index ? { ...entry, count: event.target.value } : entry))} /></label>
          <button className="icon-button remove-filter" type="button" disabled={rows.length === 1} aria-label={`Remove filter ${index + 1}`} onClick={() => setRows(rows.filter((_, i) => i !== index))}>×</button>
        </div>)}</div>
        <button className="text-button" type="button" disabled={rows.length >= 32} onClick={() => setRows([...rows, { tag: '', count: '1' }])}>+ Add another filter</button></>}
      {mode === 'image' && <label className="field">Example image<input required type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setImage(event.target.files?.[0])} /><span className="hint">We match all detected species. This query image is not added to your collection or permanently stored.</span></label>}
      {mode === 'thumbnail' && <label className="field">Thumbnail URL<input required value={url} onChange={event => setUrl(event.target.value)} placeholder="/api/media/…/thumbnail" /><span className="hint">Use “Copy thumbnail URL” on a collection card to resolve its original.</span></label>}
      <button className="button primary" type="submit">{busy ? 'Searching…' : 'Find sightings'}<span aria-hidden="true">↗</span></button>
    </fieldset></form>
  </section>;
}
export function LostPetForm({ busy, search }: { busy: boolean; search: Search }) {
  const [species, setSpecies] = useState('cat');
  const [tags, setTags] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [image, setImage] = useState<File>();
  const [mode, setMode] = useState('description');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search(async () => {
      const dates = queryDates(since, until);
      const descriptions = tagsFromText(tags);
      if (mode === 'image') {
        if (!image) throw new Error('Choose a photo of your missing pet.');
        validateFile(image, true);
        return (await mediaApi.lostPetImage(image, { ...dates, tags: descriptions })).media;
      }
      if (!species.trim()) throw new Error('Enter the pet species.');
      return (await mediaApi.lostPet(species, descriptions, dates.since, dates.until)).media;
    }, 'Lost-pet sightings');
  }
  return <section className="panel lost-panel" aria-labelledby="lost-heading"><div className="eyebrow">BRING THEM HOME</div><h2 id="lost-heading">A familiar face, somewhere nearby.</h2><p className="muted">Search recent public sightings using a photo or a description of your pet.</p>
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label className="field">Search using<select value={mode} onChange={event => setMode(event.target.value)}><option value="description">A description</option><option value="image">A pet photo</option></select></label>
      {mode === 'description' ? <label className="field">Species<input required maxLength={80} value={species} onChange={event => setSpecies(event.target.value)} placeholder="e.g. dog" /></label>
        : <label className="field">Pet photo<input required type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setImage(event.target.files?.[0])} /><span className="hint">The photo is used for this search only. Matches are possible sightings, not identity confirmations.</span></label>}
      <label className="field">Descriptive tags <span className="optional">optional</span><input value={tags} onChange={event => setTags(event.target.value)} placeholder="ginger, collar, tabby" /><span className="hint">Separate tags with commas. All must match tags added to the sighting; breed and colour are not automatically inferred.</span></label>
      <div className="date-fields"><label className="field">From <span className="optional">optional</span><input type="datetime-local" value={since} onChange={event => setSince(event.target.value)} /></label><label className="field">Until <span className="optional">optional</span><input type="datetime-local" value={until} onChange={event => setUntil(event.target.value)} /></label></div>
      <p className="hint">Only public sightings are searched. Leave dates blank for the last 30 days through now. Dates use your local time.</p>
      <button className="button primary" type="submit">{busy ? 'Searching…' : 'Search public sightings'}<span aria-hidden="true">↗</span></button>
    </fieldset></form>
  </section>;
}
