for (const name of ['Ed Sheeran', 'The Weeknd', 'Michael Jackson', 'Anirudh Ravichander', 'Taylor Swift', 'A. R. Rahman', 'Dua Lipa', 'Shreya Ghoshal']) {
  const params = new URLSearchParams({ action: 'query', format: 'json', list: 'search', srsearch: `${name} concert`, srnamespace: '6', srlimit: '4' });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${response.status}: ${name}`);
  const data = await response.json();
  console.log(name, JSON.stringify(data.query?.search?.map(item => item.title)));
}