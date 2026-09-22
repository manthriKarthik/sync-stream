import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { fetchSuggestions } from '../hooks/searchProvider';

// YouTube-style search input with a live autocomplete suggestions dropdown.
function SearchBar({ value, onChange, onSubmit, placeholder, searching, provider }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  // Debounced suggestion fetch as the user types.
  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const results = await fetchSuggestions(q, controller.signal, provider);
        setSuggestions(results);
        setActiveIndex(-1);
      } catch {
        /* aborted or failed — ignore */
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [value, provider]);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    const handleClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const pickSuggestion = useCallback((text) => {
    onChange(text);
    setOpen(false);
    setActiveIndex(-1);
    onSubmit(text);
  }, [onChange, onSubmit]);

  const handleKeyDown = (e) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      pickSuggestion(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setOpen(false);
    onSubmit(value);
  };

  const handleClear = () => {
    onChange('');
    setSuggestions([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const showDropdown = open && suggestions.length > 0;

  return (
    <div ref={wrapRef} className={`search-bar ${showDropdown ? 'is-open' : ''}`}>
      <form onSubmit={handleSubmit} className="search-bar-form">
        <div className="search-bar-field">
          <Search size={17} className="search-bar-leading-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            className="search-bar-input"
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(e) => { onChange(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls="search-suggestions"
          />
          {value && (
            <button
              type="button"
              className="search-bar-clear"
              onClick={handleClear}
              aria-label="Clear search"
              title="Clear"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <button className="search-bar-submit" type="submit" disabled={searching} aria-label="Search">
          {searching ? <Loader2 size={17} className="search-spin" /> : <Search size={17} />}
        </button>
      </form>

      {showDropdown && (
        <ul id="search-suggestions" className="search-suggestions" role="listbox">
          {suggestions.map((text, i) => (
            <li
              key={text}
              role="option"
              aria-selected={i === activeIndex}
              className={`search-suggestion ${i === activeIndex ? 'active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pickSuggestion(text); }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <Search size={15} className="search-suggestion-icon" />
              <span className="search-suggestion-text">{text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default SearchBar;
