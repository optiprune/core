import { readFile } from 'node:fs/promises';

const messageFile = process.argv[2];
if (messageFile) {
  const message = await readFile(messageFile, 'utf8');
  if (!/^(feat|fix|docs|chore)(\(.+\))?:/.test(message.trim())) {
    console.error('Commit message must use a conventional prefix.');
    process.exitCode = 1;
  }
}
