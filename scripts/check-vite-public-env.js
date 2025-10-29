#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const baseRefEnv = process.env.GITHUB_BASE_REF || process.env.BASE_REF || 'main';
const remoteRef = `origin/${baseRefEnv}`;

try {
  execSync(`git fetch origin ${baseRefEnv} --depth=1`, { stdio: 'ignore' });
} catch (error) {
  console.warn(`Warning: unable to fetch ${remoteRef}. Using local reference if available.`);
}

let diffBase = remoteRef;
const refExists = (ref) => {
  try {
    execSync(`git rev-parse --verify ${ref}^{commit}`, { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
};

if (!refExists(diffBase)) {
  if (refExists(baseRefEnv)) {
    diffBase = baseRefEnv;
    console.warn(`Falling back to local reference ${diffBase} for diff.`);
  } else {
    console.warn('No base reference available for VITE_ audit; skipping check.');
    process.exit(0);
  }
}

let diffOutput = '';
try {
  diffOutput = execSync(`git diff --unified=0 ${diffBase}...HEAD`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (error) {
  console.error('Failed to compute git diff for VITE_ variable audit.');
  if (error.stderr) {
    process.stderr.write(error.stderr);
  }
  process.exit(1);
}

const addedLines = diffOutput
  .split('\n')
  .filter((line) => line.startsWith('+') && !line.startsWith('+++'));

const vitePattern = /VITE_[A-Z0-9_]+/g;
const discovered = new Set();
for (const line of addedLines) {
  const matches = line.match(vitePattern);
  if (!matches) continue;
  for (const match of matches) {
    discovered.add(match);
  }
}

if (discovered.size === 0) {
  console.log('No newly added VITE_ variables detected in this diff.');
  process.exit(0);
}

const whitelistPath = path.resolve(__dirname, '..', 'docs', 'security', 'vite-public-env-whitelist.json');
let whitelistRaw = '';
try {
  whitelistRaw = fs.readFileSync(whitelistPath, 'utf8');
} catch (error) {
  console.error(`Unable to read white list at ${whitelistPath}.`);
  process.exit(1);
}

let whitelistEntries;
try {
  whitelistEntries = JSON.parse(whitelistRaw);
} catch (error) {
  console.error('Whitelist file is not valid JSON.');
  process.exit(1);
}

const approvedNames = new Set();
for (const entry of whitelistEntries) {
  if (!entry || typeof entry !== 'object') continue;
  if (typeof entry.name !== 'string' || entry.name.trim() === '') {
    console.error('Each white list entry must include a non-empty "name" property.');
    process.exit(1);
  }
  if (!entry.description || !entry.approved_by || !entry.approved_on) {
    console.error(`Whitelist entry for ${entry.name} is missing required metadata (description, approved_by, approved_on).`);
    process.exit(1);
  }
  approvedNames.add(entry.name);
}

const unauthorized = Array.from(discovered).filter((name) => !approvedNames.has(name));

if (unauthorized.length === 0) {
  console.log('All VITE_ variables added in this diff are present in the approved white list.');
  process.exit(0);
}

console.error('The following VITE_ variables were introduced without approval:');
for (const name of unauthorized) {
  console.error(`  - ${name}`);
}
console.error(
  'Coordinate with the backend team to keep sensitive secrets server-side, complete the security review, and document the variable in docs/security/vite-public-env-whitelist.json before merging.'
);
process.exit(1);
