import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, AudioLines, Pause, Play } from 'lucide-react';
import artists from '../artists.json';

function ArtistShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [hidden, setHidden] = useState(document.hidden);
  const [interacting, setInteracting] = useState(false);
  const [failedImages, setFailedImages] = useState(() => new Set());
  const touchStartRef = useRef(null);
  const active = artists[activeIndex];
  const autoplay = !paused && !reducedMotion && !hidden && !interacting;

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleMotion = event => setReducedMotion(event.matches);
    const handleVisibility = () => setHidden(document.hidden);
    media.addEventListener('change', handleMotion);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      media.removeEventListener('change', handleMotion);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (!autoplay) return;
    const timer = setTimeout(() => setActiveIndex(index => (index + 1) % artists.length), 6500);
    return () => clearTimeout(timer);
  }, [activeIndex, autoplay]);

  const selectArtist = index => {
    setActiveIndex((index + artists.length) % artists.length);
    setPaused(true);
  };

  return (
    <section className="artist-showcase" aria-label="Artist spotlight" aria-roledescription="carousel" style={{ '--artist-color': active.color }}>
      <div className={`artist-stage ${autoplay ? 'is-running' : ''}`} onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)}
        onTouchStart={event => { touchStartRef.current = event.touches[0].clientX; }}
        onTouchEnd={event => {
          if (touchStartRef.current === null) return;
          const distance = touchStartRef.current - event.changedTouches[0].clientX;
          if (Math.abs(distance) > 55) selectArtist(activeIndex + (distance > 0 ? 1 : -1));
          touchStartRef.current = null;
        }}>
        <div className="artist-photos" aria-hidden="true">
          {artists.map((artist, index) => (
            <div key={artist.id} data-artist={artist.id} className={`artist-photo ${index === activeIndex ? 'is-active' : ''}`}>
              {!failedImages.has(artist.id) ? <img src={artist.image} alt="" loading={index < 2 ? 'eager' : 'lazy'} fetchPriority={index === 0 ? 'high' : 'auto'} onError={() => setFailedImages(previous => new Set([...previous, artist.id]))} /> : <div className="artist-photo-fallback"><AudioLines size={80} /></div>}
            </div>
          ))}
        </div>
        <div className="stage-shade" />
        <div className="entry-title">
          <span className="eyebrow"><span className="live-dot" /> DIFFERENT PLACES. SAME SONG.</span>
          <h1 aria-label="Sonin">sonin</h1>
          <p>For the songs that bring us together.</p>
          <a href="#room-access" className="stage-link">Find your people. Press play.<ArrowRight size={18} /></a>
        </div>
        <div className="artist-caption" aria-live={autoplay ? 'off' : 'polite'}>
          <span className="spotlight-label"><AudioLines size={16} />ARTIST SPOTLIGHT</span>
          <h2 key={active.id}>{active.name}</h2>
          <span>{active.genre}</span>
        </div>
        <div className="stage-controls" onFocus={() => setInteracting(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false); }}>
          <span className="stage-counter">{String(activeIndex + 1).padStart(2, '0')}<span> / {artists.length}</span></span>
          <button type="button" onClick={() => selectArtist(activeIndex - 1)} aria-label="Previous artist" title="Previous artist"><ArrowLeft size={18} /></button>
          <button type="button" onClick={() => setPaused(value => !value)} disabled={reducedMotion} aria-label={paused || reducedMotion ? 'Play artist slideshow' : 'Pause artist slideshow'} title={reducedMotion ? 'Slideshow paused for reduced motion' : paused ? 'Play slideshow' : 'Pause slideshow'}>{paused || reducedMotion ? <Play size={16} /> : <Pause size={16} />}</button>
          <button type="button" onClick={() => selectArtist(activeIndex + 1)} aria-label="Next artist" title="Next artist"><ArrowRight size={18} /></button>
        </div>
        <div key={`${active.id}-${autoplay}`} className={`stage-progress ${autoplay ? 'is-running' : ''}`} aria-hidden="true" />
      </div>
      <div className="artist-rail" aria-label="Choose an artist">
        {artists.map((artist, index) => <button key={artist.id} type="button" className={`artist-choice ${index === activeIndex ? 'is-active' : ''}`} aria-pressed={index === activeIndex} aria-label={`Show ${artist.name}`} title={artist.name} onClick={() => selectArtist(index)}>
          <img src={artist.profileImage || artist.image} alt="" loading="lazy" /><span>{artist.name}</span>
        </button>)}
      </div>
    </section>
  );
}

export default ArtistShowcase;