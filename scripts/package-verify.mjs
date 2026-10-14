#!/usr/bin/env node
// Packages the review API (server/verify plus the shared rules module) for scripts/server-deploy.sh.
// It is never part of the public website archive.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT } from './build-site.mjs';

const archive = resolve(process.argv[2] || 'verify-api.tar.gz');
execFileSync('tar', ['-czf', archive, 'server/verify', 'assets/gettoken/verify-rules.mjs'], { cwd: ROOT, stdio: 'inherit' });
console.log(`Packaged review API: ${archive}`);
