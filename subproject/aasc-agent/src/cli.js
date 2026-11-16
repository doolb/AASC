import { createInterface } from 'node:readline/promises';
import { parseCommand } from './command.js';

const input = createInterface({ input: process.stdin, output: process.stdout });
try {
  const line = await input.question('输入指令：');
  console.log(JSON.stringify(parseCommand(line)));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  input.close();
}
