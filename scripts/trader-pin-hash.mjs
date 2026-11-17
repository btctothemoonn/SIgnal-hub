import { randomBytes, scryptSync } from 'node:crypto';
import { emitKeypressEvents } from 'node:readline';

let pin = '';
if (process.stdin.isTTY) {
  process.stderr.write('Trade PIN (6-12 digits, hidden): ');
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  pin = await new Promise(resolve => {
    const keypress = (text, key = {}) => {
      if (key.ctrl && key.name === 'c') { process.stdin.setRawMode(false); process.exit(130); }
      if (key.name === 'return') { process.stdin.off('keypress', keypress); process.stdin.setRawMode(false); process.stdin.pause(); resolve(pin); }
      else if (key.name === 'backspace') pin = pin.slice(0, -1);
      else if (/^\d$/.test(text || '') && pin.length < 12) pin += text;
    };
    process.stdin.on('keypress', keypress);
  });
  process.stderr.write('\n');
} else {
  for await (const chunk of process.stdin) {
    pin += chunk.toString();
    if (pin.length > 128) break;
  }
  pin = pin.trim();
}
if (!/^\d{6,12}$/.test(pin)) { process.stderr.write('PIN must contain 6-12 digits\n'); process.exit(1); }
const salt = randomBytes(16).toString('hex');
process.stdout.write(`scrypt$${salt}$${scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex')}\n`);
