#!/usr/bin/env python3
"""Apply an allowlisted contact-only release without exporting existing files."""
import hashlib,json,os,re,sys,tarfile,tempfile
from pathlib import Path
FILES=('support/hukaiyue/index.html','support/huliyun/index.html','assets/contacts/contact.css','assets/contacts/hukaiyue-wechat.png','assets/contacts/huliyun-wechat.png')
GUARDS=('index.html','support/index.html','delivery/index.html','deployment.json','robots.txt','sitemap.xml')
MANIFEST='assets/contacts/release.json'
def digest(data):return hashlib.sha256(data).hexdigest()
def target(root,name):
    file=root/name
    if file.is_symlink() or not file.resolve().is_relative_to(root):raise ValueError('Unsafe destination')
    return file

def atomic_write(file,data):
    file.parent.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(prefix='.contact-',dir=file.parent)
    try:
        with os.fdopen(fd,'wb') as stream:
            stream.write(data);stream.flush();os.fsync(stream.fileno());os.fchmod(stream.fileno(),0o644)
        os.replace(temp,file)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def install(archive_path,root):
    root=root.resolve(strict=True)
    for required in ['index.html','support/index.html']:
        if not target(root,required).is_file():raise ValueError('Existing public home/support page is required')
    before={name:digest(target(root,name).read_bytes()) if target(root,name).is_file() else None for name in GUARDS}
    if archive_path.stat().st_size>2*1024*1024:raise ValueError('Archive is too large')
    with tarfile.open(archive_path,'r:gz') as archive:
        members=archive.getmembers();names=[m.name for m in members]
        if set(names)!=set(FILES)|{'contact-release.json'} or len(names)!=len(FILES)+1:raise ValueError('Unexpected release paths')
        if any(not m.isfile() or m.size>1024*1024 for m in members):raise ValueError('Unexpected release entry')
        content={m.name:archive.extractfile(m).read() for m in members}
    manifest=json.loads(content.pop('contact-release.json'))
    if set(manifest)!= {'revision','files'} or not re.fullmatch(r'[0-9a-f]{40}',manifest['revision']):raise ValueError('Invalid release manifest')
    if manifest['files']!={name:digest(content[name]) for name in FILES}:raise ValueError('Release checksum mismatch')
    content[MANIFEST]=json.dumps(manifest,sort_keys=True,indent=2).encode()+b'\n'
    paths={name:target(root,name) for name in content}
    backup={name:path.read_bytes() if path.is_file() else None for name,path in paths.items()}
    changed=[]
    try:
        for name,data in content.items():
            changed.append(name);atomic_write(paths[name],data)
        for name,data in content.items():
            if digest(paths[name].read_bytes())!=digest(data):raise RuntimeError('Installed checksum mismatch')
        after={name:digest(target(root,name).read_bytes()) if target(root,name).is_file() else None for name in GUARDS}
        if before!=after:raise RuntimeError('An existing public page changed during release')
    except BaseException:
        for name in reversed(changed):
            if backup[name] is None:paths[name].unlink(missing_ok=True)
            else:atomic_write(paths[name],backup[name])
        raise
    return {'revision':manifest['revision'],'published_pages':2,'existing_pages_preserved':True}
if __name__=='__main__':
    print(json.dumps(install(Path(sys.argv[1]),Path('/var/www/gettoken/current'))))
