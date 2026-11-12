# Chrome Web Store listing

Everything to paste into the Developer Dashboard, tab by tab. Upload
`dist/instagram-comments-exporter-<version>.zip` first (`npm run package`).

## Store listing tab

| Field | Value |
| --- | --- |
| Title | Comments Exporter for Instagram (read from the package) |
| Summary | Export Instagram post comments and replies to CSV, Excel or JSON. Sort, filter, check who follows you. Nothing leaves your browser. (read from the package) |
| Category | Tools |
| Language | English |
| Store icon | `assets/icons/icon-128.png` |
| Screenshots | the four files in `store/screenshots/` (1280x800) |
| Small promo tile | `store/promo-small-440x280.jpg` |
| Marquee promo tile | `store/promo-marquee-1400x560.jpg` (optional) |
| Promo video | leave empty |
| Official URL | leave empty unless you have a verified site |
| Homepage URL | your site or the project's repository, if public |
| Support URL | a page or address where users can reach you |
| Mature content | No |

### Description

```
Comments Exporter adds an "Export comments" button to Instagram posts and reels. It loads every comment and reply on the post, shows them in a preview, and saves the ones you choose as a CSV, Excel or JSON file on your computer.

WHAT YOU CAN DO
• Load all comments and replies on a post or reel.
• Sort by most liked, newest, oldest, most replied to, or username.
• Filter by minimum likes, minimum @mentions, verified accounts, one comment per person, text or username, and date range.
• Check which commenters follow the account that posted, then keep only followers or only non-followers.
• Choose the columns: username, comment, likes, replies, date, mentions, hashtags, verified, follows account, profile link, comment link and more.
• Download as CSV (opens correctly in Excel, including Arabic text and emoji), Excel (.xlsx) or JSON.

HOW IT WORKS
1. Open a post or reel on instagram.com while logged in.
2. Click "Export comments" at the bottom right of the page, or the extension's toolbar button.
3. Click "Load comments" and keep the tab open while it loads.
4. Fill in the sentence at the top to describe the rows you want, then click Download.

PRIVACY
Everything happens in your browser. The extension reads the comments Instagram already shows you and saves the file locally. It has no server, no sign-up, no analytics and no ads, and it does not send your data anywhere.

GOOD TO KNOW
• Log in to Instagram to load the full list of comments and replies.
• Large posts take a few minutes. Requests are spaced out, and the extension waits when Instagram asks it to slow down.
• The follow check sends one request per person, so narrow your selection first.
• Use it on your own posts, and respect Instagram's terms and other people's privacy when you use the exported file.

This is an independent tool. It is not affiliated with, endorsed by, or sponsored by Instagram or Meta. Instagram is a trademark of Meta Platforms, Inc.
```

## Privacy practices tab

**Single purpose**

```
Export the comments of the Instagram post the user is viewing to a local file (CSV, Excel or JSON), with sorting and filtering of those comments before the download.
```

**Permission justification: scripting**

```
Used only when the user clicks the extension's toolbar button while an Instagram post is open. It runs one small function in that tab to open the exporter panel that the extension's content script has already added to the page. No other code is injected and nothing is fetched from outside the package.
```

**Host permission justification (https://www.instagram.com/*)**

```
The extension works only on instagram.com. Its content script adds the "Export comments" button and panel to post and reel pages, and requests that post's comments from Instagram with the session the user already has, the same way the page does when the user scrolls the comments. No other site is read or contacted.
```

**Are you using remote code?** No, I am not using remote code. (All JavaScript is inside the
package; there is no `eval` and no externally loaded script.)

**Data usage**

- What user data do you collect: tick nothing. The extension processes comments in the page and
  saves a file locally; nothing is transmitted to you or to anyone else. If a reviewer asks for a
  category anyway, "Website content" is the one that describes what it reads.
- Tick all three certifications (no selling or transferring data, no use unrelated to the single
  purpose, no creditworthiness or lending use).

**Privacy policy URL**: `https://github.com/charonova/comments-exporter-for-instagram/blob/main/PRIVACY.md`
once `store/privacy-policy.md` is published there as `PRIVACY.md`. The policy's contact line points
at that repository's issues page, which also works as the listing's Support URL.

## Distribution tab

| Field | Value |
| --- | --- |
| Payments | Free of charge |
| Visibility | Public (or Unlisted while you try it with a few people) |
| Distribution | All regions |

## Test instructions tab

```
The extension needs an Instagram account; any account works and no special access is required.

1. Log in at https://www.instagram.com.
2. Open any post or reel that has comments, for example from a public account.
3. Click "Export comments" at the bottom right of the page (or the extension's toolbar button, then "Open the exporter").
4. Click "Load comments". The preview fills in as comments arrive.
5. Change the sentence at the top (for example "most liked first"), then click "Download".
6. Optional: after loading, click "Check who follows ..." under the column chips to fill the Follows column.
```

## Account tab (once per publisher)

- A verified contact email address.
- The trader or non-trader declaration.
- Two-step verification on the Google account.
