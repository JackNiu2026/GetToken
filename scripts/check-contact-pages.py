#!/usr/bin/env python3
"""Verify only public contact pages and published asset digests."""
import hashlib,json,sys
from pathlib import Path
from urllib.request import Request,urlopen
root=Path(__file__).resolve().parents[1]
revision=sys.argv[1]
manifest=json.loads(__import__('tarfile').open(root/'contact-pages.tar.gz').extractfile('contact-release.json').read())
assert manifest['revision']==revision
for path,expected in manifest['files'].items():
    url='https://gettoken.cc/'+path.removesuffix('index.html')+'?contact_release='+revision
    with urlopen(Request(url,headers={'Cache-Control':'no-cache'}),timeout=20) as response:
        assert response.status==200,path
        content=response.read(1024*1024+1)
        assert hashlib.sha256(content).hexdigest()==expected,path
    print('Verified public contact release file:',path)
with urlopen('https://gettoken.cc/assets/contacts/release.json?contact_release='+revision,timeout=20) as response:
    assert json.load(response)==manifest
print('Verified both public routes, QR images, CSS and contact-only release revision.')
