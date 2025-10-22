import { execSync } from 'node:child_process';
import path from 'node:path';

async function globalSetup(): Promise<void> {
  const root = path.resolve(__dirname, '../..');
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
}

export default globalSetup;
