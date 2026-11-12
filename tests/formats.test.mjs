process.env.TZ = 'UTC'; // date filters use the viewer's local time

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { loadContentScript, root } from './helpers.mjs';

const { formats } = loadContentScript('formats.js');

function row(id, username, likes, date, extra = {}) {
  return {
    comment_id: id,
    type: 'comment',
    parent_comment_id: '',
    username,
    profile_url: `https://www.instagram.com/${username}/`,
    is_verified: false,
    text: `text ${id}`,
    created_at_utc: `${date}:00.000Z`,
    likes,
    reply_count: 0,
    mentions: '',
    hashtags: '',
    hidden: false,
    gif_url: '',
    comment_url: `https://www.instagram.com/p/X/c/${id}/`,
    profile_pic_url: '',
    user_id: `u-${username}`,
    ...extra,
  };
}

function makeJob() {
  const c1 = row('c1', 'alice', 5, '2026-11-10T10:00', { reply_count: 2, text: 'Hello @bob and @carol #fun', mentions: 'bob carol', hashtags: 'fun' });
  const c2 = row('c2', 'bob', 9, '2026-11-11T09:00', { is_verified: true, text: '=SUM(1,1)' });
  const c3 = row('c3', 'alice', 1, '2026-11-12T08:00', { hidden: true, text: 'multi\nline, "quoted"' });
  const r1 = row('r1', 'dave', 20, '2026-11-10T12:00', { type: 'reply', parent_comment_id: 'c1' });
  const r2 = row('r2', 'bob', 0, '2026-11-13T07:00', { type: 'reply', parent_comment_id: 'c1', is_verified: true });
  return { post: { code: 'X', url: 'https://www.instagram.com/p/X/' }, loggedIn: true, finished: true, comments: [c1, c2, c3], replies: new Map([['c1', [r1, r2]]]), replyCount: 2 };
}

const ids = (query) => formats.select(makeJob(), query).map((r) => r.comment_id);

test('default order keeps each comment followed by its replies', () => {
  assert.deepEqual(ids({}), ['c1', 'r1', 'r2', 'c2', 'c3']);
});

test('sorting', () => {
  assert.deepEqual(ids({ sort: 'likes' }), ['r1', 'c2', 'c1', 'c3', 'r2']);
  assert.deepEqual(ids({ sort: 'newest' }), ['r2', 'c3', 'c2', 'r1', 'c1']);
  assert.deepEqual(ids({ sort: 'oldest' }), ['c1', 'r1', 'c2', 'c3', 'r2']);
  assert.deepEqual(ids({ sort: 'replies' }), ['c1', 'r1', 'r2', 'c2', 'c3']);
  // Ties keep Instagram's order: alice's c1 before c3, bob's r2 before c2.
  assert.deepEqual(ids({ sort: 'username' }), ['c1', 'c3', 'r2', 'c2', 'r1']);
});

test('filters', () => {
  assert.deepEqual(ids({ what: 'comment' }), ['c1', 'c2', 'c3']);
  assert.deepEqual(ids({ what: 'reply' }), ['r1', 'r2']);
  assert.deepEqual(ids({ minLikes: 5 }), ['c1', 'r1', 'c2']);
  assert.deepEqual(ids({ minMentions: 2 }), ['c1']);
  assert.deepEqual(ids({ from: 'verified' }), ['r2', 'c2']);
  assert.deepEqual(ids({ hidden: 'exclude' }), ['c1', 'r1', 'r2', 'c2']);
  assert.deepEqual(ids({ search: 'HELLO' }), ['c1']);
  assert.deepEqual(ids({ search: '@bob' }), ['c1', 'r2', 'c2'], 'matches the username and mentions in the text');
  assert.deepEqual(ids({ dateFrom: '2026-11-11', dateTo: '2026-11-12' }), ['c2', 'c3']);
  assert.deepEqual(ids({ dateTo: '2026-11-10' }), ['c1', 'r1']);
});

