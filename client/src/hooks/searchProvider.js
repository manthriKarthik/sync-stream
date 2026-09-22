export async function searchProvider(provider, query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api/${provider}/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`${provider} search is unavailable`);
    const data = await response.json();
    if (data.error || !Array.isArray(data.results)) throw new Error(`${provider} returned invalid search results`);
    return data.results;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchSuggestions(query, signal, provider) {
  if (!query || !query.trim()) return [];
  const providerParam = provider ? `&provider=${encodeURIComponent(provider)}` : '';
  const response = await fetch(`/api/suggest?q=${encodeURIComponent(query)}${providerParam}`, { signal });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data.suggestions) ? data.suggestions : [];
}