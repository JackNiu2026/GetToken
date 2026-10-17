// Provision an initial operator only when no admin password exists. The random
// password is written to a private server file, never stdout, arguments or logs.
import { openSync, writeFileSync, fsyncSync, closeSync, unlinkSync, constants } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hashPassword, token } from './secure.mjs';
import { loadConfig } from './config.mjs';
import { openStore } from './store.mjs';

export function ensureInitialOperator({ store, passwordFile }) {
  return store.transaction(() => {
    if (store.setting('admin_password')) return { created: false };
    const password = token();
    // Refuse existing paths, including symlinks. Never overwrite a credential.
    const fd = openSync(passwordFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      writeFileSync(fd, password + '\n');
      fsyncSync(fd);
      store.setSetting('admin_password', hashPassword(password));
    } catch (error) {
      unlinkSync(passwordFile);
      throw error;
    } finally { closeSync(fd); }
    return { created: true };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const store = openStore(join(config.dataDir, 'verify.db'));
  try {
    if (config.externalIntake && config.acceptExternalOrders) {
      const result = ensureInitialOperator({ store, passwordFile: '/etc/gettoken/verify-admin.initial-password' });
      console.log(result.created
        ? 'Initial review operator provisioned. Password is in /etc/gettoken/verify-admin.initial-password (root-only); retrieve privately and change it. No credential is printed.'
        : 'Existing review operator preserved.');
    }
  } finally { store.close(); }
}
