#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT, ROUTES, generateSite } from './build-site.mjs';

await generateSite({ check: true });
const archive = resolve(process.argv[2] || 'site.tar.gz');
const directories = [...new Set(ROUTES.filter(Boolean).map(route => route.split('/')[0]))];
execFileSync('tar', ['-czf', archive, 'index.html', 'assets', ...directories, 'robots.txt', 'sitemap.xml'], { cwd: ROOT, stdio: 'inherit' });
console.log(`Packaged website: ${archive}`);
