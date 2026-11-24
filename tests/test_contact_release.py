import importlib.util,json,tarfile,tempfile,unittest,io
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path);obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
pack=module('contact_pack','scripts/package-contact-pages.py')
installer=module('contact_install','scripts/install-contact-pages.py')
class ContactRelease(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.dir=Path(self.temp.name);self.root=self.dir/'site';self.root.mkdir()
        for file in ['index.html','support/index.html','delivery/index.html','deployment.json']:
            path=self.root/file;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('keep '+file)
        self.before={p.relative_to(self.root):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.archive=self.dir/'release.tar.gz';pack.package(ROOT,self.archive,'a'*40)
    def assert_originals(self):
        for path,data in self.before.items():self.assertEqual((self.root/path).read_bytes(),data)
    def test_contact_only_release_preserves_existing_pages(self):
        result=installer.install(self.archive,self.root);self.assertTrue(result['existing_pages_preserved']);self.assert_originals()
        for file in pack.FILES:self.assertEqual((self.root/file).read_bytes(),(ROOT/file).read_bytes())
    def test_unexpected_archive_path_rejected_before_any_write(self):
        with tarfile.open(self.archive,'r:gz') as tar:files={m.name:tar.extractfile(m).read() for m in tar.getmembers()}
        files['../index.html']=b'bad'
        with tarfile.open(self.archive,'w:gz') as tar:
            for name,data in files.items():
                info=tarfile.TarInfo(name);info.size=len(data);tar.addfile(info,io.BytesIO(data))
        with self.assertRaises(ValueError):installer.install(self.archive,self.root)
        self.assert_originals();self.assertFalse((self.root/'assets').exists())
    def test_destination_symlink_rejected(self):
        outside=self.dir/'outside';outside.mkdir();(self.root/'assets').symlink_to(outside,target_is_directory=True)
        with self.assertRaises(ValueError):installer.install(self.archive,self.root)
        self.assert_originals();self.assertEqual(list(outside.iterdir()),[])
    def test_failed_write_rolls_back_authorized_paths(self):
        original=installer.atomic_write;calls=0
        def fail_once(path,data):
            nonlocal calls
            calls+=1
            if calls==2:raise OSError('simulated write failure')
            return original(path,data)
        with patch.object(installer,'atomic_write',fail_once):
            with self.assertRaises(OSError):installer.install(self.archive,self.root)
        self.assert_originals()
        for file in pack.FILES:self.assertFalse((self.root/file).exists())
if __name__=='__main__':unittest.main()