test('follow filter matches only people who were looked up', () => {
  const job = makeJob();
  job.comments[0].follows_account = true; // alice's c1
  job.comments[1].follows_account = false; // bob's c2
  job.comments[2].follows_account = null; // inconclusive
  const pick = (query) => formats.select(job, query).map((r) => r.comment_id);
  assert.deepEqual(pick({ follow: 'yes' }), ['c1']);
  assert.deepEqual(pick({ follow: 'no' }), ['c2']);
  assert.deepEqual(pick({ follow: 'any' }), ['c1', 'r1', 'r2', 'c2', 'c3']);
  const csv = formats.toCsv(formats.select(job, { what: 'comment' }), ['username', 'follows_account']);
  assert.deepEqual(csv.slice(1).trim().split('\r\n'), ['username,follows_account', 'alice,true', 'bob,false', 'alice,']);
  assert.ok(formats.COLUMNS.some((column) => column.key === 'follows_account'));
});

test('one per person keeps the first row in the chosen order', () => {
  assert.deepEqual(ids({ each: 'person' }), ['c1', 'r1', 'r2']);
  assert.deepEqual(ids({ each: 'person', sort: 'likes' }), ['r1', 'c2', 'c1']);
});

test('summary', () => {
  assert.deepEqual(formats.summarize(makeJob()), { comments: 3, replies: 2, people: 3, likes: 35 });
});

test('CSV: byte-order mark, quoting, and formula-looking text', () => {
  const csv = formats.toCsv(formats.select(makeJob(), {}), ['username', 'text', 'likes']);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], 'username,text,likes');
  assert.equal(lines[1], 'alice,Hello @bob and @carol #fun,5');
  assert.ok(csv.includes('bob," =SUM(1,1)",9'), 'a leading space keeps spreadsheets from running it');
  assert.ok(csv.includes('alice,"multi\nline, ""quoted""",1'));
  assert.ok(csv.endsWith('\r\n'));
});

test('JSON keeps only the chosen columns', () => {
  const job = makeJob();
  const out = JSON.parse(formats.toJson(job, formats.select(job, { sort: 'likes' }), ['username', 'likes']));
  assert.equal(out.total, 5);
  assert.equal(out.all_comments_loaded, true);
  assert.equal(out.post_url, 'https://www.instagram.com/p/X/');
  assert.deepEqual(out.comments[0], { username: 'dave', likes: 20 });
});

// Reads a stored (uncompressed) zip and checks every entry's checksum.
function unzip(bytes) {
  const files = {};
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const crc = bytes.readUInt32LE(offset + 14);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const data = bytes.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size);
    assert.equal(zlib.crc32(data), crc, `checksum of ${name}`);
    files[name] = data.toString('utf8');
    offset += 30 + nameLength + size;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50, 'central directory follows the entries');
  assert.equal(bytes.readUInt16LE(bytes.length - 22 + 10), Object.keys(files).length, 'entry count in the end record');
  return files;
}

test('Excel: valid package, typed cells, forbidden characters removed', async () => {
  const job = makeJob();
  const rows = formats.select(job, { sort: 'likes' });
  rows[0] = { ...rows[0], text: `bad${String.fromCharCode(1, 0xfffe)}chars & <tags>` };
  const bytes = Buffer.from(await formats.toXlsx(rows, ['username', 'text', 'likes', 'is_verified']).arrayBuffer());
  const files = unzip(bytes);
  assert.deepEqual(Object.keys(files), ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']);
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.equal(sheet.match(/<row /g).length, 6, 'header plus five rows');
  assert.ok(sheet.includes('<c r="C2"><v>20</v></c>'), 'likes are numbers');
  assert.ok(sheet.includes('<c r="D3" t="b"><v>1</v></c>'), 'verified is a boolean');
  assert.ok(sheet.includes('badchars &amp; &lt;tags&gt;'));
  assert.ok(sheet.includes('<is><t xml:space="preserve">=SUM(1,1)</t></is>'), 'formula-looking text stays text');
  assert.ok(sheet.includes('<autoFilter ref="A1:D6"/>'));
});

test('content scripts contain nothing Chrome refuses to load', () => {
  // Chrome rejects a content script that contains U+FFFE or U+FFFF literally ("isn't UTF-8 encoded").
  for (const name of fs.readdirSync(path.join(root, 'src/content'))) {
    const text = fs.readFileSync(path.join(root, 'src/content', name), 'utf8');
    const bad = [...text].filter((ch) => [0xfffe, 0xffff, 0xfffd].includes(ch.codePointAt(0)));
    assert.equal(bad.length, 0, `${name} contains a character Chrome rejects`);
  }
});
