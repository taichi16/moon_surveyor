/**
 * 中央氣象署月出月沒資料庫與自動更新引擎 (支援跨年自動抓取與離線快取)
 */

const DB_NAME = 'MoonSurveyorDB';
const STORE_NAME = 'cwa_moon_store';
const CACHE_META_KEY = 'cwa_cache_meta';

class CwaDataUpdater {
  constructor() {
    this.memoryData = null;
    this.isLoaded = false;
    this.isUpdating = false;
    this.onUpdateCallbacks = [];
  }

  // 註冊資料更新事件回調
  onUpdate(cb) {
    this.onUpdateCallbacks.push(cb);
  }

  emitUpdate(info) {
    this.onUpdateCallbacks.forEach(cb => {
      try { cb(info); } catch (e) { console.error(e); }
    });
  }

  // 初始化並載入資料
  async init() {
    try {
      // 1. 優先嘗試從本機快取 (IndexedDB / localStorage) 讀取
      const cached = await this.readFromLocal();
      if (cached && cached.counties && Object.keys(cached.counties).length > 0) {
        this.memoryData = cached;
        this.isLoaded = true;
        console.log(`[CwaDataUpdater] 已載入本機快取資料 (${cached.version || '2025-2027'})`);
      } else {
        // 2. 本機尚無快取，從內建靜態檔案載入
        await this.loadBundledData();
      }

      // 3. 背景自動檢查是否有新年份資料發布 (不阻礙主執行緒，確保瞬間啟動)
      setTimeout(() => {
        this.checkAndAutoUpdate();
      }, 3000);

      return true;
    } catch (err) {
      console.warn('[CwaDataUpdater] 初始化失敗，降級使用內建天文引擎計算:', err);
      return false;
    }
  }

  // 載入預載緊湊型資料
  async loadBundledData() {
    try {
      const baseUrl = import.meta.env.BASE_URL || './';
      const dataUrl = baseUrl.endsWith('/') ? `${baseUrl}data/cwa_moon_compact.json` : `${baseUrl}/data/cwa_moon_compact.json`;
      const res = await fetch(dataUrl);
      if (res.ok) {
        const data = await res.json();
        this.memoryData = data;
        this.isLoaded = true;
        await this.saveToLocal(data);
        console.log('[CwaDataUpdater] 內建緊湊資料載入成功，已寫入快取');
      }
    } catch (e) {
      console.warn('[CwaDataUpdater] 讀取靜態檔失敗:', e);
    }
  }

  // 查詢指定縣市與日期的官方記錄 (格式: YYYY-MM-DD)
  getCwaRecord(countyName, dateStr) {
    if (!this.memoryData || !this.memoryData.dates || !this.memoryData.counties) {
      return null;
    }

    const countyRecords = this.memoryData.counties[countyName];
    if (!countyRecords) return null;

    const dateIdx = this.memoryData.dates.indexOf(dateStr);
    if (dateIdx === -1 || !countyRecords[dateIdx]) return null;

    const [rise, riseAz, transit, transitAlt, set, setAz] = countyRecords[dateIdx];
    return {
      rise: rise || '--:--',
      riseAz: riseAz !== null ? riseAz : null,
      transit: transit || '--:--',
      transitAlt: transitAlt || '--',
      set: set || '--:--',
      setAz: setAz !== null ? setAz : null,
      source: '交通部中央氣象署 (A-B0063-001)'
    };
  }

  // 檢查並自動更新氣象署新年份資料
  async checkAndAutoUpdate() {
    if (this.isUpdating) return;
    const now = new Date();
    const currentYear = now.getFullYear();

    // 檢查上次更新時間
    const metaStr = localStorage.getItem(CACHE_META_KEY);
    let meta = metaStr ? JSON.parse(metaStr) : { lastCheck: 0, maxYear: 2027 };

    const daysSinceCheck = (Date.now() - meta.lastCheck) / (1000 * 60 * 60 * 24);

    // 若距上次檢查超過 30 天，或當前系統年份已超出快取涵蓋範圍，自動連線檢查
    if (daysSinceCheck < 30 && currentYear <= meta.maxYear) {
      return;
    }

    console.log('[CwaDataUpdater] 正在檢查中央氣象署最新年度更新...');
    this.isUpdating = true;

    try {
      // 嘗試透過前端 CORS 代理或氣象署 S3 端點更新
      const targetUrl = 'https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Astronomy/A-B0063-001.json';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const resp = await fetch(targetUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const raw = await resp.json();
        const locations = raw?.cwaopendata?.dataset?.location;
        if (locations && locations.length > 0) {
          const processed = this.processRawLocations(locations);
          if (processed && processed.dates.length > 0) {
            this.memoryData = processed;
            await this.saveToLocal(processed);
            
            const maxYear = parseInt(processed.dates[processed.dates.length - 1].slice(0, 4), 10);
            localStorage.setItem(CACHE_META_KEY, JSON.stringify({
              lastCheck: Date.now(),
              maxYear: isNaN(maxYear) ? 2027 : maxYear
            }));

            console.log(`[CwaDataUpdater] 自動更新成功！涵蓋至 ${processed.dates[processed.dates.length - 1]}`);
            this.emitUpdate({
              success: true,
              version: processed.version,
              endDate: processed.dates[processed.dates.length - 1]
            });
          }
        }
      }
    } catch (err) {
      console.log('[CwaDataUpdater] 背景更新已掠過（離線或端點限制，現有三年數據與天文演算法持續生效）');
    } finally {
      this.isUpdating = false;
    }
  }

  // 本機重整原始 CWA 資料
  processRawLocations(locations) {
    const allDates = new Set();
    const rawMap = {};

    for (const loc of locations) {
      const county = loc.CountyName;
      if (!county) continue;
      rawMap[county] = {};
      for (const t of loc.time || []) {
        if (!t.Date) continue;
        allDates.add(t.Date);
        rawMap[county][t.Date] = [
          t.MoonRiseTime || '',
          t.MoonRiseAZ ? parseFloat(t.MoonRiseAZ) : null,
          t.MoonTransitTime || '',
          t.MoonTransitAlt || '',
          t.MoonSetTime || '',
          t.MoonSetAZ ? parseFloat(t.MoonSetAZ) : null
        ];
      }
    }

    const sortedDates = Array.from(allDates).sort();
    const compact = {
      version: `${sortedDates[0].slice(0, 4)}-${sortedDates[sortedDates.length - 1].slice(0, 4)}`,
      updatedAt: new Date().toISOString().slice(0, 10),
      dates: sortedDates,
      counties: {}
    };

    for (const [county, dateMap] of Object.entries(rawMap)) {
      compact.counties[county] = sortedDates.map(d => dateMap[d] || ['', null, '', '', '', null]);
    }

    return compact;
  }

  // 讀取 IndexedDB / localStorage
  async readFromLocal() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const getReq = store.get('moon_data');
          getReq.onsuccess = () => resolve(getReq.result || null);
          getReq.onerror = () => resolve(null);
        };
        req.onerror = () => {
          // Fallback to localStorage
          const local = localStorage.getItem('moon_data_backup');
          resolve(local ? JSON.parse(local) : null);
        };
      } catch (err) {
        resolve(null);
      }
    });
  }

  // 寫入 IndexedDB / localStorage
  async saveToLocal(data) {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          store.put(data, 'moon_data');
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        };
        req.onerror = () => {
          try {
            localStorage.setItem('moon_data_backup', JSON.stringify(data));
          } catch (e) {}
          resolve(false);
        };
      } catch (e) {
        resolve(false);
      }
    });
  }
}

export const cwaUpdater = new CwaDataUpdater();
