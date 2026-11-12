/*
 * Instagram Comments Exporter — choosing rows and writing files (CSV, Excel, JSON).
 */
(() => {
  'use strict';
  const ns = (window.__igce = window.__igce || {});
  if (ns.formats) return;

  // File columns, in the order they are written. `width` is the Excel column width.
  const COLUMNS = [
    { key: 'username', label: 'Username', width: 24 },
    { key: 'text', label: 'Comment', width: 70 },
    { key: 'likes', label: 'Likes', width: 8 },
    { key: 'reply_count', label: 'Replies', width: 8 },
    { key: 'created_at_utc', label: 'Date', width: 24 },
    { key: 'type', label: 'Type', width: 10 },
    { key: 'parent_comment_id', label: 'Parent comment ID', width: 20 },
    { key: 'mentions', label: 'Mentions', width: 24 },
    { key: 'hashtags', label: 'Hashtags', width: 24 },
    { key: 'is_verified', label: 'Verified', width: 10 },
    { key: 'follows_account', label: 'Follows account', width: 16 },
    { key: 'hidden', label: 'Hidden', width: 8 },
    { key: 'profile_url', label: 'Profile link', width: 38 },
    { key: 'comment_url', label: 'Comment link', width: 38 },
    { key: 'profile_pic_url', label: 'Profile picture', width: 30 },
    { key: 'gif_url', label: 'GIF', width: 30 },
    { key: 'comment_id', label: 'Comment ID', width: 20 },
    { key: 'user_id', label: 'User ID', width: 14 },
  ];

  const DEFAULT_QUERY = {
    what: 'all', // all | comment | reply
    sort: 'thread', // thread | likes | newest | oldest | replies | username
    minLikes: 0,
    minMentions: 0,
    from: 'anyone', // anyone | verified
    follow: 'any', // any | yes | no (people not looked up yet match neither yes nor no)
    each: 'every', // every | person (one row per username)
    hidden: 'include', // include | exclude
    search: '',
    dateFrom: '', // YYYY-MM-DD, viewer's local time
    dateTo: '',
  };

  // Top-level comments in the order Instagram returned them, each followed by its replies.
  function flatten(job) {
    return job.comments.flatMap((row) => [row, ...(job.replies.get(row.comment_id) || [])]);
  }

  const SORTS = {
    likes: (a, b) => b.likes - a.likes,
    newest: (a, b) => (a.created_at_utc < b.created_at_utc ? 1 : a.created_at_utc > b.created_at_utc ? -1 : 0),
    oldest: (a, b) => (a.created_at_utc > b.created_at_utc ? 1 : a.created_at_utc < b.created_at_utc ? -1 : 0),
    replies: (a, b) => b.reply_count - a.reply_count,
    username: (a, b) => a.username.localeCompare(b.username),
  };

  /** The rows of `job` that match `query`, in the order it asks for. */
  function select(job, query) {
    const q = { ...DEFAULT_QUERY, ...query };
    const needle = q.search.trim().toLowerCase();
    const from = q.dateFrom ? new Date(q.dateFrom + 'T00:00:00').getTime() : -Infinity;
    const to = q.dateTo ? new Date(q.dateTo + 'T23:59:59.999').getTime() : Infinity;
    let rows = flatten(job).filter((row) => {
      if (q.what !== 'all' && row.type !== q.what) return false;
      if (row.likes < q.minLikes) return false;
      if (q.minMentions > 0 && (row.mentions ? row.mentions.split(' ').length : 0) < q.minMentions) return false;
      if (q.from === 'verified' && !row.is_verified) return false;
      if (q.follow !== 'any' && row.follows_account !== (q.follow === 'yes')) return false;
      if (q.hidden === 'exclude' && row.hidden) return false;
      if (needle && !row.text.toLowerCase().includes(needle) && !row.username.toLowerCase().includes(needle.replace(/^@/, ''))) return false;
      if (from !== -Infinity || to !== Infinity) {
        const posted = Date.parse(row.created_at_utc);
        if (!(posted >= from && posted <= to)) return false;
      }
      return true;
    });
    // Array.sort is stable, so ties keep Instagram's order.
    if (SORTS[q.sort]) rows.sort(SORTS[q.sort]);
    if (q.each === 'person') {
      const people = new Set();
      rows = rows.filter((row) => !people.has(row.username) && people.add(row.username));
    }
    return rows;
  }

  function summarize(job) {
    const rows = flatten(job);
    return {
      comments: job.comments.length,
      replies: job.replyCount,
      people: new Set(rows.map((row) => row.username)).size,
      likes: rows.reduce((sum, row) => sum + row.likes, 0),
    };
  }

  // ---------- CSV and JSON ----------

  // A leading byte-order mark makes Excel read the CSV as UTF-8, so Arabic text and emoji survive.
  // These characters are written as char codes because Chrome refuses to load a script file
  // that contains U+FFFE or U+FFFF literally.
  const BOM = String.fromCharCode(0xfeff);
  const XML_FORBIDDEN = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F' + String.fromCharCode(0xfffe, 0xffff) + ']', 'g');

  function toCsv(rows, keys) {
    const cell = (value) => {
      let s = value == null ? '' : String(value);
      // A leading space stops Excel and Sheets from running comment text as a formula.
      if (/^[=+\-@]/.test(s)) s = ' ' + s;
      return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [keys.join(',')];
    for (const row of rows) lines.push(keys.map((key) => cell(row[key])).join(','));
    return BOM + lines.join('\r\n') + '\r\n';
  }

  function toJson(job, rows, keys) {
    const comments = rows.map((row) => Object.fromEntries(keys.map((key) => [key, row[key]])));
    return JSON.stringify({ post_url: job.post.url, exported_at: new Date().toISOString(), all_comments_loaded: job.finished && job.loggedIn, total: comments.length, comments }, null, 2);
  }

  // ---------- Excel (.xlsx is a zip of XML files) ----------

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  // Stored (uncompressed) zip: enough for Excel, and needs no compression code.
  function zip(files) {
    const encoder = new TextEncoder();
    const parts = [];
    const directory = [];
    let offset = 0;
    for (const [name, content] of files) {
      const nameBytes = encoder.encode(name);
      const data = encoder.encode(content);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(12, 0x21, true); // 1980-01-01, a fixed date keeps the file reproducible
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);
      central.setUint16(6, 20, true);
      central.setUint16(14, 0x21, true);
      central.setUint32(16, crc, true);
      central.setUint32(20, data.length, true);
      central.setUint32(24, data.length, true);
      central.setUint16(28, nameBytes.length, true);
      central.setUint32(42, offset, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, data);
      directory.push(new Uint8Array(central.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, directorySize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...directory, new Uint8Array(end.buffer)]);
  }

  // XML 1.0 forbids most control characters and unpaired surrogates; Excel rejects a file with them.
  function xmlText(value) {
    const s = typeof value.toWellFormed === 'function' ? value.toWellFormed() : value;
    return s
      .replace(XML_FORBIDDEN, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function columnName(index) {
    let name = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    return name;
  }

  function toXlsx(rows, keys) {
    const columns = keys.map((key) => COLUMNS.find((column) => column.key === key));
    const cell = (value, ref, style) => {
      if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
      if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
      if (value == null || value === '') return '';
      return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xmlText(String(value))}</t></is></c>`;
    };
    const lines = [`<row r="1">${keys.map((key, c) => cell(key, columnName(c) + '1', 1)).join('')}</row>`];
    rows.forEach((row, r) => {
      const n = r + 2;
      lines.push(`<row r="${n}">${keys.map((key, c) => cell(row[key], columnName(c) + n, key === 'text' ? 2 : 0)).join('')}</row>`);
    });
    const lastCell = columnName(keys.length - 1) + (rows.length + 1);
    const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const pkg = 'http://schemas.openxmlformats.org/package/2006';
    return zip([
      [
        '[Content_Types].xml',
        `${head}<Types xmlns="${pkg}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      ],
      ['_rels/.rels', `${head}<Relationships xmlns="${pkg}/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', `${head}<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="Comments" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      [
        'xl/_rels/workbook.xml.rels',
        `${head}<Relationships xmlns="${pkg}/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
      ],
      [
        'xl/styles.xml',
        `${head}<styleSheet xmlns="${main}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
          '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
          '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
          '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
          '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>' +
          '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
      ],
      [
        'xl/worksheets/sheet1.xml',
        `${head}<worksheet xmlns="${main}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
          `<cols>${columns.map((column, c) => `<col min="${c + 1}" max="${c + 1}" width="${column.width}" customWidth="1"/>`).join('')}</cols>` +
          `<sheetData>${lines.join('')}</sheetData><autoFilter ref="A1:${lastCell}"/></worksheet>`,
      ],
    ]);
  }

  function download(filename, mime, content) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.documentElement.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  const FORMATS = {
    csv: { label: 'CSV', extension: 'csv', mime: 'text/csv;charset=utf-8', write: (job, rows, keys) => toCsv(rows, keys) },
    xlsx: { label: 'Excel', extension: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', write: (job, rows, keys) => toXlsx(rows, keys) },
    json: { label: 'JSON', extension: 'json', mime: 'application/json', write: toJson },
  };

  /** Writes `rows` with the chosen columns in the chosen format and hands the file to the browser. Returns its name. */
  function save(job, rows, keys, format) {
    const { extension, mime, write } = FORMATS[format];
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const filename = `instagram-comments-${job.post.code}-${stamp}.${extension}`;
    download(filename, mime, write(job, rows, keys));
    return filename;
  }

  ns.formats = { COLUMNS, DEFAULT_QUERY, FORMATS, flatten, select, summarize, toCsv, toJson, toXlsx, save };
})();
