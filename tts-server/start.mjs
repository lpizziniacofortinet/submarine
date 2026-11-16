#!/usr/bin/env node
/**
 * Installs HeadTTS in a user-local cache and starts its Kokoro REST server.
 * The upstream server is patched locally to bind to loopback only.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const MIN_NODE_MAJOR = 20;
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < MIN_NODE_MAJOR) {
  console.error('HeadTTS requires Node.js ' + MIN_NODE_MAJOR + ' or newer. Current version: ' + process.versions.node);
  process.exit(1);
}

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const configPath = resolve(scriptDir, 'headtts-node.json');
const installDir = join(homedir(), '.submarine-headtts');
const upstream = 'https://github.com/met4citizen/HeadTTS.git';

function run(command, args, cwd) {
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  const result = spawnSync(executable, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + ' ' + args.join(' ') + ' failed with exit code ' + result.status);
  }
}

try {
  if (!existsSync(join(installDir, '.git'))) {
    console.log('Installing HeadTTS into ' + installDir);
    run('git', ['clone', '--depth', '1', upstream, installDir], homedir());
  } else {
    console.log('Using existing HeadTTS installation at ' + installDir);
  }

  const serverPath = join(installDir, 'modules', 'headtts-node.mjs');
  let serverSource = readFileSync(serverPath, 'utf8');
  let patched = false;
  for (const protocol of ['httpServer', 'httpsServer']) {
    const publicBind = protocol + '.listen(port, () => {';
    const loopbackBind = protocol + ".listen(port, '127.0.0.1', () => {";
    if (serverSource.includes(publicBind)) {
      serverSource = serverSource.replace(publicBind, loopbackBind);
      patched = true;
    } else if (!serverSource.includes(loopbackBind)) {
      throw new Error('Cannot safely restrict ' + protocol + ' to loopback; upstream server source changed.');
    }
  }
  if (patched) {
    writeFileSync(serverPath, serverSource, 'utf8');
    console.log('Restricted the local TTS listener to 127.0.0.1.');
  }

  if (!existsSync(join(installDir, 'node_modules'))) {
    console.log('Installing HeadTTS dependencies (first run only)…');
    // Replace the upstream POSIX-only mkdir postinstall with a portable Node.js
    // equivalent so npm installation also works from Windows terminals.
    const packagePath = join(installDir, 'package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    packageJson.scripts = packageJson.scripts || {};
    packageJson.scripts.postinstall =
      "node -e \"require('node:fs').mkdirSync('node_modules/@huggingface/transformers/.cache',{recursive:true})\"";
    writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\\n', 'utf8');
    run('npm', ['install', '--omit=dev'], installDir);
  }

  console.log('Starting local Kokoro TTS server on http://127.0.0.1:8882');
  run(process.execPath, [
    './modules/headtts-node.mjs',
    '--config',
    configPath
  ], installDir);
} catch (error) {
  console.error('Local TTS startup failed: ' + error.message);
  process.exit(1);
}
