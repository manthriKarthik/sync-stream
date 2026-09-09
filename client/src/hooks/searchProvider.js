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