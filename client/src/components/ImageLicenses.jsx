import { useRef } from 'react';
import { X } from 'lucide-react';
import artists from '../artists.json';

export default function ImageLicenses() {
  const dialogRef = useRef(null);
  return (
    <>
      <button type="button" className="image-license-link" onClick={() => dialogRef.current.showModal()}>Image licenses</button>
      <dialog ref={dialogRef} className="image-license-dialog" aria-labelledby="image-license-title">
        <header><h2 id="image-license-title">Image licenses</h2><button type="button" aria-label="Close image licenses" title="Close" onClick={() => dialogRef.current.close()}><X size={20} /></button></header>
        <ul>{artists.map(artist => <li key={artist.id}>
          <strong>{artist.name}</strong>
          {artist.source ? <><a href={artist.source} target="_blank" rel="noreferrer">{new DOMParser().parseFromString(artist.author || 'Wikimedia Commons', 'text/html').body.textContent}</a><a href={artist.licenseUrl || artist.source} target="_blank" rel="noreferrer">{artist.license}</a></> : <span>{artist.author}</span>}
        </li>)}</ul>
        <p>Images resized for display; thumbnails cropped. Artist imagery does not imply endorsement.</p>
      </dialog>
    </>
  );
}