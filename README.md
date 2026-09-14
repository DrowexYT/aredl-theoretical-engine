# AREDL Theoretical Profile & Pack Engine

A client-side progression sandbox and planning suite for the [All Rated Extreme Demon List (AREDL)](https://aredl.net).

Test hypothetical record submissions, evaluate prospective list progression, and simulate pack qualifications in real time with 1:1 native UI fidelity. **All calculations and custom entries are handled strictly client-side inside your browser and never interfere with official AREDL servers or leaderboards.**

---

## Features

* **Theoretical Level Submissions**: Add hypothetical demon completions directly into your profile flow, complete with official thumbnail banners, point allocations, and video proof links.
* **Dynamic Pack Engine**: Automatically detects whether theoretical completions satisfy demon pack requirements, calculating bonus points and rendering pack banners directly in your profile's Packs tab.
* **Live Leaderboard & Roster Math**: Simulates your global rank, national standing, raw list points, total pack points, and hardest level rank via an expandable HUD or directly within your profile stats panel.
* **Universal UI Parity**: Clean, monospace `[Theo]` badges styled to match native list badges across all profile and pack interfaces for easy distinction between theoretical and official records and packs.
* **Strict Profile Isolation**: Automatically detects your logged-in username or allows you to set one manually. Theoretical cards and calculations run exclusively on your specified profile URL, leaving other players' profiles untouched.
* **Zero Server Burden**: Built-in 20-minute Time-To-Live (TTL) caching prevents rate-limiting and eliminates redundant requests to the official AREDL API.

---

## Installation

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/).
2. Click here to install the script directly: **[Install aredl-theoretical-engine.user.js](../../raw/main/aredl-theoretical-engine.user.js)**
3. Confirm the installation prompt in your Tampermonkey dashboard.
4. Navigate to [aredl.net](https://aredl.net) and open your profile.

---

## Usage & Configuration

* **Adding Levels**: Click the orange **+ ADD THEORETICAL DEMON** button at the bottom-right of your profile page to search for levels from the live AREDL registry.
* **Hidden Levels (Pack Tracking)**: To include officially beaten levels in pack requirement checks without duplicating your points, add them as a theoretical completion and check **Hide from Profile View**. Hidden levels do not award duplicate points or inflate your completion count—they are used strictly for pack qualification logic.
* **Managing Entries**: Click the three-dot menu on any injected theoretical card to update video links, toggle profile visibility, or delete the record entirely.
* **Profile Setup**: The script automatically attempts to detect your active profile from the navigation header. You can also manually switch the target username inside the submission modal via the **Active Profile** row.
* **Leaderboard Simulation**: Open the leaderboard page to view the minimized **THEO STATS** pill in the lower-left corner; click it to expand the full national and global breakdown.

---

## Data & Safety Policy

* **100% Local**: This script does not send data, analytics, or custom records to any external server. All entries are stored strictly in your browser's local userscript storage (`GM_getValue` / `GM_setValue`).
* **Zero List Spoofing**: Theoretical completions are strictly local visual simulations and do not alter official AREDL records or rankings.
* **API Polite**: All external queries make standard `GET` requests to public endpoints and respect local caching timers.

---

## Disclosure & Disclaimer

This project is an independent open-source tool developed with the assistance of AI and is not officially affiliated with, endorsed by, or maintained by the AREDL list team.

---

## License

Distributed under the [MIT License](LICENSE).
