const shouldFail = process.argv.slice(2).some(arg => arg.includes('fail'));
const shouldWaitForStdin = process.argv.includes('stdin-wait');

if (shouldWaitForStdin) {
  for await (const _ of process.stdin) {
    // Consume stdin until the parent closes it.
  }
  process.stdout.write('stdin done\n');
} else if (shouldFail) {
  process.stderr.write('boom\n');
  process.exitCode = 3;
} else {
  process.stdout.write('line one\n');
  await new Promise(resolve => setTimeout(resolve, 100));
  process.stdout.write('line two\n');
}
