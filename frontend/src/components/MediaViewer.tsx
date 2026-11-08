import { useEffect, useRef } from 'react';
import type { Media } from '../api/media';
import { fileSize } from '../forms';

export function MediaViewer({ item, onClose }: { item: Media; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); }; }, []);
  return <dialog ref={ref} className="media-dialog" aria-labelledby="viewer-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-header"><h2 id="viewer-title">{item.filename}</h2><button className="icon-button" aria-label="Close media viewer" onClick={onClose}>×</button></div>
    <div className="viewer-stage">{item.contentType === 'video/mp4'
      ? <video controls playsInline preload="metadata" src={item.originalUrl}>Your browser cannot play this video. Use the original file link below.</video>
      : <img src={item.originalUrl} alt={item.filename} />}</div>
    <div className="viewer-details"><span>{fileSize(item.size)} · {item.visibility} · {new Date(item.createdAt).toLocaleString()}</span>
      <a href={item.originalUrl} target="_blank" rel="noreferrer">Open original ↗</a></div>
    <div className="tag-list">{Object.entries(item.species).map(([tag, count]) => <span className="tag" key={tag}>{tag} <b>{count}</b></span>)}{item.manualTags.map(tag => <span className="tag manual" key={tag}>{tag}</span>)}</div>
    {item.duration !== undefined && <p className="hint">{item.duration.toFixed(1)} seconds · samples at {item.sampledAt?.join(', ')} seconds. Counts show the maximum in one sampled frame.</p>}
  </dialog>;
}
