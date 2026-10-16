#!/usr/bin/env python3
"""Read-only routing inspection. Report hashes and public HTTP metadata, never secrets."""
import concurrent.futures
import hashlib
import json
import pathlib
import re
import socket
import sqlite3
import subprocess
import tempfile

domains = ['gettoken.cc', 'www.gettoken.cc']
release = pathlib.Path('/var/www/gettoken/current')
paths = ['/', '/claude/', '/verify/', '/api/verify/health', '/guides/', '/navigation/', '/guides/claude-code-subscription-api/', '/robots.txt', '/sitemap.xml', '/deployment.json', '/assets/guides/guides.css', '/assets/gettoken/product.css']

def files_at(root):
    result = {}
    for name in ['index.html', 'claude/index.html', 'guides/index.html', 'sitemap.xml', 'robots.txt', 'assets/guides/guides.css', 'assets/gettoken/product.css']:
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
        row['hasSeoLink'] = bool(re.search(r'href=["\x27](?:https://gettoken\.cc)?/(?:navigation|guides)/', text))
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
def host_facts():
    facts = {}
    for key, cmd in [('arch', ['uname', '-m']), ('glibc', ['ldd', '--version']), ('verifyService', ['systemctl', 'is-active', 'gettoken-verify'])]:
        try: facts[key] = subprocess.run(cmd, text=True, capture_output=True, timeout=5).stdout.splitlines()[0][:120]
        except (OSError, IndexError, subprocess.SubprocessError): facts[key] = None
    try: facts['os'] = re.search(r'^PRETTY_NAME="?([^"\n]*)', pathlib.Path('/etc/os-release').read_text(), re.M).group(1)
    except (OSError, AttributeError): facts['os'] = None
    return facts

def order_access_summary(database='/var/lib/gettoken-verify/verify.db'):
    """Aggregate counts only, read-only; never read identities, keys or codes."""
    connection = None
    try:
        address = pathlib.Path(database).resolve().as_uri() + '?mode=ro'
        connection = sqlite3.connect(address, uri=True, timeout=5)
        connection.execute('pragma query_only = on')
        total = connection.execute('select count(*) from orders').fetchone()[0]
        columns = {row[1] for row in connection.execute('pragma table_info(orders)')}
        legacy = connection.execute('select count(*) from orders where access_hash is null').fetchone()[0] if 'access_hash' in columns else total
        pending_refunds = connection.execute("select count(*) from refunds where status != 'success'").fetchone()[0]
        return {'readable': True, 'orders': total, 'legacyOrders': legacy, 'pendingRefunds': pending_refunds}
    except (OSError, sqlite3.Error) as error:
        return {'readable': False, 'errorType': type(error).__name__}
    finally:
        if connection is not None:
            connection.close()

report = {'kind': 'read-only-routing-inspection', 'host': host_facts(), 'orderAccess': order_access_summary(), 'releasePath': str(release.resolve()), 'releaseFiles': files_at(release),
          'nginxConfigValid': config.returncode == 0, 'siteBlocks': blocks, 'dns': dns, 'responses': responses}
print('GETTOKEN_ROUTING_REPORT=' + json.dumps(report, ensure_ascii=False))
