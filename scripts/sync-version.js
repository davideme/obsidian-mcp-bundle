#!/usr/bin/env node
/**
 * Keeps manifest.json version in sync with package.json.
 * Invoked automatically by the npm "version" lifecycle hook.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));

manifest.version = pkg.version;

writeFileSync(resolve(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest.json version set to ${pkg.version}`);
