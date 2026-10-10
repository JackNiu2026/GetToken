#!/usr/bin/env python3
"""Add only SEO aliases to active domain vhosts; back up every touched file."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile

MARKER = '# Managed by GetToken SEO deployment.'

def server_blocks(text):
    tokens = list(re.finditer(r'#[^\n]*|"(?:\\.|[^"\\])*"|\x27(?:\\.|[^\x27\\])*\x27|[{}]|\bserver\b', text))
    for i, token in enumerate(tokens[:-1]):
        if token.group() != 'server' or tokens[i + 1].group() != '{':
            continue
        depth = 0
        for next_token in tokens[i + 1:]:
            if next_token.group() == '{': depth += 1
            elif next_token.group() == '}':
                depth -= 1
                if depth == 0:
                    yield token.start(), next_token.start(), text[token.start():next_token.end()]
                    break

def plan_updates(config_dump, root, snippet, domains):
    changes = {}
    matched = 0
    paths = dict.fromkeys(re.findall(r'^# configuration file ([^:\n]+):', config_dump, re.M))
    for name in paths:
        file = Path(name).resolve(strict=True)
        text = file.read_text(encoding='utf-8')
        insertions = []
        for start, closing, body in server_blocks(text):
            names = ' '.join(re.findall(r'(?m)^\s*server_name\s+([^;]+);', body)).split()
            if not set(names).intersection(domains):
                continue
            roots = [value.strip().strip('"\x27') for value in re.findall(r'(?m)^\s*root\s+([^;]+);', body)]
            if roots != [root]:
                raise ValueError('Refusing to modify a domain vhost with an unexpected root: ' + name)
            matched += 1
            if re.search(r'\binclude\s+["\x27]?' + re.escape(str(snippet)) + r'["\x27]?\s*;', body):
                continue
            insertions.append(closing)
        for closing in reversed(insertions):
            text = text[:closing] + '\n    # Managed GetToken SEO aliases; preserve existing TLS and homepage routes.\n    include ' + str(snippet) + ';\n' + text[closing:]
        if insertions:
            changes[file] = text.encode('utf-8')
    return changes, matched

def atomic_write(file, data, metadata=None):
    file = Path(file)
    fd, temporary = tempfile.mkstemp(prefix='.gettoken-seo-', dir=str(file.parent))
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, stat.S_IMODE(metadata.st_mode) if metadata else 0o644)
        if metadata:
            os.chown(temporary, metadata.st_uid, metadata.st_gid)
        os.replace(temporary, file)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)

def apply_updates(changes, snippet, source, state):
    snippet, state = Path(snippet), Path(state)
    if snippet.is_symlink():
        raise ValueError('Managed snippet must not be a symlink')
    if snippet.exists() and not snippet.read_text(encoding='utf-8').startswith(MARKER):
        raise ValueError('Refusing to replace an unmanaged Nginx snippet')
    data = Path(source).read_bytes()
    if not data.decode('utf-8').startswith(MARKER):
        raise ValueError('Invalid managed SEO snippet')
    updates = dict(changes)
    updates[snippet] = data
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(state, 0o700)
    if (state / 'state.json').exists():
        raise ValueError('State directory already contains a transaction')
    records = []
    metadata = {}
    for i, file in enumerate(updates):
        backup = None
        if file.exists():
            metadata[file] = file.stat()
            backup = str(state / ('backup-' + str(i)))
            shutil.copy2(file, backup)
            os.chmod(backup, 0o600)
        records.append({'path': str(file), 'backup': backup,
                        'mode': stat.S_IMODE(metadata[file].st_mode) if file in metadata else None,
                        'uid': metadata[file].st_uid if file in metadata else None,
                        'gid': metadata[file].st_gid if file in metadata else None})
    manifest = state / 'state.json'
    manifest.write_text(json.dumps(records), encoding='utf-8')
    os.chmod(manifest, 0o600)
    # Backups and the manifest exist before the first production write.
    for file, content in updates.items():
        atomic_write(file, content, metadata.get(file))

def restore_updates(state):
    manifest = Path(state) / 'state.json'
    if not manifest.exists(): return
    for record in reversed(json.loads(manifest.read_text(encoding='utf-8'))):
        file = Path(record['path'])
        if record['backup']:
            atomic_write(file, Path(record['backup']).read_bytes())
            os.chmod(file, record['mode'])
            os.chown(file, record['uid'], record['gid'])
        elif file.exists():
            file.unlink()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['apply', 'restore'])
    parser.add_argument('--state-dir', required=True)
    parser.add_argument('--root', default='/var/www/gettoken/current')
    parser.add_argument('--snippet', default='/var/www/gettoken/seo-locations.conf')
    parser.add_argument('--source')
    parser.add_argument('--domains', nargs='+', default=['gettoken.cc', 'www.gettoken.cc'])
    args = parser.parse_args()
    if args.action == 'restore':
        restore_updates(args.state_dir)
    else:
        if not args.source: parser.error('--source is required for apply')
        config = subprocess.run(['nginx', '-T'], text=True, capture_output=True)
        if config.returncode: raise RuntimeError('Existing Nginx configuration is invalid')
        changes, matched = plan_updates(config.stdout, args.root, args.snippet, args.domains)
        apply_updates(changes, args.snippet, args.source, args.state_dir)
        print('SEO alias snippet installed; matching domain server blocks: ' + str(matched))
