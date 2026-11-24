#!/usr/bin/env python3
"""Package only the two approved contact pages and their three assets."""
import hashlib,json,re,sys,tarfile,io
from pathlib import Path
FILES=('support/hukaiyue/index.html','support/huliyun/index.html','assets/contacts/contact.css','assets/contacts/hukaiyue-wechat.png','assets/contacts/huliyun-wechat.png')
def package(root,output,revision):
    if not re.fullmatch(r'[0-9a-f]{40}',revision):raise ValueError('Expected a commit SHA')
    content={name:(root/name).read_bytes() for name in FILES}
    manifest=json.dumps({'revision':revision,'files':{name:hashlib.sha256(data).hexdigest() for name,data in content.items()}},sort_keys=True,indent=2).encode()+b'\n'
    with tarfile.open(output,'w:gz') as archive:
        for name,data in [*content.items(),('contact-release.json',manifest)]:
            info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o644;archive.addfile(info,io.BytesIO(data))
    return manifest
if __name__=='__main__':
    package(Path(__file__).resolve().parents[1],Path(sys.argv[1]),sys.argv[2])
    print('Packaged only two contact pages, three assets and release checksums.')
