import * as cp from 'child_process';
import * as path from 'path';
import * as readline from 'readline';

const cliPath = path.join(process.cwd(), 'dist', 'index.js');
console.log(`Spawning: node ${cliPath} serve-ipc`);

const deepaProcess = cp.spawn(process.execPath, [cliPath, 'serve-ipc'], {
    cwd: process.cwd(),
    env: process.env
});

deepaProcess.on('error', (err) => {
    console.error('SPAWN ERROR:', err);
});

deepaProcess.on('exit', (code, signal) => {
    console.log(`EXIT: code=${code} signal=${signal}`);
});

if (deepaProcess.stdout) {
    const rl = readline.createInterface({
        input: deepaProcess.stdout,
        terminal: false
    });

    rl.on('line', (line: string) => {
        console.log('[STDOUT]:', line);
    });
}

if (deepaProcess.stderr) {
    deepaProcess.stderr.on('data', (d) => {
        console.error('[STDERR]:', d.toString());
    });
}

// Send a chat message after 1 second automatically to verify it works
setTimeout(() => {
    console.log('Sending message to Deepa CLI...', '{"type":"chat","text":"who are you"}');
    deepaProcess.stdin.write('{"type":"chat","text":"who are you"}\n');
}, 1000);
