import { spawn } from 'node:child_process';

// Browser fixtures intercept this test project. No real credentials are needed.
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--port', '3017'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: 'https://tcrbcqrsafuckhsknfoy.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  },
});
server.on('exit', code => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
