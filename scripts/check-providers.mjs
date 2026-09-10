import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseUrl = process.argv[2] || process.env.SONIN_CHECK_URL || 'http://localhost:3001';
const report = { baseUrl, checkedAt: new Date().toISOString(), providers: [], complete: false };
const reportPath = join(tmpdir(), 'sonin-provider-check.json');
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(`Checking music providers through ${baseUrl}`);
for (const provider of ['youtube', 'audius', 'saavn', 'soundcloud']) {
  console.log(`Checking ${provider}...`);
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/${provider}/search?q=night`, { signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    const result = { provider, status: response.status, results: data.results?.length || 0, error: data.error || null, elapsedMs: Math.round(performance.now() - started) };
    report.providers.push(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    const result = { provider, error: error.message, elapsedMs: Math.round(performance.now() - started) };
    report.providers.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile(reportPath, JSON.stringify(report, null, 2));
}
const config = await fetch(`${baseUrl}/api/platforms/config`, { signal: AbortSignal.timeout(5000) }).then(response => response.json());
report.appleConfigured = !!config.apple?.available;
report.complete = true;
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(`Provider report: ${reportPath}`);