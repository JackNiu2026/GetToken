#!/usr/bin/env python3
"""Read-only routing inspection. Report hashes and public HTTP metadata, never secrets."""
import concurrent.futures
import hashlib
import json
import pathlib
import re
import socket
import subprocess
import tempfile

domains = ['gettoken.cc', 'www.gettoken.cc']
release = pathlib.Path('/var/www/gettoken/current')
paths = ['/', '/navigation/', '/guides/claude-code-subscription-api/', '/robots.txt', '/sitemap.xml', '/deployment.json', '/assets/gettoken/pages.css']

def files_at(root):
    result = {}
    for name in ['index.html', 'navigation/index.html', 'sitemap.xml', 'robots.txt', 'assets/gettoken/pages.css']:
        file = pathlib.Path(root) / name
        try:
            data = file.read_bytes()
            result[name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        except OSError:
            result[name] = {'missing': True}
    return result

config = subprocess.run(['nginx', '-T'], text=True, capture_output=True)
blocks = []
# A lexer balances braces while ignoring comments and quoted values.
tokens = list(re.finditer(r'#[^\n]*|"(?:\\.|[^"\\])*"|\x27(?:\\.|[^\x27\\])*\x27|[{}]|\bserver\b', config.stdout))
for i, token in enumerate(tokens[:-1]):
    if token.group() != 'server' or tokens[i + 1].group() != '{':
        continue
    depth = 0
    end = None
    for next_token in tokens[i + 1:]:
        if next_token.group() == '{': depth += 1
        elif next_token.group() == '}':
            depth -= 1
            if depth == 0:
                end = next_token.end()
                break
    if end is None: continue
    body = config.stdout[token.start():end]
    names = re.findall(r'(?m)^\s*server_name\s+([^;]+);', body)
    names = ' '.join(names).split()
    roots = re.findall(r'(?m)^\s*root\s+([^;]+);', body)
    if not (set(names).intersection(domains + ['39.97.40.89']) or any('gettoken' in root.lower() for root in roots)):
        continue
    marker = list(re.finditer(r'^# configuration file ([^:\n]+):', config.stdout[:token.start()], re.M))
    block = {'file': marker[-1].group(1) if marker else None, 'names': names,
             'listen': re.findall(r'(?m)^\s*listen\s+([^;]+);', body), 'roots': roots,
             'locations': re.findall(r'(?m)^\s*location\s+([^\n{]+)\{', body),
             'hasTLS': bool(re.search(r'\bssl_certificate\s+', body))}
    block['files'] = {root: files_at(root.strip('"\x27')) for root in roots if root.startswith('/')}
    blocks.append(block)

def request(item):
    kind, domain, path = item
    address = (('http://127.0.0.1' if kind == 'local-http' else 'https://' + domain) + path)
    with tempfile.TemporaryDirectory(prefix='gettoken-routing-') as directory:
        header, body = pathlib.Path(directory) / 'headers', pathlib.Path(directory) / 'body'
        cmd = ['curl', '--silent', '--show-error', '--max-time', '12', '--max-redirs', '0',
               '--user-agent', 'GetToken-Routing-Check/1.0', '--dump-header', str(header),
               '--output', str(body), '--write-out', '%{http_code}']
        if kind == 'local-http': cmd += ['--header', 'Host: ' + domain]
        elif kind == 'local-https': cmd += ['--resolve', domain + ':443:127.0.0.1']
        result = subprocess.run(cmd + [address], text=True, capture_output=True, timeout=16)
        row = {'kind': kind, 'domain': domain, 'path': path, 'status': int(result.stdout or '0')}
        if result.returncode:
            row['transportError'] = result.stderr[-400:]
        data = body.read_bytes() if body.exists() else b''
        text = data.decode('utf-8', errors='replace')
        row['bytes'], row['sha256'] = len(data), hashlib.sha256(data).hexdigest()
        for field, pattern in [('title', r'<title[^>]*>(.*?)</title>'), ('h1', r'<h1[^>]*>(.*?)</h1>'),
                               ('canonical', r'<link[^>]*rel=["\x27]canonical["\x27][^>]*href=["\x27]([^"\x27]+)')]:
            match = re.search(pattern, text, re.I | re.S)
            if match: row[field] = re.sub('<[^>]+>', '', match.group(1))[:220]
        if path == '/deployment.json':
            try: row['commit'] = json.loads(text).get('commit')
            except (ValueError, AttributeError): pass
        row['hasSeoLink'] = bool(re.search(r'href=["\x27](?:https://gettoken\.cc)?/navigation/', text))
        allowed = ['location', 'server', 'cache-control', 'age', 'x-cache', 'cf-cache-status', 'content-type', 'x-robots-tag']
        raw = header.read_text(errors='replace') if header.exists() else ''
        row['headers'] = {key.lower(): value.strip() for key, value in re.findall(r'^([^:\r\n]+):([^\r\n]*)', raw, re.M) if key.lower() in allowed}
        return row

requests = [(kind, domain, path) for kind in ['local-http', 'local-https', 'public-https'] for domain in domains for path in paths]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    responses = list(pool.map(request, requests))
dns = {}
for domain in domains:
    try: dns[domain] = sorted(set(info[4][0] for info in socket.getaddrinfo(domain, None)))
    except OSError as error: dns[domain] = str(error)
report = {'kind': 'read-only-routing-inspection', 'releasePath': str(release.resolve()), 'releaseFiles': files_at(release),
          'nginxConfigValid': config.returncode == 0, 'siteBlocks': blocks, 'dns': dns, 'responses': responses}
print('GETTOKEN_ROUTING_REPORT=' + json.dumps(report, ensure_ascii=False))
