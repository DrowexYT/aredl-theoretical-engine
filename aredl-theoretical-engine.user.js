// ==UserScript==
// @name         AREDL Theoretical Profile & Pack Engine (V1.1 Public Release)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Client-side progression sandbox for AREDL. Enables theoretical level completions, dynamic pack evaluation, point calculations, live leaderboard estimations, auto-syncing list placements, and custom completion dates.
// @author       Drowex
// @match        https://aredl.net/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const AREDL_API_URL = 'https://api.aredl.net/v2/api/aredl/levels?exclude_legacy=true&exclude_pending=false&exclude_removed=false';
    const PACK_TIERS_URL = 'https://api.aredl.net/v2/api/aredl/pack-tiers';
    const BANNER_BASE_URL = 'https://raw.githubusercontent.com/All-Rated-Extreme-Demon-List/Thumbnails/main/levels/cards/';
    const PACK_BANNER_BASE_URL = 'https://raw.githubusercontent.com/All-Rated-Extreme-Demon-List/Thumbnails/main/packs/';
    const LB_API_BASE = 'https://api.aredl.net/v2/api/aredl/leaderboard';
    const CACHE_TTL_MS = 20 * 60 * 1000;

    // --- DYNAMIC USER IDENTIFICATION ---
    function getTargetUsername() {
        return GM_getValue('aredl_active_user', 'drowex.');
    }

    function setTargetUsername(name) {
        if (!name) return;
        GM_setValue('aredl_active_user', name.trim());
    }

    function cleanString(str) {
        return (str || '')
            .replace(/\([^)]*\)/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    // Auto-detects logged in username from the site's avatar menu
    function checkAndAutoDetectUser() {
        const profileLinks = Array.from(document.querySelectorAll('a[href*="/profile/user/"]'));
        for (const a of profileLinks) {
            const isMenuLink = a.textContent.trim().toUpperCase() === 'PROFILE' || a.closest('[role="menu"]') || a.closest('header');
            if (isMenuLink) {
                const match = a.getAttribute('href').match(/\/profile\/user\/([^/?#]+)/i);
                if (match && match[1]) {
                    const detected = decodeURIComponent(match[1]);
                    const current = GM_getValue('aredl_active_user', null);
                    if (!current) {
                        setTargetUsername(detected);
                    }
                }
            }
        }
    }

    function getCustomRecords() { return GM_getValue('aredl_theo_v15', []); }
    function saveCustomRecords(records) {
        records.sort((a, b) => parseFloat(a.rank) - parseFloat(b.rank));
        GM_setValue('aredl_theo_v15', records);
    }

    // AUTO-SYNC ENGINE: Checks saved theoretical levels against fresh API data to update shifted ranks and decayed points
    async function syncRecordsWithApi() {
        const apiData = await fetchAredlApi();
        if (!apiData) return;

        let records = getCustomRecords();
        let changed = false;

        records.forEach(rec => {
            const cleanRecName = cleanString(rec.name);
            
            // STRICT ID MATCHING FIX: Prevents name collisions
            const apiMatch = apiData.find(l => {
                if (rec.level_id && l.level_id) {
                    return String(l.level_id) === String(rec.level_id);
                }
                return cleanString(l.name) === cleanRecName;
            });
            
            if (apiMatch) {
                const newRank = apiMatch.position;
                const newPoints = apiMatch.points / 10;
                
                if (rec.rank !== newRank || rec.points !== newPoints) {
                    rec.rank = newRank;
                    rec.points = newPoints;
                    changed = true;
                }
            }
        });

        if (changed) {
            saveCustomRecords(records);
            if (isMyProfilePage() && !window.location.search.includes('tab=packs')) {
                render(); // Instantly refresh UI if you are viewing your profile
            }
        }
    }

    function getLegitCompletions() { return GM_getValue('aredl_legit_completions_v1', ['bloodbath', 'conical depression', 'the ultimate demon', 'cataclysm']); }
    function saveLegitCompletions(list) { GM_setValue('aredl_legit_completions_v1', list); }

    function getBaseHardest() {
        return GM_getValue('aredl_base_hardest_v2', { globalRank: 11368, countryRank: 98, levelPosition: 832 });
    }
    function saveBaseHardest(data) { GM_setValue('aredl_base_hardest_v2', data); }

    function getTTLCache(key) {
        try {
            const item = localStorage.getItem(key);
            if (!item) return null;
            const parsed = JSON.parse(item);
            if (Date.now() - parsed.timestamp > CACHE_TTL_MS) {
                localStorage.removeItem(key);
                return null;
            }
            return parsed.data;
        } catch (e) {
            return null;
        }
    }

    function setTTLCache(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), data }));
        } catch (e) {}
    }

    const style = document.createElement('style');
    style.innerHTML = `
        /* Main FAB & Modals */
        .aredl-fab {
            position: fixed; bottom: 30px; right: 30px;
            background: #ff9800; color: #121316; border: none;
            border-radius: 50px; padding: 12px 24px; font-size: 13px; font-weight: 800;
            cursor: pointer; box-shadow: 0 4px 15px rgba(255, 152, 0, 0.4);
            z-index: 99999; transition: transform 0.2s, box-shadow 0.2s;
            display: flex; align-items: center; gap: 8px; font-family: sans-serif;
        }
        .aredl-fab:hover { transform: scale(1.05); box-shadow: 0 6px 20px rgba(255, 152, 0, 0.6); }
        .theo-pts-badge {
            background: rgba(0,0,0,0.6); color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px;
        }
        .theo-modal-overlay {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.8);
            z-index: 100000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px);
        }
        .theo-modal {
            background: #1a1c23; border: 1px solid #ff9800; border-radius: 10px; padding: 24px; width: 440px; 
            display: flex; flex-direction: column; gap: 14px; box-shadow: 0 10px 30px rgba(255, 152, 0, 0.2); font-family: sans-serif; color: white;
        }
        .theo-input-group { display: flex; flex-direction: column; gap: 6px; position: relative; }
        .theo-modal input[type="text"], .theo-modal input[type="date"] {
            background: #252830; border: 1px solid #444; color: white; padding: 10px 12px; border-radius: 6px; font-size: 14px; width: 100%; box-sizing: border-box;
            color-scheme: dark;
        }
        .theo-modal input:focus { outline: none; border-color: #ff9800; }
        .theo-modal label { font-size: 12px; color: #aaa; font-weight: bold; }
        .theo-checkbox-group { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #eee; cursor: pointer; user-select: none; }
        .theo-checkbox-group input { width: 16px; height: 16px; cursor: pointer; accent-color: #ff9800; }
        .theo-autocomplete-list {
            position: absolute; top: calc(100% + 4px); left: 0; right: 0; max-height: 180px; overflow-y: auto; background: #1f222b; border: 1px solid #ff9800; border-radius: 6px; z-index: 100001; display: none; box-shadow: 0 8px 20px rgba(0,0,0,0.6);
        }
        .theo-autocomplete-item { padding: 10px 14px; font-size: 13px; cursor: pointer; border-bottom: 1px solid #2a2d37; display: flex; justify-content: space-between; align-items: center; color: #eee; transition: 0.15s; }
        .theo-autocomplete-item:last-child { border-bottom: none; }
        .theo-autocomplete-item:hover { background: #ff9800; color: #121316; font-weight: bold; }
        .theo-autocomplete-item:hover span { color: #121316 !important; }
        .theo-modal-btns { display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; }
        .theo-btn-cancel { background: transparent; border: 1px solid #666; color: #ccc; padding: 8px 18px; border-radius: 6px; cursor: pointer; font-weight: 600; }
        .theo-btn-save { background: #ff9800; border: none; color: #000; font-weight: bold; padding: 8px 18px; border-radius: 6px; cursor: pointer; }
        
        .theo-menu-container { position: absolute; top: 10px; left: 10px; z-index: 200; font-family: sans-serif; }
        .theo-menu-btn { background: rgba(0, 0, 0, 0.6); color: #fff; border: 1px solid rgba(255, 152, 0, 0.4); border-radius: 4px; width: 26px; height: 26px; font-size: 14px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s; }
        .theo-menu-btn:hover { background: #ff9800; color: #000; border-color: #ff9800; }
        .theo-global-dropdown { position: fixed; background: #1a1c23; border: 1px solid #ff9800; border-radius: 6px; box-shadow: 0 10px 25px rgba(0,0,0,0.8); display: none; flex-direction: column; min-width: 130px; overflow: hidden; z-index: 999999; font-family: sans-serif; }
        .theo-global-dropdown button { background: transparent; border: none; color: #fff; padding: 10px 14px; font-size: 13px; text-align: left; cursor: pointer; transition: 0.15s; font-weight: 600; }
        .theo-global-dropdown button:hover { background: #ff9800; color: #000; }
        .theo-global-dropdown button.delete-action { color: #ff6b6b; }
        .theo-global-dropdown button.delete-action:hover { background: #ff6b6b; color: #fff; }
        .aredl-forced-flex { display: flex !important; flex-direction: column !important; gap: 8px !important; width: 100% !important; }

        /* HUD Styling */
        .theo-lb-pill { position: fixed; bottom: 25px; left: 25px; background: #161820; border: 1.5px solid #ff9800; border-radius: 12px; box-shadow: 0 12px 35px rgba(0,0,0,0.85); z-index: 99999; font-family: sans-serif; color: #fff; backdrop-filter: blur(10px); transition: all 0.2s ease-in-out; }
        .theo-lb-pill.minimized { padding: 10px 16px; cursor: pointer; border-radius: 50px; display: flex; align-items: center; gap: 10px; }
        .theo-lb-pill.minimized:hover { background: #202430; transform: scale(1.04); }
        .theo-lb-pill.expanded { padding: 22px 24px; width: 460px; display: flex; flex-direction: column; gap: 16px; }

        /* Unified Monospace Theo Tag */
        .theo-universal-badge {
            font-size: 11px !important;
            font-weight: 800 !important;
            color: #fff !important;
            background: #d97706 !important;
            border: 1px solid #d97706 !important;
            border-radius: 4px !important;
            padding: 2px 6px !important;
            margin-left: 8px !important;
            font-family: monospace !important;
            vertical-align: middle !important;
            text-transform: none !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            line-height: 1.1 !important;
            box-shadow: 0 1px 3px rgba(0,0,0,0.4) !important;
            text-shadow: none !important;
        }

        /* Sidebar Badges */
        .theo-sidebar-badge {
            font-size: 11px; font-weight: 800; padding: 3px 7px; border-radius: 4px; margin-left: 8px; flex-shrink: 0;
            transition: all 0.2s ease; font-family: monospace; display: inline-flex; align-items: center; justify-content: center; line-height: 1.1;
        }
        .theo-sidebar-badge.prog-0 { background: #252830; color: #aaa; border: 1px solid #444; }
        .theo-sidebar-badge.prog-1 { background: rgba(220, 53, 69, 0.15); color: #ff6b6b; border: 1px solid rgba(220, 53, 69, 0.4); }
        .theo-sidebar-badge.prog-2 { background: rgba(253, 126, 20, 0.15); color: #fd7e14; border: 1px solid rgba(253, 126, 20, 0.4); }
        .theo-sidebar-badge.prog-3 { background: rgba(255, 193, 7, 0.15); color: #ffc107; border: 1px solid rgba(255, 193, 7, 0.4); }
        .theo-sidebar-badge.prog-4 { background: rgba(40, 167, 69, 0.15); color: #28a745; border: 1px solid rgba(40, 167, 69, 0.4); }
        .theo-sidebar-badge.prog-5 { background: rgba(23, 162, 184, 0.15); color: #17a2b8; border: 1px solid rgba(23, 162, 184, 0.4); }
        .theo-sidebar-badge.completed { background: #d97706; color: #fff; border: 1px solid #d97706; box-shadow: 0 1px 3px rgba(0,0,0,0.4); }

        /* Profile Packs Container */
        .theo-isolated-pack-container {
            display: flex; flex-direction: column; gap: 8px; width: 100%; position: relative; z-index: 10; margin-top: 8px;
        }

        /* Color Overrides for Pack Levels */
        .theo-level-colored,
        .theo-level-colored *,
        .theo-level-colored img {
            filter: none !important;
            -webkit-filter: none !important;
            opacity: 1 !important;
        }

        .theo-pack-level-incomplete { filter: grayscale(100%) !important; opacity: 1 !important; transition: filter 0.2s ease-in-out; }
        .theo-hide-native-counter { display: none !important; }
    `;
    document.head.appendChild(style);

    // --- DYNAMIC ISOLATION LOGIC ---
    function isMyProfilePage() {
        const target = getTargetUsername().toLowerCase();
        return window.location.pathname.toLowerCase().includes(`/profile/user/${target}`);
    }
    function isOtherProfilePage() {
        return window.location.pathname.includes('/profile/') && !isMyProfilePage();
    }
    function isPacksPage() { return window.location.pathname.includes('/packs'); }
    function isLeaderboardPage() { return window.location.pathname.includes('/leaderboard'); }

    async function fetchPackTiers() {
        const cached = getTTLCache('aredl_pack_tiers_ttl');
        if (cached) return cached;
        try {
            const res = await fetch(PACK_TIERS_URL);
            const data = await res.json();
            setTTLCache('aredl_pack_tiers_ttl', data);
            return data;
        } catch (e) { return []; }
    }

    async function fetchAredlApi() {
        const cached = getTTLCache('aredl_api_cache_ttl');
        if (cached) return cached;
        try {
            const response = await fetch(AREDL_API_URL);
            const data = await response.json();
            setTTLCache('aredl_api_cache_ttl', data);
            return data;
        } catch (e) { return null; }
    }

    // Fetches the active player's metadata (country, baseline stats) dynamically
    async function fetchActiveUserData() {
        const username = getTargetUsername();
        const cacheKey = `aredl_user_meta_${cleanString(username)}`;
        const cached = getTTLCache(cacheKey);
        if (cached) return cached;
        try {
            const res = await fetch(`${LB_API_BASE}?name_filter=${encodeURIComponent(username)}&per_page=20`);
            const json = await res.json();
            const match = (json.data || []).find(p => cleanString(p.name) === cleanString(username));
            if (match) {
                setTTLCache(cacheKey, match);
                return match;
            }
        } catch (e) {}
        return null;
    }

    function getCompletedLevelIdentifiers() {
        const pool = new Set(getLegitCompletions().map(cleanString));
        getCustomRecords().forEach(r => {
            if (r.name) pool.add(cleanString(r.name));
            if (r.level_id) pool.add(String(r.level_id));
        });
        return pool;
    }

    async function evaluateCompletedPacks() {
        const tiers = await fetchPackTiers();
        const completedPool = getCompletedLevelIdentifiers();
        const earnedPacks = [];
        let totalPoints = 0;

        tiers.forEach(tier => {
            (tier.packs || []).forEach(pack => {
                const levels = pack.levels || [];
                if (levels.length > 0) {
                    const isAllBeat = levels.every(lvl => {
                        return completedPool.has(cleanString(lvl.name)) || completedPool.has(String(lvl.level_id));
                    });
                    if (isAllBeat) {
                        const pts = (pack.points || 0) / 10;
                        earnedPacks.push({
                            id: pack.id, name: pack.name, points: pts, tier: tier.name, levels: levels
                        });
                        totalPoints += pts;
                    }
                }
            });
        });

        earnedPacks.sort((a, b) => b.points - a.points);
        return { earnedPacks, totalPoints };
    }

    async function getNationalRoster(countryId) {
        const cId = countryId || 203; 
        const cacheKey = `aredl_roster_${cId}_ttl`;
        const cached = getTTLCache(cacheKey);
        if (cached) return cached;
        try {
            const firstRes = await fetch(`${LB_API_BASE}?page=1&per_page=20&name_filter=%25%25&order=TotalPoints&country_filter=${cId}`);
            const firstData = await firstRes.json();
            const totalPages = firstData.pages || 10;
            let allPlayers = [...(firstData.data || [])];
            const fetchBatch = async (start, end) => {
                const batch = [];
                for (let i = start; i <= end; i++) {
                    batch.push(
                        fetch(`${LB_API_BASE}?page=${i}&per_page=20&name_filter=%25%25&order=TotalPoints&country_filter=${cId}`)
                            .then(r => r.json()).then(d => d.data || []).catch(() => [])
                    );
                }
                const results = await Promise.all(batch);
                results.forEach(arr => allPlayers.push(...arr));
            };
            await fetchBatch(2, Math.min(totalPages, 7));
            if (totalPages > 7) await fetchBatch(8, totalPages);
            setTTLCache(cacheKey, allPlayers);
            return allPlayers;
        } catch (e) { return []; }
    }

    async function getExactNationalRanks(targetPtsRaw, targetPtsTotal, targetExtremes, theoreticalBestPosition, countryId) {
        const roster = await getNationalRoster(countryId);
        const base = getBaseHardest();
        if (!roster || roster.length === 0) return { raw: null, total: null, extremes: null, hardest: base.countryRank };

        const targetScaledRaw = Math.round(targetPtsRaw * 10);
        const targetScaledTotal = Math.round(targetPtsTotal * 10);
        let strictlyHigherRaw = 0, strictlyHigherTotal = 0, strictlyHigherExtremes = 0;

        for (let i = 0; i < roster.length; i++) {
            const p = roster[i];
            const playerTotalPts = p.total_points ?? 0;
            const playerRawPts = playerTotalPts - (p.pack_points ?? 0);
            const playerExtremes = p.extremes ?? 0;

            if (playerRawPts > targetScaledRaw) strictlyHigherRaw++;
            if (playerTotalPts > targetScaledTotal) strictlyHigherTotal++;
            if (playerExtremes > targetExtremes) strictlyHigherExtremes++;
        }

        let calculatedHardest = base.countryRank;
        if (theoreticalBestPosition < base.levelPosition) {
            const allLevels = await fetchAredlApi();
            if (allLevels) {
                const levelPosMap = new Map();
                allLevels.forEach(l => { if (l.level_id) levelPosMap.set(l.level_id, l.position); });
                let higherHardestCount = 0;
                for (let p of roster) {
                    let pLevelPos = 999999;
                    if (p.hardest && p.hardest.level_id && levelPosMap.has(p.hardest.level_id)) pLevelPos = levelPosMap.get(p.hardest.level_id);
                    if (pLevelPos < theoreticalBestPosition) higherHardestCount++;
                }
                calculatedHardest = higherHardestCount + 1;
            }
        }
        return { raw: strictlyHigherRaw + 1, total: strictlyHigherTotal + 1, extremes: strictlyHigherExtremes + 1, hardest: calculatedHardest };
    }

    async function findGlobalPointsRank(targetPoints, withPacks = true) {
        const cacheKey = `theo_global_pts_${withPacks ? 'total' : 'raw'}_${targetPoints.toFixed(1)}`;
        const cached = getTTLCache(cacheKey);
        if (cached) return cached;
        try {
            const baseUrl = `${LB_API_BASE}?per_page=20&name_filter=%25%25&order=TotalPoints`;
            const targetScaled = Math.round(targetPoints * 10);
            let low = 250, high = 550, bestRank = 7000, iterations = 0;
            const extractPts = (p) => withPacks ? (p.total_points ?? 0) : ((p.total_points ?? 0) - (p.pack_points ?? 0));
            const extractRank = (p, pageIdx, itemIdx) => withPacks ? (p.rank ?? ((pageIdx - 1) * 20 + itemIdx + 1)) : (p.raw_rank ?? p.rank ?? ((pageIdx - 1) * 20 + itemIdx + 1));

            while (low <= high && iterations < 6) {
                iterations++;
                const mid = Math.floor((low + high) / 2);
                const res = await fetch(`${baseUrl}&page=${mid}`);
                const data = await res.json();
                const players = data.data || [];
                if (players.length === 0) break;

                const firstPts = extractPts(players[0]);
                const lastPts = extractPts(players[players.length - 1]);

                if (targetScaled > firstPts) {
                    high = mid - 1; bestRank = extractRank(players[0], mid, 0);
                } else if (targetScaled < lastPts) {
                    low = mid + 1; bestRank = extractRank(players[players.length - 1], mid, players.length - 1) + 1;
                } else {
                    for (let i = 0; i < players.length; i++) {
                        if (targetScaled >= extractPts(players[i])) {
                            bestRank = extractRank(players[i], mid, i);
                            break;
                        }
                    }
                    break;
                }
            }
            setTTLCache(cacheKey, bestRank);
            return bestRank;
        } catch (e) { return null; }
    }

    async function findGlobalExtremesRank(targetExtremes) {
        const cacheKey = `theo_global_ext_${targetExtremes}`;
        const cached = getTTLCache(cacheKey);
        if (cached) return cached;
        try {
            const baseUrl = `${LB_API_BASE}?per_page=20&name_filter=%25%25&order=ExtremeCount`;
            let low = 200, high = 650, bestRank = 8000, iterations = 0;
            while (low <= high && iterations < 6) {
                iterations++;
                const mid = Math.floor((low + high) / 2);
                const res = await fetch(`${baseUrl}&page=${mid}`);
                const data = await res.json();
                const players = data.data || [];
                if (players.length === 0) break;

                const firstExt = players[0].extremes ?? 0;
                const lastExt = players[players.length - 1].extremes ?? 0;

                if (targetExtremes > firstExt) {
                    high = mid - 1; bestRank = players[0].extremes_rank ?? ((mid - 1) * 20 + 1);
                } else if (targetExtremes < lastExt) {
                    low = mid + 1; bestRank = (players[players.length - 1].extremes_rank ?? (mid * 20)) + 1;
                } else {
                    for (let i = 0; i < players.length; i++) {
                        if (targetExtremes >= (players[i].extremes ?? 0)) {
                            bestRank = players[i].extremes_rank ?? ((mid - 1) * 20 + i + 1);
                            break;
                        }
                    }
                    break;
                }
            }
            setTTLCache(cacheKey, bestRank);
            return bestRank;
        } catch (e) { return null; }
    }

    async function findGlobalHardestRank(theoreticalBestPosition) {
        const base = getBaseHardest();
        if (theoreticalBestPosition >= base.levelPosition) return base.globalRank;
        const cacheKey = `theo_global_hrd_${theoreticalBestPosition}`;
        const cached = getTTLCache(cacheKey);
        if (cached) return cached;
        try {
            const baseUrl = `${LB_API_BASE}?per_page=20&name_filter=%25%25&order=Hardest`;
            let low = 1, high = 600, bestRank = base.globalRank, iterations = 0;
            const allLevels = await fetchAredlApi();
            const levelPosMap = new Map();
            if (allLevels) allLevels.forEach(l => { if (l.level_id) levelPosMap.set(l.level_id, l.position); });

            while (low <= high && iterations < 7) {
                iterations++;
                const mid = Math.floor((low + high) / 2);
                const res = await fetch(`${baseUrl}&page=${mid}`);
                const data = await res.json();
                const players = data.data || [];
                if (players.length === 0) break;

                const getPlayerListPos = (p) => {
                    if (p.hardest && p.hardest.level_id && levelPosMap.has(p.hardest.level_id)) return levelPosMap.get(p.hardest.level_id);
                    return 999999;
                };

                const firstPos = getPlayerListPos(players[0]);
                const lastPos = getPlayerListPos(players[players.length - 1]);

                if (theoreticalBestPosition < firstPos) {
                    high = mid - 1; bestRank = (mid - 1) * 20 + 1;
                } else if (theoreticalBestPosition > lastPos) {
                    low = mid + 1; bestRank = mid * 20 + 1;
                } else {
                    for (let i = 0; i < players.length; i++) {
                        if (theoreticalBestPosition <= getPlayerListPos(players[i])) {
                            bestRank = (mid - 1) * 20 + i + 1;
                            break;
                        }
                    }
                    break;
                }
            }
            setTTLCache(cacheKey, bestRank);
            return bestRank;
        } catch (e) { return base.globalRank; }
    }

    function findTemplateCard() {
        if (!isMyProfilePage()) return null;
        const links = Array.from(document.querySelectorAll('a[href*="youtube.com"], a[href*="youtu.be"]'));
        const validLinks = links.filter(a => {
            let p = a.parentElement;
            while(p && p.tagName !== 'BODY') {
                if (p.textContent.includes('points') && p.textContent.match(/#\d+/)) return true;
                p = p.parentElement;
            }
            return false;
        });
        if (validLinks.length >= 2) {
            let lca = validLinks[0].parentElement;
            while (lca && lca.tagName !== 'BODY') {
                if (lca.contains(validLinks[1])) break;
                lca = lca.parentElement;
            }
            if (lca && lca.tagName !== 'BODY') {
                let templateRow = validLinks[0];
                while (templateRow.parentElement && templateRow.parentElement !== lca) {
                    templateRow = templateRow.parentElement;
                }
                return { card: templateRow, listContainer: lca };
            }
        }
        for (let a of validLinks) {
            let card = a.closest('div');
            while (card && card.tagName !== 'BODY') {
                if (card.textContent.match(/#\d+/) && card.textContent.match(/\+\d+(\.\d+)?\s*points/)) {
                    if (card.querySelectorAll('a[href*="youtu"]').length === 1) return { card: card, listContainer: card.parentElement };
                }
                card = card.parentElement;
            }
        }
        return null;
    }

    function extractTemplateData(card) {
        const text = card.textContent;
        const rankMatch = text.match(/#\d+/);
        const pointsMatch = text.match(/\+\d+(\.\d+)?\s+points/);
        let name = null;
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null, false);
        let node; let longest = "";
        while ((node = walker.nextNode())) {
            let val = node.nodeValue.trim();
            if (val.length > 2 && val !== (rankMatch?.[0]) && !val.includes('points') && !val.includes('/') && val.length > longest.length) longest = val;
        }
        return { rank: rankMatch?.[0], pointsStr: pointsMatch?.[0], name: longest };
    }

    async function openModal(editRecord = null) {
        if (document.getElementById('theo-modal')) return;
        const fab = document.getElementById('theo-fab');
        let originalText = '';
        if (fab) { originalText = fab.innerHTML; fab.innerHTML = 'Loading API...'; }

        const apiData = await fetchAredlApi();
        if (fab) fab.innerHTML = originalText;
        if (!apiData) return alert("Could not load AREDL API. Try again.");

        const isEditing = editRecord !== null;
        const records = getCustomRecords();
        const hiddenRecords = records.filter(r => r.hidden);

        const overlay = document.createElement('div');
        overlay.id = 'theo-modal';
        overlay.className = 'theo-modal-overlay';
        overlay.innerHTML = `
            <div class="theo-modal">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="margin:0; color:#ff9800; font-size:18px;">${isEditing ? 'Edit Theoretical Record' : 'Add Theoretical Record'}</h3>
                </div>

                <!-- Quick User Profile Configurator -->
                <div style="display:flex; justify-content:space-between; align-items:center; background:#20232c; border:1px solid #333; padding:8px 12px; border-radius:6px; font-size:12px;">
                    <span>Active Profile: <strong style="color:#ff9800;">${getTargetUsername()}</strong></span>
                    <button id="tm-change-user-btn" style="background:transparent; border:1px solid #ff9800; color:#ff9800; border-radius:4px; padding:2px 8px; cursor:pointer; font-weight:bold; font-size:11px;">Change</button>
                </div>

                <div class="theo-input-group" ${isEditing ? 'style="opacity:0.6; pointer-events:none;"' : ''}>
                    <label>Level Name</label>
                    <input type="text" id="tm-name" value="${isEditing ? editRecord.name : ''}" placeholder="Type to search levels..." autocomplete="off">
                    <div id="tm-autocomplete" class="theo-autocomplete-list"></div>
                </div>
                
                <div style="display:flex; gap: 10px;">
                    <div class="theo-input-group" style="flex: 2;">
                        <label>Your Completion Video</label>
                        <input type="text" id="tm-my-yt" value="${isEditing ? (editRecord.yt || '') : ''}" placeholder="https://youtube.com/watch?v=...">
                    </div>
                    <div class="theo-input-group" style="flex: 1;">
                        <label>Date</label>
                        <input type="date" id="tm-date" value="${isEditing ? (editRecord.date_raw || '') : ''}">
                    </div>
                </div>

                <label class="theo-checkbox-group">
                    <input type="checkbox" id="tm-hidden" ${isEditing && editRecord.hidden ? 'checked' : ''}>
                    <span>Hide from Profile View (Still counts for Packs)</span>
                </label>
                
                ${!isEditing && hiddenRecords.length > 0 ? `
                    <div id="tm-hidden-list-section" style="border-top:1px solid #333; padding-top:10px; margin-top:4px;">
                        <label style="color:#ff9800;">Currently Hidden Levels (${hiddenRecords.length}):</label>
                        <div style="max-height:90px; overflow-y:auto; display:flex; flex-direction:column; gap:4px; margin-top:6px;">
                            ${hiddenRecords.map(hr => `
                                <div style="display:flex; justify-content:space-between; align-items:center; background:#252830; padding:4px 8px; border-radius:4px; font-size:12px;">
                                    <span>${hr.name} (#${hr.rank})</span>
                                    <button data-unhide="${hr.name}" class="tm-quick-unhide" style="background:transparent; border:none; color:#ff9800; font-size:11px; cursor:pointer; font-weight:bold;">Unhide</button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                <div class="theo-modal-btns">
                    <button class="theo-btn-cancel" id="tm-cancel">Cancel</button>
                    <button class="theo-btn-save" id="tm-save">${isEditing ? 'Update Record' : 'Save Record'}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('tm-change-user-btn').onclick = () => {
            const current = getTargetUsername();
            const input = prompt("Enter your AREDL username (as it appears in your profile URL):", current);
            if (input && input.trim() && input.trim() !== current) {
                setTargetUsername(input.trim());
                overlay.remove();
                window.location.reload();
            }
        };

        overlay.querySelectorAll('.tm-quick-unhide').forEach(btn => {
            btn.onclick = () => {
                const name = btn.getAttribute('data-unhide');
                const target = records.find(r => r.name === name);
                if (target) {
                    target.hidden = false;
                    saveCustomRecords(records);
                    overlay.remove();
                    render();
                }
            };
        });

        let selectedLevel = isEditing ? apiData.find(l => l.name.toLowerCase() === editRecord.name.toLowerCase()) : null;
        const nameInput = document.getElementById('tm-name');
        const autocompleteList = document.getElementById('tm-autocomplete');

        if (!isEditing) {
            nameInput.oninput = () => {
                const query = nameInput.value.trim().toLowerCase();
                autocompleteList.innerHTML = '';
                selectedLevel = null;
                if (query.length === 0) { autocompleteList.style.display = 'none'; return; }
                const filtered = apiData.filter(l => l.name.toLowerCase().includes(query)).slice(0, 10);
                if (filtered.length === 0) { autocompleteList.style.display = 'none'; return; }

                filtered.forEach(level => {
                    const item = document.createElement('div');
                    item.className = 'theo-autocomplete-item';
                    item.innerHTML = `<span>${level.name}</span> <span style="color:#ff9800; font-weight:bold;">#${level.position}</span>`;
                    item.onclick = () => {
                        nameInput.value = level.name;
                        selectedLevel = level;
                        autocompleteList.style.display = 'none';
                    };
                    autocompleteList.appendChild(item);
                });
                autocompleteList.style.display = 'block';
            };
        }

        document.onclick = (e) => {
            const modalEl = document.getElementById('theo-modal');
            if (!modalEl) return;
            if (!modalEl.contains(e.target)) autocompleteList.style.display = 'none';
        };

        document.getElementById('tm-cancel').onclick = () => overlay.remove();
        document.getElementById('tm-save').onclick = () => {
            const myYt = document.getElementById('tm-my-yt').value.trim();
            const dateRaw = document.getElementById('tm-date').value;
            const isHidden = document.getElementById('tm-hidden').checked;
            const current = getCustomRecords();
            
            // Format custom date
            let formattedDate = 'Local';
            if (dateRaw) {
                const [y, m, d] = dateRaw.split('-');
                formattedDate = `${parseInt(m)}/${parseInt(d)}/${y}`;
            } else {
                const today = new Date();
                formattedDate = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
            }

            if (isEditing) {
                const target = current.find(r => r.name === editRecord.name);
                if (target) { 
                    target.yt = myYt; 
                    target.hidden = isHidden; 
                    target.date = formattedDate;
                    target.date_raw = dateRaw || '';
                    saveCustomRecords(current); 
                }
            } else {
                const inputName = nameInput.value.trim();
                if (!inputName) return alert("Please enter a level name.");
                const matchedLevel = selectedLevel || apiData.find(l => cleanString(l.name) === cleanString(inputName));
                if (!matchedLevel) return alert(`Error: "${inputName}" was not found in the AREDL database. Please select it from the dropdown.`);
                if (current.some(r => cleanString(r.name) === cleanString(matchedLevel.name))) return alert(`You already added ${matchedLevel.name} to your theoretical list!`);

                current.push({
                    name: matchedLevel.name, 
                    rank: matchedLevel.position, 
                    points: matchedLevel.points / 10,
                    level_id: matchedLevel.level_id, 
                    yt: myYt, 
                    hidden: isHidden,
                    date: formattedDate,
                    date_raw: dateRaw || ''
                });
                saveCustomRecords(current);
            }
            overlay.remove();
            document.querySelectorAll('.theo-clone').forEach(el => el.remove());
            render();
        };
    }

    async function updateProfileStats(totalTheoPoints, theoCount) {
        if (!isMyProfilePage()) return;
        const { earnedPacks, totalPoints: autoPackPoints } = await evaluateCompletedPacks();

        let currentBasePts = 81.0;
        let baseExtremes = 4;
        const legitNames = new Set();
        document.querySelectorAll('div').forEach(card => {
            let t = card.textContent;
            if (t.includes('#') && t.includes('points') && !card.classList.contains('theo-clone')) {
                const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null, false);
                let node; let longest = "";
                while ((node = walker.nextNode())) {
                    let val = node.nodeValue.trim();
                    if (val.length > 2 && !val.match(/#\d+/) && !val.includes('points') && !val.includes('/') && val.length > longest.length) longest = val;
                }
                if (longest) legitNames.add(cleanString(longest));
            }
        });
        if (legitNames.size > 0) saveLegitCompletions(Array.from(legitNames));

        const pTags = document.querySelectorAll('p');
        pTags.forEach(p => {
            const text = p.textContent.trim().toUpperCase();
            if (text === 'LEVEL POINTS' || text === 'TOTAL POINTS' || text === 'PACK POINTS') {
                const span = p.nextElementSibling;
                if (span && span.tagName === 'SPAN') {
                    const targetEl = span.querySelector('button') || span;
                    if (!targetEl.hasAttribute('data-original-pts')) {
                        const cleanText = targetEl.textContent.replace(/,/g, '');
                        const numMatch = cleanText.match(/[\d.]+/);
                        targetEl.setAttribute('data-original-pts', numMatch ? numMatch[0] : (text === 'PACK POINTS' ? '0' : '81.0'));
                    }
                    const originalPts = parseFloat(targetEl.getAttribute('data-original-pts'));
                    if (!isNaN(originalPts)) {
                        if (text === 'LEVEL POINTS') currentBasePts = originalPts;
                        let addedVal = 0;
                        if (text === 'LEVEL POINTS') addedVal = totalTheoPoints;
                        else if (text === 'PACK POINTS') addedVal = autoPackPoints;
                        else if (text === 'TOTAL POINTS') addedVal = totalTheoPoints + autoPackPoints;

                        if (addedVal > 0) {
                            const combinedTotal = (originalPts + addedVal).toFixed(1);
                            targetEl.textContent = `${combinedTotal} (${originalPts > 0 ? originalPts : '-'})`;
                            targetEl.style.color = '#ff9800';
                            targetEl.style.whiteSpace = 'nowrap';
                        } else {
                            targetEl.textContent = originalPts > 0 ? originalPts : '-';
                            targetEl.style.color = '';
                        }
                    }
                }
            }
        });

        const allDivs = document.querySelectorAll('div, span, h2, h3');
        allDivs.forEach(el => {
            if (el.children.length === 0) {
                let txt = el.textContent.trim();
                if (/^COMPLETED\s*\(.*\)$/i.test(txt)) {
                    if (!el.hasAttribute('data-original-count')) {
                        const m = txt.match(/\d+/);
                        el.setAttribute('data-original-count', m ? m[0] : '4');
                    }
                    const orig = parseInt(el.getAttribute('data-original-count'), 10);
                    if (!isNaN(orig)) {
                        baseExtremes = orig;
                        el.textContent = `COMPLETED (${orig + theoCount} [${orig}])`;
                        el.style.color = '#ff9800';
                    }
                }
                else if (/^CLASSIC\s*\(.*\)$/i.test(txt)) {
                    if (!el.hasAttribute('data-original-classic')) {
                        const m = txt.match(/\d+/);
                        el.setAttribute('data-original-classic', m ? m[0] : '4');
                    }
                    const origClassic = parseInt(el.getAttribute('data-original-classic'), 10);
                    if (!isNaN(origClassic)) {
                        el.textContent = `CLASSIC (${origClassic + theoCount} [${origClassic}])`;
                        el.style.color = '#ff9800';
                    }
                }
                else if (/^PACKS\s*\(.*\)$/i.test(txt)) {
                    if (!el.hasAttribute('data-original-packs')) {
                        const m = txt.match(/\d+/);
                        el.setAttribute('data-original-packs', m ? m[0] : '0');
                    }
                    const origPacks = parseInt(el.getAttribute('data-original-packs'), 10);
                    if (!isNaN(origPacks)) {
                        el.textContent = `PACKS (${origPacks + earnedPacks.length} [${origPacks}])`;
                        el.style.color = '#ff9800';
                    }
                }
            }
        });

        let bestTheoreticalPosition = 999999;
        const visibleRecords = getCustomRecords().filter(r => !r.hidden);
        visibleRecords.forEach(r => {
            const rPos = parseInt(r.rank, 10);
            if (!isNaN(rPos) && rPos < bestTheoreticalPosition) bestTheoreticalPosition = rPos;
        });

        const hrdRankRows = Array.from(document.querySelectorAll('span, p')).filter(el => el.textContent.trim().toUpperCase() === 'HARDEST LEVEL RANK');
        if (hrdRankRows.length >= 2) {
            const gRow = hrdRankRows[0].parentElement?.querySelector('span:last-child, p:last-child');
            const cRow = hrdRankRows[1].parentElement?.querySelector('span:last-child, p:last-child');
            const gMatch = gRow?.textContent.match(/#(\d+)/);
            const cMatch = cRow?.textContent.match(/#(\d+)/);
            if (gMatch && cMatch) {
                saveBaseHardest({
                    globalRank: parseInt(gMatch[1], 10),
                    countryRank: parseInt(cMatch[1], 10),
                    levelPosition: 832
                });
            }
        }

        const finalExtremesTotal = baseExtremes + theoCount;
        const finalPtsRaw = currentBasePts + totalTheoPoints;
        const finalPtsTotal = currentBasePts + totalTheoPoints + autoPackPoints;

        // Auto-detect player metadata for exact national leaderboard calculations
        const userMeta = await fetchActiveUserData();
        const countryId = userMeta?.country?.id || 203;

        const [natRanks, theoGlobalRaw, theoGlobalTotal, theoGlobalExtremes, theoGlobalHardest] = await Promise.all([
            getExactNationalRanks(finalPtsRaw, finalPtsTotal, finalExtremesTotal, bestTheoreticalPosition, countryId),
            findGlobalPointsRank(finalPtsRaw, false),
            findGlobalPointsRank(finalPtsTotal, true),
            findGlobalExtremesRank(finalExtremesTotal),
            findGlobalHardestRank(bestTheoreticalPosition)
        ]);

        const rawRankRows = Array.from(document.querySelectorAll('span, p')).filter(el => el.textContent.trim().toUpperCase() === 'POINTS RANK');
        const packRankRows = Array.from(document.querySelectorAll('span, p')).filter(el => el.textContent.trim().toUpperCase() === 'POINTS RANK (WITH PACKS)');
        const extRankRows = Array.from(document.querySelectorAll('span, p')).filter(el => el.textContent.trim().toUpperCase() === 'EXTREMES COUNT RANK');

        const applyRank = (labelEl, newRankVal) => {
            if (!labelEl || !newRankVal) return;
            const row = labelEl.parentElement;
            if (!row) return;

            const rankValEl = row.querySelector('span:last-child, p:last-child');
            if (rankValEl && rankValEl !== labelEl) {
                if (!rankValEl.hasAttribute('data-original-rank')) {
                    const m = rankValEl.textContent.match(/#\d+/);
                    if (m) rankValEl.setAttribute('data-original-rank', m[0]);
                }
                const origRank = rankValEl.getAttribute('data-original-rank');
                if (origRank) {
                    rankValEl.textContent = `#${newRankVal} (${origRank})`;
                    rankValEl.style.color = '#ff9800';
                    rankValEl.style.whiteSpace = 'nowrap';
                }
            }
        };

        if (rawRankRows[0]) applyRank(rawRankRows[0], theoGlobalRaw);
        if (packRankRows[0]) applyRank(packRankRows[0], theoGlobalTotal);
        if (extRankRows[0]) applyRank(extRankRows[0], theoGlobalExtremes);
        if (hrdRankRows[0]) applyRank(hrdRankRows[0], theoGlobalHardest);
        if (rawRankRows[1]) applyRank(rawRankRows[1], natRanks.raw);
        if (packRankRows[1]) applyRank(packRankRows[1], natRanks.total);
        if (extRankRows[1]) applyRank(extRankRows[1], natRanks.extremes);
        if (hrdRankRows[1]) applyRank(hrdRankRows[1], natRanks.hardest);
    }

    let globalDropdown = document.getElementById('theo-global-dropdown');
    if (!globalDropdown) {
        globalDropdown = document.createElement('div');
        globalDropdown.id = 'theo-global-dropdown';
        globalDropdown.className = 'theo-global-dropdown';
        document.body.appendChild(globalDropdown);
    }

    function render() {
        if (!isMyProfilePage()) return;
        const target = findTemplateCard();
        if (!target) return;
        const { card: templateCard, listContainer } = target;

        listContainer.classList.add('aredl-forced-flex');

        if (!document.getElementById('theo-fab')) {
            const fab = document.createElement('button');
            fab.id = 'theo-fab';
            fab.className = 'aredl-fab';
            fab.innerHTML = `+ ADD THEORETICAL DEMON <span id="theo-pts-fab" class="theo-pts-badge" style="display:none;"></span>`;
            fab.onclick = () => openModal(null);
            document.body.appendChild(fab);
        }

        document.querySelectorAll('.theo-clone').forEach(el => el.remove());

        const templateData = extractTemplateData(templateCard);
        const allRecords = getCustomRecords();
        const visibleRecords = allRecords.filter(r => !r.hidden);

        let totalTheoPoints = 0;

        visibleRecords.forEach(rec => {
            totalTheoPoints += parseFloat(rec.points || 0);
            const clone = templateCard.cloneNode(true);
            clone.id = '';
            clone.querySelectorAll('*').forEach(el => el.id = '');
            clone.className = templateCard.className + ' theo-clone';

            clone.style.setProperty('position', 'relative', 'important');
            clone.style.setProperty('transform', 'none', 'important');
            clone.style.setProperty('z-index', '1', 'important');
            clone.style.setProperty('order', rec.rank, 'important');
            clone.style.setProperty('cursor', 'pointer', 'important');

            if (rec.level_id) {
                clone.onclick = (e) => {
                    if (e.target.closest('a') || e.target.closest('.theo-menu-container') || e.target.closest('.theo-global-dropdown')) return;
                    window.location.href = `https://aredl.net/list/${rec.level_id}`;
                };
            }

            const visualInner = clone.querySelector('a[href*="youtu"]')?.closest('div[style*="background"]');
            if (visualInner) {
                visualInner.style.border = '1px dashed #ff9800';
                visualInner.style.boxShadow = 'inset 0 0 15px rgba(255, 152, 0, 0.15)';
            } else {
                clone.style.border = '1px dashed #ff9800';
            }

            if (rec.level_id) {
                const thumbUrl = `${BANNER_BASE_URL}${rec.level_id}.webp`;
                const imgs = clone.querySelectorAll('img');
                if (imgs.length > 0) {
                    imgs[0].removeAttribute('srcset');
                    imgs[0].removeAttribute('sizes');
                    imgs[0].src = thumbUrl;
                    imgs[0].style.setProperty('object-fit', 'cover', 'important');
                }
            }

            let tName = templateData.name;
            const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null, false);
            let node;
            
            // Unchained string replacement so Points and Date can be replaced on the exact same line of text
            while ((node = walker.nextNode())) {
                let val = node.nodeValue;
                let originalVal = val;

                if (templateData.rank && val.includes(templateData.rank)) {
                    val = val.replace(templateData.rank, `#${rec.rank}`);
                } 
                
                if (tName && val.includes(tName)) {
                    val = val.replace(tName, `${rec.name} `);

                    const badge = document.createElement('span');
                    badge.className = 'theo-universal-badge';
                    badge.textContent = '[Theo]';
                    node.parentElement.appendChild(badge);

                    tName = null; // Ensure badge is only placed once
                } 
                
                if (templateData.pointsStr && val.includes(templateData.pointsStr)) {
                    const formattedPoints = parseFloat(rec.points).toFixed(1);
                    val = val.replace(templateData.pointsStr, `+${formattedPoints} points`);
                } 
                
                if (val.match(/\d{1,2}\/\d{1,2}\/\d{4}/)) {
                    val = val.replace(/\d{1,2}\/\d{1,2}\/\d{4}/, rec.date || 'Local');
                }

                if (val !== originalVal) {
                    node.nodeValue = val;
                }
            }

            clone.querySelectorAll('a').forEach(a => {
                if (a.href.includes('youtube') || a.href.includes('youtu.be')) {
                    a.href = rec.yt || 'javascript:void(0)';
                    a.target = '_blank';
                    a.onclick = (e) => e.stopPropagation();
                } else {
                    a.href = 'javascript:void(0)';
                    a.style.cursor = 'default';
                }
            });

            const menuContainer = document.createElement('div');
            menuContainer.className = 'theo-menu-container';
            menuContainer.innerHTML = `<button class="theo-menu-btn" title="Options">⋮</button>`;
            const menuBtn = menuContainer.querySelector('.theo-menu-btn');

            menuBtn.onclick = (e) => {
                e.stopPropagation();
                const rect = menuBtn.getBoundingClientRect();
                if (globalDropdown.style.display === 'flex' && globalDropdown.getAttribute('data-active-rec') === rec.name) {
                    globalDropdown.style.display = 'none';
                    globalDropdown.removeAttribute('data-active-rec');
                    return;
                }
                globalDropdown.setAttribute('data-active-rec', rec.name);
                globalDropdown.innerHTML = `
                    <button class="edit-action">Edit Record</button>
                    <button class="hide-action">Hide from Profile</button>
                    <button class="delete-action">Remove</button>
                `;
                globalDropdown.style.top = `${rect.bottom + 4}px`;
                globalDropdown.style.left = `${rect.left}px`;
                globalDropdown.style.display = 'flex';

                globalDropdown.querySelector('.edit-action').onclick = (ev) => {
                    ev.stopPropagation(); globalDropdown.style.display = 'none'; openModal(rec);
                };
                globalDropdown.querySelector('.hide-action').onclick = (ev) => {
                    ev.stopPropagation(); globalDropdown.style.display = 'none';
                    rec.hidden = true; saveCustomRecords(allRecords); clone.remove(); render();
                };
                globalDropdown.querySelector('.delete-action').onclick = (ev) => {
                    ev.stopPropagation(); globalDropdown.style.display = 'none';
                    if (confirm(`Remove "${rec.name}" from your theoretical list?`)) {
                        saveCustomRecords(allRecords.filter(r => r.name !== rec.name)); clone.remove(); render();
                    }
                };
            };
            clone.appendChild(menuContainer);
            listContainer.appendChild(clone);
        });

        document.addEventListener('click', (e) => { if (!globalDropdown.contains(e.target)) globalDropdown.style.display = 'none'; });

        Array.from(listContainer.children).forEach(child => {
            child.style.setProperty('transform', 'none', 'important');
            child.style.setProperty('position', 'relative', 'important');
            child.style.setProperty('flex-shrink', '0', 'important');
            const match = child.textContent.match(/#(\d+)/);
            if (match) {
                child.style.setProperty('order', parseInt(match[1], 10), 'important');
            } else {
                child.style.setProperty('order', '999999', 'important');
            }
        });

        updateProfileStats(totalTheoPoints, visibleRecords.length);

        const ptsBadge = document.getElementById('theo-pts-fab');
        if (ptsBadge) {
            if (totalTheoPoints > 0) {
                ptsBadge.style.display = 'inline-block';
                ptsBadge.textContent = `+${totalTheoPoints.toFixed(1)} pts`;
            } else { ptsBadge.style.display = 'none'; }
        }
    }

    async function renderProfilePacksTab() {
        if (!isMyProfilePage() || !window.location.search.includes('tab=packs')) return;

        const activePanels = document.querySelectorAll('div[role="tabpanel"][data-state="active"]');
        if (activePanels.length === 0) return;

        const targetContainer = activePanels[activePanels.length - 1];

        const emptyMsg = Array.from(targetContainer.querySelectorAll('p')).find(p =>
            p.textContent.trim() === 'This player has not completed any packs.' ||
            p.textContent.includes('This player has not completed any packs')
        );

        let safeContainer = document.getElementById('theo-isolated-pack-container');

        if (!safeContainer) {
            safeContainer = document.createElement('div');
            safeContainer.id = 'theo-isolated-pack-container';
            safeContainer.className = 'theo-isolated-pack-container';

            if (emptyMsg) {
                emptyMsg.style.display = 'none';
                emptyMsg.after(safeContainer);
            } else {
                targetContainer.appendChild(safeContainer);
            }
        } else if (emptyMsg) {
            emptyMsg.style.display = 'none';
        }

        const { earnedPacks } = await evaluateCompletedPacks();
        safeContainer.innerHTML = '';

        earnedPacks.forEach(pack => {
            const isNative = Array.from(targetContainer.children).some(child =>
                child !== safeContainer && child.textContent.includes(pack.name)
            );
            if (isNative) return;

            const card = document.createElement('div');
            card.className = 'clamp-[h-14-24-clamp] px-2 py-4 flex justify-between w-full items-center gap-2 relative overflow-hidden rounded-xl text-white hover:bg-inherit scale-[0.99] hover:scale-[1.00] cursor-pointer transition-transform theo-profile-pack-injected';
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            card.style.cssText = 'flex-shrink: 0 !important;';
            card.onclick = () => { window.location.href = '/packs/' + (pack.id || ''); };

            card.innerHTML = `
                <img alt="" aria-hidden="true" class="absolute -z-10 inset-0 w-full h-full object-cover" fetchpriority="high" decoding="async" loading="eager" src="${PACK_BANNER_BASE_URL}${pack.id}.webp" onerror="this.style.opacity='0'">
                <div class="clamp-[min-h-12-24-clamp] flex flex-col justify-center px-2" style="z-index: 10;">
                    <h3 class="clamp-[text-xs-2xl-clamp] w-max font-medium transition-transform hover:scale-105 text-left text-shadow-3">
                        ${pack.name}
                        <span class="theo-universal-badge">[Theo]</span>
                    </h3>
                    <p class="text-shadow-3 clamp-[text-xs-lg-clamp]">+${pack.points.toFixed(1)} points</p>
                </div>
                <div class="flex items-center clamp-[gap-2-8-clamp] justify-end clamp-[mr-1-8-clamp]"></div>
            `;

            safeContainer.appendChild(card);
        });
    }

    let packScanTimer = null;
    async function renderPacksPage() {
        if (!isPacksPage()) return;
        if (packScanTimer) return;

        packScanTimer = setTimeout(async () => {
            packScanTimer = null;
            const tiers = await fetchPackTiers();
            const completedPool = getCompletedLevelIdentifiers();

            const packStatusMap = new Map();
            tiers.forEach(t => {
                (t.packs || []).forEach(p => {
                    const levels = p.levels || [];
                    const totalReq = levels.length;
                    const doneCount = levels.filter(lvl => {
                        return completedPool.has(cleanString(lvl.name)) || completedPool.has(String(lvl.level_id));
                    }).length;

                    packStatusMap.set(cleanString(p.name), {
                        done: doneCount, total: totalReq, isComplete: doneCount === totalReq, pack: p
                    });
                });
            });

            const rightPanel = Array.from(document.querySelectorAll('div')).find(d => {
                let t = d.textContent || '';
                return t.includes('Levels') && t.includes('Tier') && d.getBoundingClientRect().left > (window.innerWidth * 0.4);
            });

            const rightPanelLeftBound = rightPanel ? rightPanel.getBoundingClientRect().left : window.innerWidth;

            const packElements = Array.from(document.querySelectorAll('a, p, span, div')).filter(el => {
                if (el.children.length > 0) return false;
                const txt = cleanString(el.textContent);
                const rect = el.getBoundingClientRect();
                return packStatusMap.has(txt) && rect.width > 0 && rect.left < (rightPanelLeftBound - 30);
            });

            packElements.forEach(el => {
                const txt = cleanString(el.textContent);
                const packData = packStatusMap.get(txt);
                const parent = el.parentElement;

                if (parent && parent.tagName !== 'BODY') {
                    const originalCounter = Array.from(parent.children).find(child => {
                        return /^(\[)?\d+\/\d+(\])?$/.test(child.textContent.trim());
                    });
                    if (originalCounter) originalCounter.classList.add('theo-hide-native-counter');

                    if (!parent.hasAttribute('data-theo-badge')) {
                        parent.setAttribute('data-theo-badge', 'true');
                        parent.style.display = 'flex';
                        parent.style.alignItems = 'center';
                        parent.style.justifyContent = 'space-between';

                        const badge = document.createElement('span');
                        parent.appendChild(badge);
                    } 
                    
                    const badge = parent.querySelector('.theo-sidebar-badge') || parent.lastChild;
                    if (badge) {
                        let progressClass = packData.isComplete ? 'completed' : `prog-${Math.min(packData.done, 5)}`;
                        badge.className = `theo-sidebar-badge ${progressClass}`;
                        badge.textContent = packData.isComplete ? '[Theo]' : `[${packData.done}/${packData.total}]`;
                    }
                }
            });

            if (!rightPanel) return;
            const titleEl = rightPanel.querySelector('h1, h2, h3');
            const packName = titleEl ? titleEl.textContent.trim() : '';
            if (!packName) return;

            const currentPackData = packStatusMap.get(cleanString(packName));
            if (currentPackData) {
                const { done, total, isComplete, pack } = currentPackData;
                const packPoints = (pack.points || 0) / 10;
                let container = document.getElementById('theo-pack-action-container');
                if (!container) {
                    container = document.createElement('div');
                    container.id = 'theo-pack-action-container';
                    container.style.cssText = 'margin-top: 16px; margin-bottom: 16px; padding: 14px; background: #252830; border: 1px solid #ff9800; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; font-family: sans-serif;';
                    rightPanel.prepend(container);
                }

                container.innerHTML = `
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <span style="font-size: 14px; color: #fff; font-weight: bold;">Native Theoretical Pack Evaluation: <span style="color:#ff9800;">${done}/${total} levels completed</span></span>
                        <span style="font-size: 11px; color: #aaa;">Required: ${(pack.levels || []).map(l => l.name).join(', ')}</span>
                    </div>
                    <div style="font-size: 13px; font-weight: 800; color: ${isComplete ? '#4cd137' : '#e84118'}; display:flex; align-items:center; gap:6px;">
                        ${isComplete ? `✓ Automatically Qualified (+${packPoints} pts)` : '✕ Incomplete'}
                    </div>
                `;

                const nativeCounter = Array.from(rightPanel.querySelectorAll('div, span, p')).find(el => {
                    return /^\d+\/\d+\s*levels\s*completed$/i.test(el.textContent.trim());
                });
                if (nativeCounter) {
                    nativeCounter.textContent = `${done}/${total} levels completed (Theo)`;
                    nativeCounter.style.color = '#ff9800';
                }

                const levelLinks = Array.from(rightPanel.querySelectorAll('a[href*="/list/"]'));
                levelLinks.forEach(linkEl => {
                    const match = linkEl.href.match(/\/list\/(\d+)/);
                    if (!match) return;
                    const levelId = match[1];

                    const packLevel = (pack.levels || []).find(l => String(l.level_id) === levelId);
                    if (!packLevel) return;

                    let card = linkEl;
                    while (card.parentElement && card.parentElement !== rightPanel) {
                        const siblingLinks = Array.from(card.parentElement.querySelectorAll('a[href*="/list/"]'));
                        const uniqueIds = new Set(siblingLinks.map(a => {
                            const m = a.href.match(/\/list\/(\d+)/);
                            return m ? m[1] : null;
                        }).filter(id => id));

                        if (uniqueIds.size > 1) break;
                        card = card.parentElement;
                    }

                    const isDone = completedPool.has(String(packLevel.level_id)) || completedPool.has(cleanString(packLevel.name));

                    if (!isDone) {
                        card.classList.add('theo-pack-level-incomplete');
                        card.classList.remove('theo-level-colored');
                    } else {
                        card.classList.remove('theo-pack-level-incomplete');
                        card.classList.add('theo-level-colored');

                        card.classList.remove('grayscale');
                        card.querySelectorAll('.grayscale').forEach(el => el.classList.remove('grayscale'));
                    }
                });
            }
        }, 150);
    }

    let lbUpdating = false;
    let lbExpanded = false;

    async function renderLeaderboardHUD() {
        if (!isLeaderboardPage() || lbUpdating) return;
        lbUpdating = true;
        try {
            const allRecords = getCustomRecords();
            const visibleRecords = allRecords.filter(r => !r.hidden);
            let totalTheo = 0;
            let bestTheoreticalPosition = 999999;
            visibleRecords.forEach(r => {
                totalTheo += parseFloat(r.points || 0);
                const rPos = parseInt(r.rank, 10);
                if (!isNaN(rPos) && rPos < bestTheoreticalPosition) bestTheoreticalPosition = rPos;
            });

            const { totalPoints: autoPackPoints } = await evaluateCompletedPacks();

            const finalPtsRaw = 81.0 + totalTheo;
            const finalPtsTotal = 81.0 + totalTheo + autoPackPoints;
            const finalExtremesTotal = 4 + visibleRecords.length;

            const userMeta = await fetchActiveUserData();
            const countryId = userMeta?.country?.id || 203;
            const countryName = userMeta?.country?.name || 'NATIONAL';

            const [natRanks, rankGlobalRaw, rankGlobalTotal, rankGlobalExt, rankGlobalHrd] = await Promise.all([
                getExactNationalRanks(finalPtsRaw, finalPtsTotal, finalExtremesTotal, bestTheoreticalPosition, countryId),
                findGlobalPointsRank(finalPtsRaw, false),
                findGlobalPointsRank(finalPtsTotal, true),
                findGlobalExtremesRank(finalExtremesTotal),
                findGlobalHardestRank(bestTheoreticalPosition)
            ]);

            let hud = document.getElementById('theo-lb-pill');
            if (!hud) {
                hud = document.createElement('div');
                hud.id = 'theo-lb-pill';
                document.body.appendChild(hud);
            }

            const updateHUDContent = () => {
                if (!lbExpanded) {
                    hud.className = 'theo-lb-pill minimized';
                    hud.innerHTML = `
                        <span style="background:#ff9800; color:#121316; font-size:11px; font-weight:900; padding:4px 8px; border-radius:4px;">THEO STATS</span>
                        <span style="font-size:13px; font-weight:bold; color:#ff9800;">[ ⤢ Expand ]</span>
                    `;
                    hud.onclick = () => { lbExpanded = true; updateHUDContent(); };
                } else {
                    hud.className = 'theo-lb-pill expanded';
                    hud.onclick = null;
                    hud.innerHTML = `
                        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; padding-bottom:10px;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span style="background:#ff9800; color:#121316; font-size:12px; font-weight:900; padding:3px 8px; border-radius:4px;">THEORETICAL</span>
                                <span style="font-weight:bold; font-size:17px; color:#fff;">${getTargetUsername()}</span>
                            </div>
                            <button id="theo-lb-close-btn" style="background:transparent; border:none; color:#aaa; font-size:13px; font-weight:bold; cursor:pointer;">[ ✕ Minimize ]</button>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:12px;">
                            <div style="background:#1f222d; padding:12px 14px; border-radius:8px; border-left:4px solid #ff9800;">
                                <div style="color:#aaa; font-size:12px; font-weight:bold; letter-spacing:0.5px; margin-bottom:4px;">${countryName.toUpperCase()}</div>
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
                                    <span style="font-size:14px;">With Packs:</span>
                                    <span><strong style="color:#ff9800; font-size:16px;">#${natRanks.total || '-'}</strong> <span style="color:#aaa; font-size:12px;">(${finalPtsTotal.toFixed(1)} pts)</span></span>
                                </div>
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:3px;">
                                    <span style="font-size:13px; color:#bbb;">Raw Points:</span>
                                    <span><strong style="color:#fff; font-size:15px;">#${natRanks.raw || '-'}</strong> <span style="color:#888; font-size:12px;">(${finalPtsRaw.toFixed(1)} pts)</span></span>
                                </div>
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:3px;">
                                    <span style="font-size:13px; color:#bbb;">Extremes Count:</span>
                                    <span><strong style="color:#fff; font-size:15px;">#${natRanks.extremes || '-'}</strong> <span style="color:#888; font-size:12px;">(${finalExtremesTotal} beaten)</span></span>
                                </div>
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:3px;">
                                    <span style="font-size:13px; color:#bbb;">Hardest Level:</span>
                                    <span><strong style="color:#fff; font-size:15px;">#${natRanks.hardest || '-'}</strong></span>
                                </div>
                            </div>
                            <div style="background:#1f222d; padding:12px 14px; border-radius:8px; border-left:4px solid #555;">
                                <div style="color:#aaa; font-size:12px; font-weight:bold; letter-spacing:0.5px; margin-bottom:4px;">GLOBAL</div>
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
                                    <span style="font-size:14px;">With Packs:</span>
                                    <span><strong style="color:#ff9800; font-size:16px;">#${rankGlobalTotal || '-'}</strong> <span style="color:#aaa; font-size:12px;">(${finalPtsTotal.toFixed(1)} pts)</span></span>
                                </div>
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:3px;">
                                    <span style="font-size:13px; color:#bbb;">Raw Points:</span>
                                    <span><strong style="color:#fff; font-size:15px;">#${rankGlobalRaw || '-'}</strong> <span style="color:#888; font-size:12px;">(${finalPtsRaw.toFixed(1)} pts)</span></span>
                                </div>
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:3px;">
                                    <span style="font-size:13px; color:#bbb;">Extremes Count:</span>
                                    <span><strong style="color:#fff; font-size:15px;">#${rankGlobalExt || '-'}</strong> <span style="color:#888; font-size:12px;">(${finalExtremesTotal} beaten)</span></span>
                                </div>
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:3px;">
                                    <span style="font-size:13px; color:#bbb;">Hardest Level:</span>
                                    <span><strong style="color:#fff; font-size:15px;">#${rankGlobalHrd || '-'}</strong></span>
                                </div>
                            </div>
                        </div>
                    `;
                    const closeBtn = hud.querySelector('#theo-lb-close-btn');
                    if (closeBtn) {
                        closeBtn.onclick = (e) => {
                            e.stopPropagation(); lbExpanded = false; updateHUDContent();
                        };
                    }
                }
            };
            updateHUDContent();
        } finally { lbUpdating = false; }
    }

    let lastUrl = location.href;
    new MutationObserver(() => {
        checkAndAutoDetectUser();
        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            const lbPill = document.getElementById('theo-lb-pill');
            if (lbPill && !isLeaderboardPage()) lbPill.remove();

            setTimeout(() => {
                if (isMyProfilePage()) {
                    if (window.location.search.includes('tab=packs')) {
                        renderProfilePacksTab();
                    } else { render(); }
                } else if (isOtherProfilePage()) {
                    document.querySelectorAll('.theo-clone, .theo-profile-pack-injected, #theo-isolated-pack-container, #theo-fab').forEach(el => el.remove());
                }
                if (isPacksPage()) renderPacksPage();
                if (isLeaderboardPage()) renderLeaderboardHUD();
            }, 200);
        } else {
            if (isMyProfilePage()) {
                if (window.location.search.includes('tab=packs')) {
                    if (!document.querySelector('.theo-profile-pack-injected')) renderProfilePacksTab();
                } else if (!document.querySelector('.theo-clone') && getCustomRecords().filter(r => !r.hidden).length > 0) {
                    render();
                }
            } else if (isOtherProfilePage()) {
                document.querySelectorAll('.theo-clone, .theo-profile-pack-injected, #theo-isolated-pack-container, #theo-fab').forEach(el => el.remove());
            }
            if (isPacksPage()) renderPacksPage();
        }
    }).observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
        checkAndAutoDetectUser();
        syncRecordsWithApi(); // Run the auto-sync engine on startup
        if (isMyProfilePage()) {
            if (window.location.search.includes('tab=packs')) renderProfilePacksTab();
            else render();
        } else if (isOtherProfilePage()) {
            document.querySelectorAll('.theo-clone, .theo-profile-pack-injected, #theo-isolated-pack-container, #theo-fab').forEach(el => el.remove());
        }
        if (isPacksPage()) renderPacksPage();
        if (isLeaderboardPage()) renderLeaderboardHUD();
    }, 400);
})();
