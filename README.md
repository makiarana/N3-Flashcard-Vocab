# N3 Vocabulary Deck

A daily flashcard site for all 2,140 JLPT N3 words. Each session is 20 cards. Words you miss come back at the end of the session and again in your next one. Words you know are spaced out further each time (1, 3, 7, 14, 30, 60, then 120 days). A progress bar shows how many words are mastered, reviewing, learning and still new.

Sign in with Google and your progress saves online, so it follows you to any device or browser. You can also save a progress file (`.md`) to your computer and load it back in at any time.

## What's in this folder

| File | What it is |
|---|---|
| `index.html` | The page |
| `style.css` | Look and layout |
| `app.js` | Flashcards, scheduling, saving and syncing |
| `words.js` | The 2,140 N3 words |
| `firebase-config.js` | Your Firebase settings (you fill this in, step 2) |
| `firestore.rules` | Security rules that keep each person's progress private |

## Setup (about 15 minutes, all free)

You need a GitHub account and a Google account.

### 1. Put the site on GitHub Pages

1. Create a new **public** repository on GitHub, for example `n3-deck`.
2. Upload every file in this folder to it (on the repository page: **Add file → Upload files**).
3. Go to **Settings → Pages**. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick the `main` branch and the `/ (root)` folder, and save.
4. After a minute your site is live at `https://YOUR-USERNAME.github.io/n3-deck/`.

The deck works at this point, but only saves on the device you're using. The next steps turn on online saving.

### 2. Create a Firebase project

1. Go to <https://console.firebase.google.com> and choose **Create a project**. Any name works. You can turn off Google Analytics.
2. On the project home page, click the **web** icon (`</>`) to add a web app. Give it a nickname. You don't need Firebase Hosting.
3. Firebase shows a `firebaseConfig` block. Copy its values into `firebase-config.js` in your repository (edit the file on GitHub with the pencil icon), replacing the placeholders. Commit the change.

### 3. Turn on Google sign-in

1. In the Firebase console, open **Build → Authentication → Get started**.
2. Under **Sign-in method**, enable **Google**, choose a support email, and save.
3. Open the **Settings** tab → **Authorized domains** → **Add domain**, and add `YOUR-USERNAME.github.io`.

### 4. Create the database

1. Open **Build → Firestore Database → Create database**. Pick a location near you and start in **production mode**.
2. Open the **Rules** tab, replace everything with the contents of `firestore.rules`, and click **Publish**.

### 5. Try it

Open your site, click **Sign in with Google**, and do a session. The label under your email should say **Saved online**. Open the site on your phone, sign in with the same Google account, and your progress is there.

## How saving works

- **Signed in:** progress saves to your Firebase database under your Google account, and a copy stays in the browser. If you're offline, it saves on the device and catches up when you're back online.
- **Signed out:** progress saves only in that browser.
- **Signing in for the first time on a device:** anything you did while signed out on that device is combined into your account.
- **Two devices:** when you come back to a tab, it pulls in reviews made on your other devices. For each word it keeps whichever record has more reviews, so nothing is lost.

## Moving progress over (from the Claude version or another account)

1. In the old deck, choose **Save progress file** on the start screen. This saves a file like `n3-progress-2026-11-02.md`.
2. In this site, sign in, choose **Load progress file**, pick that file, and choose **Restore**.

The progress file is readable on its own: it lists your stats and your most-missed words. Don't edit the **Data** section at the bottom; that's what the deck reads.

## Keyboard shortcuts

`Space` shows the answer · `1` didn't know · `2` knew it · `3` easy

## Changing settings

At the top of `app.js`:

- `SESSION` — cards per session (default 20)
- `INTERVALS` — days between reviews for each level
- `MASTER_BOX` — the level counted as mastered (default 5, a 30-day gap)

## Credits

Word list from [open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks) by Jamie Sinclair, MIT licence.
