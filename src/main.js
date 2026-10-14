/**
 * 主程式入口 (Moon Surveyor Pro Main Orchestrator)
 * 協同管理觀測點、日期時間、天文計算與四大視圖
 */

import { TAIWAN_COUNTIES, POPULAR_SPOTS } from './utils/constants.js';
import { getEphemerisAt, getDayTrajectories, findNearestCounty } from './utils/astronomy.js';
import { cwaUpdater } from './utils/dataUpdater.js';

import { MapView } from './components/MapView.js';
import { CompassView } from './components/CompassView.js';
import { ARCameraView } from './components/ARCameraView.js';
import { EphemerisView } from './components/EphemerisView.js';
import { TimelineSlider } from './components/TimelineSlider.js';

class MoonSurveyorApp {
  constructor() {
    // 預設台北信義區
    this.lat = 25.0375;
    this.lng = 121.5637;
    this.currentCounty = '臺北市';
    this.currentLocationName = '臺北市 (信義/象山)';

    // 日期與時間狀態
    const now = new Date();
    this.currentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    this.currentMinutes = now.getHours() * 60 + now.getMinutes();

    // 視圖實例
    this.mapView = null;
    this.compassView = null;
    this.arView = null;
    this.ephemerisView = null;
    this.timelineSlider = null;

    this.activeView = 'map';
  }

  async init() {
    console.log('[MoonSurveyorApp] 啟動應用程式...');

    // 1. 初始化資料庫更新器
    await cwaUpdater.init();
    cwaUpdater.onUpdate((info) => {
      this.showToast(`🎉 氣象署資料自動更新成功！涵蓋至 ${info.endDate}`);
      this.recalculateAndDispatch();
    });

    // 2. 初始化各視圖元件
    this.initViews();

    // 3. 綁定頂部控制項與地點/日期事件
    this.setupHeaderEvents();
    this.setupViewTabs();
    this.setupDropdownMenus();
    this.setupModalEvents();

    // 4. 初次計算與渲染
    this.updateDateInputDisplay();
    this.recalculateAndDispatch();

    // 5. 註冊離線 Service Worker
    this.registerServiceWorker();
  }

