#!/usr/bin/env node
/**
 * mark-contacted.js
 * Mark one or more outreach prospects as "contacted" in seo_outreach_tracker.csv.
 *
 * Usage:
 *   node scripts/mark-contacted.js 009              # mark one
 *   node scripts/mark-contacted.js 001 002 009      # mark several
 *   node scripts/mark-contacted.js --all-week1      # mark all 15 Week 1 emails
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const CSV  = path.join(__dirname, '..', 'seo_outreach_tracker.csv');
const TODAY = new Date().toISOString().slice(0, 10);

const WEEK1_IDS = ['009','001','011','014','016','028','029','002','008','017','018','021','025','026','030'];

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: node scripts/mark-contacted.js <id> [<id> ...] | --all-week1');
  process.exit(1);
}

const targetIds = args.includes('--all-week1')
  ? WEEK1_IDS
  : args;

const lines  = fs.readFileSync(CSV, 'utf8').split('\n');
const header = lines[0];
const cols   = header.split(',');
const iId    = cols.indexOf('id');
const iSt    = cols.indexOf('status');
const iDc    = cols.indexOf('date_contacted');

let changed = 0;
const updated = lines.map((line, idx) => {
  if (idx === 0) return line;
  const parts = line.split(',');
  if (!parts[iId]) return line;
  if (!targetIds.includes(parts[iId].trim())) return line;
  if (parts[iSt] === 'contacted') {
    console.log(`  ${parts[iId]} ${parts[1]} — already contacted`);
    return line;
  }
  parts[iSt] = 'contacted';
  parts[iDc] = TODAY;
  changed++;
  console.log(`✓ ${parts[iId].trim()} ${parts[1]} marked contacted (${TODAY})`);
  return parts.join(',');
});

fs.writeFileSync(CSV, updated.join('\n'), 'utf8');
console.log(`\nUpdated ${changed} record(s). Run 'node seo_outreach.js' to see new pipeline stats.`);
