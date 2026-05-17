#!/usr/bin/env node
'use strict';

/**
 * setup.js — First-run admin setup
 * Creates the superuser account (username: Strength) on first launch.
 *
 * Usage:  node admin/setup.js
 *         npm run setup-admin
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const readline = require('readline');
const bcrypt   = require('bcryptjs');
const { getDb } = require('./db');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

function promptPassword(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    process.stdout.write(question);
    rl.input.setRawMode && rl.input.setRawMode(true);
    let password = '';
    rl.input.on('data', char => {
      char = char.toString();
      if (char === '\n' || char === '\r' || char === '') {
        rl.input.setRawMode && rl.input.setRawMode(false);
        process.stdout.write('\n');
        rl.close();
        resolve(password);
      } else if (char === '' || char === '') {
        password = password.slice(0, -1);
      } else {
        password += char;
        process.stdout.write('*');
      }
    });
  });
}

async function main() {
  console.log('\n  Mauritius Resort Finder — Admin Setup\n');

  const db = await getDb();
  const existing = await db.get('SELECT COUNT(*) AS n FROM users');

  if (existing && existing.n > 0) {
    console.log('  ✓ Admin users already exist. No setup needed.\n');
    console.log('  Run `npm run admin` to start the dashboard.\n');
    process.exit(0);
  }

  console.log('  No admin users found. Creating superuser account.\n');
  console.log('  Username: Strength (fixed)\n');

  let password, confirm;
  for (;;) {
    password = await promptPassword('  Password: ');
    if (password.length < 10) {
      console.log('  ✗ Password must be at least 10 characters.\n');
      continue;
    }
    confirm = await promptPassword('  Confirm password: ');
    if (password !== confirm) {
      console.log('  ✗ Passwords do not match.\n');
      continue;
    }
    break;
  }

  const hash = await bcrypt.hash(password, 12);
  await db.run(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
    ['Strength', hash, 'super_admin']
  );

  console.log('\n  ✓ Superuser "Strength" created successfully.\n');
  console.log('  Run `npm run admin` to start the dashboard.\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\n  Setup failed:', err.message, '\n');
  process.exit(1);
});
