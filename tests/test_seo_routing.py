import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('seo_routing', ROOT / 'scripts/configure-seo-routing.py')
routing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routing)

class RoutingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = self.root / 'domain.conf'
        self.original = '''# Keep this site's existing content and TLS configuration.
server {
    listen 443 ssl;
    server_name gettoken.cc www.gettoken.cc;
    ssl_certificate /existing/certificate.pem;
    ssl_certificate_key /existing/key.pem;
    root /var/www/gettoken/current;
    location / { try_files $uri $uri/ =404; }
    location = /existing { return 200 "a quoted } brace"; }
}
server {
    listen 443 ssl;
    server_name other.example;
    root /other/site;
}
'''
        self.config.write_text(self.original)
        self.config.chmod(0o640)
        self.snippet = self.root / 'seo-locations.conf'
        self.dump = '# configuration file ' + str(self.config) + ':\n' + self.original

    def plan(self):
        return routing.plan_updates(self.dump, '/var/www/gettoken/current', self.snippet, ['gettoken.cc', 'www.gettoken.cc'])

    def test_only_active_domain_block_changes_and_remains_idempotent(self):
        changes, matched = self.plan()
        self.assertEqual(matched, 1)
        insertion = '\n    # Managed GetToken SEO aliases; preserve existing TLS and homepage routes.\n    include ' + str(self.snippet) + ';\n'
        updated = changes[self.config].decode()
        self.assertEqual(updated.replace(insertion, ''), self.original)
        self.config.write_text(updated)
        self.assertEqual(self.plan(), ({}, 1))

    def test_unexpected_domain_root_is_rejected_without_writes(self):
        content = self.original.replace('/var/www/gettoken/current', '/another/site')
        self.config.write_text(content)
        with self.assertRaisesRegex(ValueError, 'unexpected root'):
            self.plan()
        self.assertEqual(self.config.read_text(), content)
        self.assertFalse(self.snippet.exists())

    def test_transaction_restores_original_config_and_removes_new_snippet(self):
        changes, _ = self.plan()
        state = self.root / 'backup'
        routing.apply_updates(changes, self.snippet, ROOT / 'scripts/nginx-seo-locations.conf', state)
        self.assertTrue(self.snippet.exists())
        self.assertEqual(self.config.stat().st_mode & 0o777, 0o640)
        self.assertEqual(state.stat().st_mode & 0o777, 0o700)
        self.assertEqual((state / 'state.json').stat().st_mode & 0o777, 0o600)
        routing.restore_updates(state)
        self.assertEqual(self.config.read_text(), self.original)
        self.assertEqual(self.config.stat().st_mode & 0o777, 0o640)
        self.assertFalse(self.snippet.exists())

    def test_existing_managed_snippet_restores_exact_bytes(self):
        old = b'# Managed by GetToken SEO deployment.\n# previous version\n'
        self.snippet.write_bytes(old)
        state = self.root / 'backup'
        routing.apply_updates({}, self.snippet, ROOT / 'scripts/nginx-seo-locations.conf', state)
        routing.restore_updates(state)
        self.assertEqual(self.snippet.read_bytes(), old)

    def test_unmanaged_snippet_is_preserved(self):
        self.snippet.write_text('# owned by an existing application\n')
        with self.assertRaisesRegex(ValueError, 'unmanaged'):
            routing.apply_updates({}, self.snippet, ROOT / 'scripts/nginx-seo-locations.conf', self.root / 'backup')
        self.assertEqual(self.snippet.read_text(), '# owned by an existing application\n')
        self.assertEqual(self.config.read_text(), self.original)

if __name__ == '__main__':
    unittest.main()
