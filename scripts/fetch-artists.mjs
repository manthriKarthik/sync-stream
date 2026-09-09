import { mkdir, writeFile, access, readFile } from 'node:fs/promises';

const artists = [
  ['Ed Sheeran', 'Ed Sheeran', 'Pop / acoustic', '#ffb08d'],
  ['The Weeknd', 'The Weeknd', 'R&B / pop', '#ff667f'],
  ['Michael Jackson', 'Michael Jackson', 'Pop / soul', '#f2da78'],
  ['Anirudh Ravichander', 'Anirudh Ravichander', 'Tamil / film scores', '#81e8ed'],
  ['Taylor Swift', 'Taylor Swift', 'Pop / songwriting', '#ffb5c4'],
  ['Bruno Mars', 'Bruno Mars', 'Funk / soul', '#f9c46b'],
  ['Billie Eilish', 'Billie Eilish', 'Alternative / pop', '#cbef87'],
  ['Arijit Singh', 'Arijit Singh', 'Hindi / playback', '#b4e8ee'],
  ['A. R. Rahman', 'A. R. Rahman', 'Film scores / world', '#f0ba87'],
  ['Dua Lipa', 'Dua Lipa', 'Dance / pop', '#ff8fba'],
  ['Harry Styles', 'Harry Styles', 'Pop / rock', '#92dce8'],
  ['Shreya Ghoshal', 'Shreya Ghoshal', 'Indian / playback', '#eacf83']
];
const headers = { 'User-Agent': 'SoninArtistGallery/1.0 (local educational music app)' };
const concertPhotos = {
  'Ed Sheeran': 'Ed Sheeran in Philadelphia 08.jpg',
  'Michael Jackson': 'MJ&Friends-Munich 1999-Michael Jackson and Slash on stage.jpg',
  'Taylor Swift': 'Taylor Swift Performance (31366261870).jpg',
  'A. R. Rahman': 'A. R. Rahman at Sufi Concert in Dubai.jpg',
  'Dua Lipa': 'British singer and songwriter Dua Lipa at the SWR3 New Pop Festival 2016.jpg',
  'Shreya Ghoshal': 'Shreya Ghoshal performing at a Concert in Bangalore, Feb 2018.jpg'
};
const directory = new URL('../client/public/artists/', import.meta.url);
await mkdir(directory, { recursive: true });
const output = [];
const manifestUrl = new URL('../client/src/artists.json', import.meta.url);
const existingArtists = JSON.parse(await readFile(manifestUrl, 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '[]';
  throw error;
}));
const query = new URL('https://en.wikipedia.org/w/api.php');
query.search = new URLSearchParams({ action: 'query', titles: artists.map(artist => artist[1]).join('|'), prop: 'pageimages', format: 'json', pithumbsize: '1200', pilimit: '50' });
const response = await fetch(query, { headers, signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error(`Artist metadata: ${response.status}`);
const pages = Object.values((await response.json()).query.pages);
const metadataUrl = new URL('https://commons.wikimedia.org/w/api.php');
metadataUrl.search = new URLSearchParams({ action: 'query', titles: pages.map(page => `File:${concertPhotos[page.title] || page.pageimage}`).join('|'), prop: 'imageinfo', iiprop: 'extmetadata|url', iiurlwidth: '1400', format: 'json' });
const metadataResponse = await fetch(metadataUrl, { headers, signal: AbortSignal.timeout(20000) });
if (!metadataResponse.ok) throw new Error(`Photo metadata: ${metadataResponse.status}`);
const photos = Object.values((await metadataResponse.json()).query.pages);
for (const [name, title, genre, color] of artists) {
  const customArtist = existingArtists.find(artist => artist.name === name && artist.customImages);
  if (customArtist) {
    output.push(customArtist);
    continue;
  }
  const page = pages.find(page => page.title === title);
  if (!page.thumbnail) throw new Error(`No image for ${name}`);
  const photoName = concertPhotos[title] || page.pageimage;
  const info = photos.find(photo => photo.title.replaceAll('_', ' ') === `File:${photoName}`.replaceAll('_', ' '))?.imageinfo?.[0];
  if (!info) throw new Error(`Missing Commons attribution for ${name}`);
  const metadata = info.extmetadata;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
  const imageUrl = info.thumburl || page.thumbnail.source;
  const extension = imageUrl.endsWith('.png') ? 'png' : 'jpg';
  const filename = `${id}${title === 'Taylor Swift' ? '-performance' : concertPhotos[title] ? '-live' : ''}.${extension}`;
  try {
    await access(new URL(filename, directory));
  } catch {
    const imageResponse = await fetch(imageUrl, { headers, signal: AbortSignal.timeout(30000) });
    if (!imageResponse.ok) throw new Error(`Image download for ${name}: ${imageResponse.status}`);
    await writeFile(new URL(filename, directory), Buffer.from(await imageResponse.arrayBuffer()));
  }
  output.push({ id, name, genre, color, image: `/artists/${filename}`, source: info.descriptionurl, author: metadata.Artist?.value, license: metadata.LicenseShortName?.value, licenseUrl: metadata.LicenseUrl?.value });
  console.log(`Downloaded ${name}: ${metadata.LicenseShortName?.value}`);
}
await writeFile(new URL('../client/src/artists.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');