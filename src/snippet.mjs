import { basename, isAbsolute } from 'node:path';

function snippetDir(outDir) {
  const value = String(outDir || 'assets').replace(/\/+$/, '') || 'assets';
  return isAbsolute(value) ? basename(value) : value;
}

function shellSafeDir(outDir) {
  return /^[A-Za-z0-9._/-]+$/.test(outDir) ? outDir : 'assets';
}

export function pictureSnippet(outDir = 'assets') {
  const cleanOutDir = snippetDir(outDir);
  return `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="${cleanOutDir}/ai-usage-dark.svg">
  <img src="${cleanOutDir}/ai-usage-light.svg" alt="AI token usage heatmap">
</picture>`;
}

export function initText(outDir = 'assets') {
  const cleanOutDir = snippetDir(outDir);
  const cronOutDir = shellSafeDir(cleanOutDir);
  return `${pictureSnippet(cleanOutDir)}

Quickstart:
1. Install Node 22 or newer.
2. Run: npx ai-usage-heatmap render --out-dir ${cleanOutDir}
3. Add the <picture> block above to your GitHub profile README.
4. Commit and push the generated SVG files on your own schedule.
5. Keep Claude Code logs by setting cleanupPeriodDays to 99999 in ~/.claude/settings.json.

Cron example:
0 8 * * * cd ~/your-profile-repo && npx ai-usage-heatmap render --out-dir ${cronOutDir} && git add ${cronOutDir}/ai-usage-*.svg README.md && git commit -m "Update AI usage heatmap" && git push`;
}
