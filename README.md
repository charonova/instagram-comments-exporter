<img src="assets/brand/icon-512.png" width="88" alt="Comments Exporter icon" />

# Instagram Comments Exporter

A Chrome extension that loads the comments and replies of an Instagram post, lets you sort and
filter them, and downloads the result as CSV, Excel or JSON.

It runs inside your own logged-in instagram.com tab and sends the same GraphQL requests Instagram's
web app sends when you scroll the comments. Nothing is uploaded anywhere; the file is saved locally.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder.

After changing any file here, press the reload arrow on the extension's card and refresh Instagram.

## Use

1. Log in to instagram.com and open a post or reel (`/p/...` or `/reel/...`).
2. Click **Export comments** at the bottom right of the page, or the extension's toolbar button
   and then **Open the exporter**.
3. Click **Load comments** and keep the tab open. The preview fills in as pages arrive.
   **Stop** ends the run early and keeps what was loaded.
4. Shape the file with the sentence at the top, then click **Download**.

### What you can choose

The sentence reads back exactly what the file will contain. Each underlined blank is a control:

| Blank | Choices |
| --- | --- |
| What | comments and replies, comments only, replies only |
| Order | Instagram's order (threads kept together), most liked, newest, oldest, most replied to, username A to Z |
| Likes, mentions | a minimum number of likes, and of @mentions in the text |
| From | anyone, or verified accounts only |
| Following | whether or not they follow the account, only people who follow it, or only people who do not (after the follow check below) |
| Keeping | every comment, or one per person (the first one in the chosen order) |
| Hidden | include or leave out comments Instagram tucks under "View hidden comments" |
| Containing | text in the comment, or a username |
| Posted | a date range |

Clicking a column heading in the preview (Likes, Replies, Date, User) sorts by it too.
The chips under the sentence switch file columns on and off. The preview shows the first 200
rows; the file always contains every matching row.

### Checking who follows the account

Under the column chips, **Check who follows your account** looks up every person in the current
selection with the search box of Instagram's follower list: one request per person, about two
seconds apart. A thousand people take around forty minutes, so narrow the selection first (for
example one per person, or a minimum number of mentions) and then run the check.

- The answer goes into the `follows_account` column: `true`, `false`, or empty when the person was
  not looked up. `Unclear` in the preview means the search had more matches than were read and the
  person was not among them.
- **Stop checking** keeps the answers so far; pressing the button again continues with the rest.
- It needs a logged-in session. On a post from another account it checks that account's followers,
  and Instagram only shows part of other accounts' follower lists, so some followers can be missed.

## Files it writes

- **CSV** is UTF-8 with a byte-order mark, so Excel shows Arabic text and emoji correctly. Text
  starting with `=`, `+`, `-` or `@` gets a leading space so a spreadsheet does not run it as a formula.
- **Excel** (`.xlsx`) has a frozen, filterable header row, real numbers for likes and replies, and
  wrapped comment text.
- **JSON** keeps the text exactly as written.

Columns: `username, text, likes, reply_count, created_at_utc, type, parent_comment_id, mentions,
hashtags, is_verified, follows_account, hidden, profile_url, comment_url, profile_pic_url, gif_url,
comment_id, user_id`

## Good to know

- **Log in for the full list.** Logged out, Instagram serves only a few hundred comments and no
  replies; the sheet warns when that is the case.
- The total can be lower than the number shown on the post, which also counts comments Instagram
  filters out or that were deleted.
- Requests are spaced about a second apart. If Instagram asks to slow down, loading waits
  (1, 2, then 4 minutes) and continues on its own.
- This is automated access to Instagram, which its terms restrict. Use it on your own posts and
  avoid running many exports back to back.

## Project layout

```
manifest.json            extension manifest (version lives here and in package.json)
src/content/core.js      loads the comments (session, requests, paging, replies) and runs the follow check
src/content/formats.js   picks the rows (select) and writes CSV, Excel and JSON
src/content/ui.js        the on-page sheet and the Export comments button
src/popup/               the toolbar popup
assets/icons/            PNG icons Chrome uses (16, 32, 48, 128)
assets/brand/            icon sources: icon.svg, icon-small.svg (drawn for 16/32 px), mark.svg
design/logo/             logo concepts and colour trials (not shipped)
tests/                   unit tests and the end-to-end smoke test
scripts/package.mjs      builds the release zip
```

The three content scripts run in the page's own JavaScript world, in the order above, and share
one object, `window.__igce`.

## Development

Needs Node 22 or newer. There are no dependencies to install.

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests for loading (against a stand-in for Instagram) and for sorting, filtering and the three file formats. Offline, under a second. |
| `npm run smoke` | Starts a throwaway Chrome, loads this folder as an unpacked extension and drives the popup and the exporter on a public post, logged out. Add `-- <post url>` for another post and `-- --shots <dir>` for screenshots. Set `CHROME` if Chrome is not in `/Applications`. |
| `npm run package` | Writes `dist/instagram-comments-exporter-<version>.zip` with only what Chrome needs, for the Chrome Web Store or for sharing. |

Two things to keep in mind when editing:

- Keep the content scripts free of the literal characters U+FFFE and U+FFFF. Chrome refuses to load
  a content script that contains them, and neither `node --check` nor the unit tests' own runs of
  the code notice (`formats.js` builds them from char codes; a unit test guards this).
- The PNG icons are rendered from the SVGs in `assets/brand/`: `icon-small.svg` at 16 and 32 px,
  `icon.svg` at 48 px, and at 96 px centred on a 128 px canvas (the Chrome Web Store layout).

## If it stops working

Instagram changes its internal query IDs when it deploys. The exporter reads the current IDs from
the page itself and only falls back to the ones saved in `src/content/core.js` (the `OPS` table,
read from Instagram's web bundle on 2026-11-12). If Instagram renames the queries, that table is
the place to update: operation name, doc ID, and variables.
