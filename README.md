# ⚔️ Level Up Fitness

A workout tracker that works like an RPG. Log your sets, earn XP and level up. Each muscle gets a rank from **F to S++** based on how strong you are compared to real-world strength standards.

It's an installable web app (PWA): no app store, it works offline, and your data stays on your phone.

## Features

- **Your program built in.** Mon/Wed/Fri Full Body A/B/C and Tue/Thu Fitness Court, with your sets and rep ranges.
- **Set logging.** Enter weight × reps for each set. The app fills in last session's weight and tells you when to add weight: once you hit the top of the rep range on every set, it suggests ⬆️ +5 lb.
- **Rest timer.** Checking off a set starts it (90 s by default, change it in Settings).
- **Fitness Court interval timer.** 45 s work / 15 s rest for 1–3 rounds, with beeps and vibration. Your screen stays on. Swap in variations for Thursday.
- **XP and levels:**
  - 10 XP per set, 8 XP per court station, 25 per full round, and 50 for finishing a workout
  - 75 XP per personal record (estimated 1RM)
  - 150 XP per muscle rank-up
  - Bodyweight XP: about 27 XP per lb every time you reach a new low (or a new high if you're bulking)
  - Achievements (Perfect Week, Bodyweight Bench, S-Rank Hunter …)
  - Titles: Novice → Iron Initiate → Bronze Lifter → … → Mythic Hunter
- **Muscle ranks, F → S++.** Chest, Back, Shoulders, Biceps, Triceps, Quads, Hamstrings, Glutes, Calves, Core and Conditioning.
- **Bodyweight tracking** with a trend chart and goal progress.
- **History**, plus JSON **export/import backup**.

## How ranking works

For each lift, the app estimates your 1-rep max from your best set (Epley formula: `weight × (1 + reps/30)`). It divides that by your current bodyweight and compares the result to strength standards for Beginner, Novice, Intermediate, Advanced and Elite lifters (roughly the 5th, 20th, 50th, 80th and 95th percentiles). The standards are estimated from public tables (Strength Level, Legion, Stronger) and scaled down for women.

| Rank | Meaning |
|---|---|
| F | Below beginner |
| E | Beginner |
| D | Novice |
| C | Halfway from novice to intermediate |
| B | Intermediate |
| A | Halfway from intermediate to advanced |
| S | Advanced |
| S+ | Elite |
| S++ | 1.2× elite (world class) |

A muscle's rank is the weighted average of the lifts that mainly train it. Fitness Court stations are ranked by reps in 45 s and feed **Core** and **Conditioning**. Because ranks are relative to bodyweight, losing fat also raises your ranks.

Dumbbell lifts (incline press, shoulder press, lateral raise, curls) use the weight of **one** dumbbell. All thresholds are in `data.js` if you want to tweak them.

## Android app (APK)

`dist/LevelUp.apk` is a ready-to-install Android app (Android 7+). It wraps the same web app in a full-screen WebView, with native backup save/import, back-button support and screen-on during the interval timer.

1. Download `LevelUp.apk` to your phone.
2. Tap it. If Android asks, allow your browser or Files app to **install unknown apps**.
3. Tap **Install**. If Play Protect warns about an unrecognized app, tap **More details → Install anyway**.

Rebuild after changing the web app with `android/build.sh` (no Android SDK needed: it fetches aapt2, dx and a signer itself). Bump `VERSION_CODE` for updates, e.g. `VERSION_CODE=2 VERSION_NAME=1.1 android/build.sh`. Updates must be signed with the same key (`android/levelup.*.pem`) or Android will refuse to install them over the old version.

## Install on your phone (web version)

The app has to be served over HTTPS once. After that it works offline.

**Option A: GitHub Pages** (this repo includes a workflow for it)
1. Merge this branch into `main`.
2. In the repo, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Note: GitHub Pages on a **private** repo needs a paid GitHub plan. Either make the repo public (your workout data is never uploaded, only the app code) or use option B.
4. Open `https://grbartho.github.io/Fitness_app/` on your phone.

**Option B: Netlify Drop** (free, no account needed to try)
Download this repo as a ZIP, unzip it, and drag the folder onto <https://app.netlify.com/drop>. Open the URL it gives you on your phone.

**Then add it to your home screen:**
- **iPhone (Safari):** Share button → *Add to Home Screen*
- **Android (Chrome):** ⋮ menu → *Install app* / *Add to Home screen*

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Files

- `index.html`, `styles.css`: the app shell and styles
- `app.js`: logging, XP, ranks, timers and all views
- `data.js`: your program, exercises and strength standards (edit here to change your plan)
- `sw.js`, `manifest.webmanifest`, `icons/`: offline support and install metadata
