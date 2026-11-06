# Japanese Study Deck

A daily study site with three sections:

- **N3 語彙**: flashcards for all 2,140 JLPT N3 words.
- **ビジネス敬語**: business Japanese for working with recruiters and companies in Japan. It has 293 flashcards (keigo verbs, job hunting, meetings and projects, sales and money, company roles, office life, and email, phone, interview and formal phrases), a quiz with 87 questions, and a keigo guide.
- **投資・金融**: investments and private markets terminology for talking about your background with recruiters. It has 146 flashcards (fund basics, investors, secondaries and co-investment, venture deals, valuation, performance and reporting, markets and quant, career talk), a quiz with 48 questions, and a guide to describing your experience in Japanese.

In both flashcard decks: each session is 20 cards. Each session is 20 cards. Words you miss come back at the end of the session and again in your next one. Words you know are spaced out further each time (1, 3, 7, 14, 30, 60, then 120 days). A progress bar shows how many words are mastered, reviewing, learning and still new.

Sign in with Google and your progress saves online, so it follows you to any device or browser. You can also save a progress file (`.md`) to your computer and load it back in at any time.

## What's in this folder

| File | What it is |
|---|---|
| `index.html` | The page |
| `style.css` | Look and layout |
| `app.js` | Flashcards, quiz, scheduling, saving and syncing |
| `words.js` | The 2,140 N3 words |
| `biz-cards.js` | Business Japanese flashcards |
| `biz-quiz.js` | Business Japanese quiz questions |
| `biz-guide.js` | The keigo guide (Guide tab) |
| `inv-cards.js` | Investment flashcards |
| `inv-quiz.js` | Investment quiz questions |
| `inv-guide.js` | Guide to talking about your background |
| `legacy-v1-keys.js` | The original word order, used only to convert progress saved by the first version. Don't edit. |
| `firebase-config.js` | Your Firebase settings (you fill this in, step 2) |
| `firestore.rules` | Security rules that keep each person's progress private |

## Setup (about 15 minutes, all free)

You need a GitHub account and a Google account.

### 1. Put the site on GitHub Pages

1. Create a new **public** repository on GitHub, for example `n3-deck`.
2. Upload every file in this folder to it (on the repository page: **Add file → Upload files**).
3. Go to **Settings → Pages**. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick the `main` branch and the `/ (root)` folder, and save.
4. After a minute your site is live at `https://YOUR-USERNAME.github.io/n3-deck/ (open `#biz` at the end of the address to go straight to business Japanese)`.

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

## The business Japanese quiz

Choose **ビジネス敬語 → Quiz**. Each quiz is 10 questions. You can pick one type or leave it on **Mixed** (about 6 multiple choice, 2 sentence building and 2 writing per quiz).

- **Choose the right form:** pick the correct keigo for a situation (respectful vs humble, requests, inside vs outside the company, common mistakes, email phrases). You see an explanation after each answer.
- **Build the sentence:** tap the pieces in the right order to make a business sentence.
- **Write it yourself:** write your own Japanese for a real situation (an email to a recruiter, a phone call, an interview answer). Then compare it with the model answer and checklist, and mark yourself.

Questions you get wrong come back at the end of the quiz and again in your next one. Questions you get right come back after 1, 3, 7, 14 days and so on. A question counts as mastered once you've got it right three times in a row.

## How saving works

- Each section has its own progress (Firestore documents `users/{you}/deck/n3`, `.../biz` and `.../inv`). The existing `firestore.rules` already cover both.
- **Signed in:** progress saves to your Firebase database under your Google account, and a copy stays in the browser. If you're offline, it saves on the device and catches up when you're back online.
- **Signed out:** progress saves only in that browser.
- **Signing in for the first time on a device:** anything you did while signed out on that device is combined into your account.
- **Two devices:** when you come back to a tab, it pulls in reviews made on your other devices. For each word it keeps whichever record has more reviews, so nothing is lost.

## Moving progress over (from the Claude version or another account)

1. In the old deck, choose **Save progress file** on the start screen. The file holds every section.
2. In this site, sign in, choose **Load progress file**, pick that file, and choose **Restore**.

The progress file is readable on its own: it lists your stats and your most-missed words. Don't edit the **Data** section at the bottom; that's what the deck reads.

## Editing the content

### Business cards and quiz

- Cards in `biz-cards.js` are tracked by `w` + `r` (the Japanese and its reading). Each card can have a `note` and an example (`ex`, `exEn`).
- Quiz questions in `biz-quiz.js` are tracked by `id`. Give every new question a new id, and don't reuse an old id for a different question.
- For multiple choice, put the correct answer first (`a: 0`). The options are shuffled on screen.
- For sentence building, list the `tiles` in the correct order. Add other correct orders to `alts`.

### N3 word list

Progress is tracked by each word and its reading, not by its position in `words.js`. So you can reorder the list, add words anywhere, or remove words without affecting the rest of your progress.

- Each entry is `["word", "reading", "meaning"]`. Leave the reading as `""` when the word is written in kana only.
- Changing a word's spelling or reading counts as a new word. Its old progress is kept in the background and comes back if you change it back.
- Removing a word hides it from sessions and the progress bar, but keeps its history.
- Changing only the meaning keeps the progress.

## Keyboard shortcuts

Flashcards: `Space` shows the answer · `1` didn't know · `2` knew it · `3` easy

Quiz: `1`–`4` picks an answer · `Enter` goes to the next question

## Changing settings

At the top of `app.js`:

- `SESSION` — cards per session (default 20)
- `QUIZ_N` — questions per quiz (default 10)
- `INTERVALS` — days between reviews for each level
- `MASTER_BOX` — the level counted as mastered (default 5, a 30-day gap)

## Credits

N3 word list from [open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks) by Jamie Sinclair, MIT licence.
