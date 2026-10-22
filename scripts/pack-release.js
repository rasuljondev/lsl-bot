import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
process.chdir(root);
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const files = ['package.json', 'package-lock.json', 'ecosystem.config.cjs', '.env.example', 'README.md',
    'STUDENT_ATTENDANCE.md', 'DEPLOYMENT.md', 'roster.example.json'];
async function collect(directory) {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
        const file = `${directory}/${item.name}`;
        if (item.isDirectory()) await collect(file);
        else if (item.isFile()) files.push(file);
    }
}
for (const dir of ['src', 'sql', 'scripts', 'test']) await collect(dir);
files.sort();
await fs.mkdir('dist', { recursive: true });
const name = `lsl-bot-${pkg.version}`;
const listFile = `dist/${name}.files.txt`;
await fs.writeFile(listFile, files.join('\n') + '\n');
const archive = `dist/${name}.tar.gz`;
const packed = spawnSync('tar', ['-czf', archive, '-T', listFile], { encoding: 'utf8' });
if (packed.status !== 0) throw new Error(packed.stderr || 'tar failed');
const hashes = {};
for (const file of files) hashes[file] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
const manifest = { version: pkg.version, builtAt: new Date().toISOString(), archive,
    sha256: createHash('sha256').update(await fs.readFile(archive)).digest('hex'), files: hashes };
await fs.writeFile(`dist/${name}.manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Created ${archive} (${files.length} files)`);
console.log(`SHA256 ${manifest.sha256}`);
console.log('No credentials, real rosters, .git, or node_modules are packaged.');