  initViews() {
    // 地圖視圖
    this.mapView = new MapView('leaflet-map-container', (newLat, newLng) => {
      this.lat = newLat;
      this.lng = newLng;
      const nearest = findNearestCounty(newLat, newLng);
      this.currentCounty = nearest.name;
      this.currentLocationName = `${nearest.name} (自訂座標)`;
      document.getElementById('input-location-search').value = this.currentLocationName;
      this.recalculateAndDispatch();
    });
    this.mapView.init(this.lat, this.lng);

    // 地圖底圖切換按鈕
    document.querySelectorAll('.layer-pill-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.layer-pill-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.mapView.switchTile(e.target.dataset.layer);
      });
    });

    // 羅盤視圖
    this.compassView = new CompassView('compass-main-canvas');
    document.getElementById('btn-toggle-compass-sensor')?.addEventListener('click', async () => {
      const ok = await this.compassView.enableSensor();
      if (ok) {
        this.showToast('🧭 已成功連接手機電子指南針！');
      } else {
        this.showToast('💡 未檢測到實體傳感器，請使用單指觸控旋轉羅盤');
      }
    });

    // AR 相機視圖
    this.arView = new ARCameraView('ar-main-container');

    // 星曆視圖
    this.ephemerisView = new EphemerisView('ephemeris-main-container', (jumpDate) => {
      this.currentDate = new Date(jumpDate.getFullYear(), jumpDate.getMonth(), jumpDate.getDate());
      this.updateDateInputDisplay();
      this.recalculateAndDispatch();
    });
    this.ephemerisView.init();

    // 底部時光機滑桿
    this.timelineSlider = new TimelineSlider('timeline-slider-root', (minutes) => {
      this.currentMinutes = minutes;
      this.recalculateAndDispatch(false); // 僅更新即時天體位置，不重複取全日軌跡
    });
    this.timelineSlider.setMinutes(this.currentMinutes);
  }

  // 設定頂部操作事件
  setupHeaderEvents() {
    // GPS 定位
    document.getElementById('btn-locate-gps')?.addEventListener('click', () => {
      this.locateCurrentGPS();
    });

    // 日期切換
    document.getElementById('btn-prev-day')?.addEventListener('click', () => {
      this.currentDate.setDate(this.currentDate.getDate() - 1);
      this.updateDateInputDisplay();
      this.recalculateAndDispatch();
    });

    document.getElementById('btn-next-day')?.addEventListener('click', () => {
      this.currentDate.setDate(this.currentDate.getDate() + 1);
      this.updateDateInputDisplay();
      this.recalculateAndDispatch();
    });

    document.getElementById('btn-today')?.addEventListener('click', () => {
      const now = new Date();
      this.currentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      this.currentMinutes = now.getHours() * 60 + now.getMinutes();
      this.timelineSlider.setMinutes(this.currentMinutes);
      this.updateDateInputDisplay();
      this.recalculateAndDispatch();
    });

    const datePicker = document.getElementById('input-date-picker');
    datePicker?.addEventListener('change', (e) => {
      if (e.target.value) {
        const [y, m, d] = e.target.value.split('-').map(Number);
        this.currentDate = new Date(y, m - 1, d);
        this.recalculateAndDispatch();
      }
    });

    // 關鍵字搜尋
    const searchInput = document.getElementById('input-location-search');
    searchInput.value = this.currentLocationName;
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.handleSearchLocation(searchInput.value);
      }
    });
  }

  // 視圖 Tab 切換
  setupViewTabs() {
    const tabs = document.querySelectorAll('.view-tab-btn');
    tabs.forEach((tab) => {
      tab.addEventListener('click', (e) => {
        const targetView = e.currentTarget.dataset.view;
        if (targetView === this.activeView) return;

        tabs.forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');

        document.querySelectorAll('.view-container').forEach(c => c.classList.remove('active'));
        const targetContainer = document.getElementById(`view-${targetView}`);
        if (targetContainer) targetContainer.classList.add('active');

        this.activeView = targetView;

        // 觸發對應視圖的大小重繪
        if (targetView === 'map' && this.mapView) {
          this.mapView.invalidateSize();
        } else if (targetView === 'compass' && this.compassView) {
          this.compassView.resize();
        } else if (targetView === 'ar' && this.arView) {
          this.arView.resize();
        }
      });
    });
  }

  // 下拉熱門景點與縣市選單
  setupDropdownMenus() {
    const menuBtn = document.getElementById('btn-toggle-spots-menu');
    const menuDropdown = document.getElementById('dropdown-spots-menu');
    const countyGrid = document.getElementById('county-buttons-grid');
    const spotsList = document.getElementById('spots-buttons-list');

    // 生成 22 縣市按鈕
    TAIWAN_COUNTIES.forEach((c) => {
      const btn = document.createElement('button');
      btn.className = 'county-chip-btn';
      btn.textContent = c.name;
      btn.addEventListener('click', () => {
        this.selectLocation(c.name, c.lat, c.lng, c.name);
        menuDropdown.classList.add('hidden');
      });
      countyGrid.appendChild(btn);
    });

    // 生成熱門景點按鈕
    POPULAR_SPOTS.forEach((s) => {
      const btn = document.createElement('button');
      btn.className = 'spot-item-btn';
      btn.innerHTML = `
        <span>${s.name} <small style="color: #94a3b8;">(${s.county})</small></span>
        <span class="spot-badge">${s.tag}</span>
      `;
      btn.addEventListener('click', () => {
        this.selectLocation(s.name, s.lat, s.lng, s.county);
        menuDropdown.classList.add('hidden');
      });
      spotsList.appendChild(btn);
    });

    menuBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      menuDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!menuDropdown.contains(e.target) && e.target !== menuBtn) {
        menuDropdown.classList.add('hidden');
      }
    });
  }

  selectLocation(name, lat, lng, county) {
    this.lat = lat;
    this.lng = lng;
    this.currentCounty = county;
    this.currentLocationName = name;
    document.getElementById('input-location-search').value = name;

    if (this.mapView) {
      this.mapView.panTo(lat, lng, 14);
    }
    this.recalculateAndDispatch();
  }

  // 取得目前 GPS 座標
  locateCurrentGPS() {
    if (!navigator.geolocation) {
      this.showToast('您的瀏覽器不支援 GPS 定位');
      return;
    }

    const gpsBtn = document.getElementById('btn-locate-gps');
    if (gpsBtn) gpsBtn.innerHTML = '<span>⏳ 定位中...</span>';

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const nearest = findNearestCounty(latitude, longitude);
        this.lat = latitude;
        this.lng = longitude;
        this.currentCounty = nearest.name;
        this.currentLocationName = `📍 目前位置 (${nearest.name})`;
        document.getElementById('input-location-search').value = this.currentLocationName;

        if (this.mapView) {
          this.mapView.panTo(latitude, longitude, 15);
        }
        if (gpsBtn) gpsBtn.innerHTML = '<span>📍 定位目前地點</span>';
        this.showToast(`✅ 定位成功！經緯度: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
        this.recalculateAndDispatch();
      },
      (err) => {
        if (gpsBtn) gpsBtn.innerHTML = '<span>📍 定位目前地點</span>';
        this.showToast('無法取得 GPS 權限，請確認手機已開啟定位');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  // 搜尋地點名稱 (支援 OpenStreetMap 臺灣即時地理編碼)
  async handleSearchLocation(query) {
    if (!query || !query.trim()) return;
    const q = query.trim();

    // 1. 本地關鍵字比對
    const matchedCounty = TAIWAN_COUNTIES.find(c => c.name.includes(q));
    if (matchedCounty) {
      this.selectLocation(matchedCounty.name, matchedCounty.lat, matchedCounty.lng, matchedCounty.name);
      return;
    }

    const matchedSpot = POPULAR_SPOTS.find(s => s.name.includes(q) || s.desc.includes(q));
    if (matchedSpot) {
      this.selectLocation(matchedSpot.name, matchedSpot.lat, matchedSpot.lng, matchedSpot.county);
      return;
    }

    // 2. 線上 OpenStreetMap Nominatim 搜尋
    this.showToast(`🔍 正在搜尋「${q}」...`);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=tw&limit=1`;
      const res = await fetch(url);
      const data = await res.json();
      if (data && data.length > 0) {
        const item = data[0];
        const newLat = parseFloat(item.lat);
        const newLng = parseFloat(item.lon);
        const nearest = findNearestCounty(newLat, newLng);
        this.selectLocation(item.display_name.split(',')[0], newLat, newLng, nearest.name);
        this.showToast(`✅ 已定位至「${item.display_name.split(',')[0]}」`);
      } else {
        this.showToast(`未找到「${q}」，請嘗試其他名稱或點擊地圖自訂`);
      }
    } catch (e) {
      this.showToast('搜尋逾時，請直接點擊地圖標記地點');
    }
  }

  // 計算並廣播更新至所有視圖
  recalculateAndDispatch(updateFullDay = true) {
    // 組合精確日期與模擬時間
    const h = Math.floor(this.currentMinutes / 60);
    const m = this.currentMinutes % 60;
    const simTime = new Date(
      this.currentDate.getFullYear(),
      this.currentDate.getMonth(),
      this.currentDate.getDate(),
      h,
      m,
      0
    );

    // 格式化 YYYY-MM-DD
    const dateStr = this.currentDate.toISOString().slice(0, 10);

    // 1. 取得氣象署官方紀錄
    const cwaRecord = cwaUpdater.getCwaRecord(this.currentCounty, dateStr);

    // 2. 取得高精度天文計算數據
    const ephemData = getEphemerisAt(simTime, this.lat, this.lng);

    // 3. 取得全天 24H 日月天球軌跡 (若日期切換時)
    if (updateFullDay || !this.cachedTrajectories) {
      this.cachedTrajectories = getDayTrajectories(simTime, this.lat, this.lng);
      // 更新時光軸標記
      if (this.timelineSlider) {
        this.timelineSlider.updateMarkers(ephemData, cwaRecord);
      }
    }

    // 4. 更新地圖射線
    if (this.mapView) {
      this.mapView.updateRays({
        moonAz: ephemData.moon.azimuth,
        moonAlt: ephemData.moon.altitude,
        sunAz: ephemData.sun.azimuth,
        sunAlt: ephemData.sun.altitude,
        moonRiseAz: cwaRecord?.riseAz,
        moonSetAz: cwaRecord?.setAz,
        officialRecord: cwaRecord
      });
    }

    // 5. 更新羅盤視圖
    if (this.compassView) {
      this.compassView.update(ephemData, this.cachedTrajectories);
    }

    // 6. 更新 AR 相機視圖
    if (this.arView) {
      this.arView.update(ephemData, this.cachedTrajectories);
    }

    // 7. 更新星曆表與月相視圖
    if (this.ephemerisView) {
      this.ephemerisView.update(ephemData, cwaRecord, this.currentCounty);
    }

    // 8. 更新底部時光軸數據標籤
    if (this.timelineSlider) {
      this.timelineSlider.updateStatusChips(ephemData);
    }
  }

  updateDateInputDisplay() {
    const input = document.getElementById('input-date-picker');
    if (input) {
      const y = this.currentDate.getFullYear();
      const m = String(this.currentDate.getMonth() + 1).padStart(2, '0');
      const d = String(this.currentDate.getDate()).padStart(2, '0');
      input.value = `${y}-${m}-${d}`;
    }
  }

  setupModalEvents() {
    const modal = document.getElementById('modal-info');
    document.getElementById('btn-open-info')?.addEventListener('click', () => {
      modal.classList.remove('hidden');
    });
    document.getElementById('btn-close-modal')?.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });

    // 手動同步按鈕
    const syncBtn = document.getElementById('btn-manual-sync-cwa');
    const syncMsg = document.getElementById('manual-sync-status');
    syncBtn?.addEventListener('click', async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = '⏳ 正在連線氣象署伺服器...';
      syncMsg.textContent = '連線中，請稍候...';

      try {
        await cwaUpdater.checkAndAutoUpdate();
        syncMsg.textContent = '✅ 已完成氣象署資料集檢查與同步！';
        this.recalculateAndDispatch();
      } catch (e) {
        syncMsg.textContent = '連線完成，已載入最新有效版本。';
      } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = '立即檢查並同步最新氣象署資料';
      }
    });
  }

  showToast(msg) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.style.cssText = `
        position: fixed;
        top: 70px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.95);
        color: #fff;
        border: 1px solid rgba(56, 189, 248, 0.4);
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 0.78rem;
        z-index: 99999;
        box-shadow: 0 4px 16px rgba(0,0,0,0.6);
        pointer-events: none;
        transition: opacity 0.3s;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.style.opacity = '0';
    }, 2800);
  }

  // 註冊 PWA Service Worker (支援離線運算)
  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      });
    }
  }
}

// 啟動 App
window.addEventListener('DOMContentLoaded', () => {
  const app = new MoonSurveyorApp();
  app.init();
});
