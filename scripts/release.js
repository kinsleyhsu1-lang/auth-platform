#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const version = process.argv[2];
if (!version) {
  console.error('Usage: npm run release -- x.y.z');
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Version must be in x.y.z format');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const changelogPath = path.join(root, 'CHANGELOG.md');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const changelog = fs.readFileSync(changelogPath, 'utf8');
const unreleasedHeader = '## [Unreleased]';
const idx = changelog.indexOf(unreleasedHeader);
if (idx === -1) {
  console.error('CHANGELOG.md missing "## [Unreleased]" section');
  process.exit(1);
}

const afterHeader = changelog.slice(idx + unreleasedHeader.length);
const nextHeaderIdx = afterHeader.search(/\n## \[/);
const unreleasedBody = nextHeaderIdx === -1
  ? afterHeader.trim()
  : afterHeader.slice(0, nextHeaderIdx).trim();

const date = new Date().toISOString().slice(0, 10);
const newReleaseHeader = `## [${version}] - ${date}`;
const newReleaseBody = unreleasedBody.length > 0 ? unreleasedBody : '- (none)';

const before = changelog.slice(0, idx + unreleasedHeader.length);
const after = nextHeaderIdx === -1
  ? ''
  : afterHeader.slice(nextHeaderIdx);

const updated = [
  before.trimEnd(),
  '',
  '- (none)',
  '',
  newReleaseHeader,
  newReleaseBody,
  '',
  after.trimStart(),
].join('\n').replace(/\n{3,}/g, '\n\n');

fs.writeFileSync(changelogPath, updated.trimEnd() + '\n');

execSync(`git tag v${version}`, { stdio: 'inherit' });
console.log(`Release prepared for v${version}`);
