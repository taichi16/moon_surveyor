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
    this.lat = 25.0375;
    this.lng = 121.5637;
    this.currentCounty = '臺北市';
    this.currentLocationName = '臺北市 (信義)';

    const now = new Date();
    this.currentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    this.currentMinutes = now.getHours() * 60 + now.getMinutes();

    this.mapView = null;
    this.compassView = null;
    this.arView = null;
    this.ephemerisView = null;
    this.timelineSlider = null;

    this.activeView = 'map';
    this.cachedTrajectories = null;
  }

  async init() {
    console.log('[MoonSurveyorApp] 啟動應用程式...');

    // 1. 先初始化視圖 (確保 Leaflet 與 DOM 容器即刻掛載，不等待非同步網路)
    this.initViews();

    // 2. 綁定頂部控制項與地點/日期事件
    this.setupHeaderEvents();
    this.setupViewTabs();
    this.setupLocationDrawer();
    this.setupModalEvents();

    // 3. 初次更新日期顯示與天文計算
    this.updateDateDisplay();
    this.recalculateAndDispatch();

    // 4. 非同步載入氣象署資料庫
    cwaUpdater.onUpdate((info) => {
      this.showToast(`🎉 氣象署資料自動更新成功！涵蓋至 ${info.endDate}`);
      this.recalculateAndDispatch();
    });
    cwaUpdater.init().then(() => {
      this.recalculateAndDispatch();
    });

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
      this.currentLocationName = `${nearest.name} (自訂點)`;
      this.updateLocationPillText();
      this.recalculateAndDispatch();
    });
    this.mapView.init(this.lat, this.lng);

    // 地圖底圖切換按鈕
    document.querySelectorAll('.layer-tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.layer-tab-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.mapView.switchTile(e.target.dataset.layer);
      });
    });

    // 地圖圖例切換按鈕
    const legendBtn = document.getElementById('btn-toggle-legend');
    const legendPop = document.getElementById('map-legend-popover');
    legendBtn?.addEventListener('click', () => {
      legendPop?.classList.toggle('hidden');
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
      this.updateDateDisplay();
      this.recalculateAndDispatch();
    });
    this.ephemerisView.init();

    // 底部時光機滑桿
    this.timelineSlider = new TimelineSlider('timeline-slider-root', (minutes) => {
      this.currentMinutes = minutes;
      this.recalculateAndDispatch(false);
    });
    this.timelineSlider.setMinutes(this.currentMinutes);
  }

  setupHeaderEvents() {
    // GPS 定位
    document.getElementById('btn-locate-gps')?.addEventListener('click', () => {
      this.locateCurrentGPS();
    });

    // 日期切換
    document.getElementById('btn-prev-day')?.addEventListener('click', () => {
      this.currentDate.setDate(this.currentDate.getDate() - 1);
      this.updateDateDisplay();
      this.recalculateAndDispatch();
    });

    document.getElementById('btn-next-day')?.addEventListener('click', () => {
      this.currentDate.setDate(this.currentDate.getDate() + 1);
      this.updateDateDisplay();
      this.recalculateAndDispatch();
    });

    document.getElementById('btn-today')?.addEventListener('click', () => {
      const now = new Date();
      this.currentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      this.currentMinutes = now.getHours() * 60 + now.getMinutes();
      this.timelineSlider.setMinutes(this.currentMinutes);
      this.updateDateDisplay();
      this.recalculateAndDispatch();
    });

    const datePicker = document.getElementById('input-date-picker');
    datePicker?.addEventListener('change', (e) => {
      if (e.target.value) {
        const [y, m, d] = e.target.value.split('-').map(Number);
        this.currentDate = new Date(y, m - 1, d);
        this.updateDateDisplay();
        this.recalculateAndDispatch();
      }
    });
  }

  setupViewTabs() {
    const tabs = document.querySelectorAll('.view-tab-item');
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

        // 視圖切換即刻觸發大小更新
        if (targetView === 'map' && this.mapView) {
          this.mapView.invalidateSize();
          setTimeout(() => this.mapView.invalidateSize(), 150);
        } else if (targetView === 'compass' && this.compassView) {
          this.compassView.resize();
        } else if (targetView === 'ar' && this.arView) {
          this.arView.resize();
        }
      });
    });
  }

  setupLocationDrawer() {
    const drawer = document.getElementById('drawer-location-search');
    const openBtn = document.getElementById('btn-open-search');
    const pillBtn = document.getElementById('btn-quick-location');
    const closeBtn = document.getElementById('btn-close-drawer');
    const searchInput = document.getElementById('input-location-search');
    const searchSubmit = document.getElementById('btn-submit-search');
    const countyGrid = document.getElementById('county-buttons-grid');
    const spotsList = document.getElementById('spots-buttons-list');

    const toggleDrawer = () => drawer?.classList.toggle('hidden');
    openBtn?.addEventListener('click', toggleDrawer);
    pillBtn?.addEventListener('click', toggleDrawer);
    closeBtn?.addEventListener('click', () => drawer?.classList.add('hidden'));

    // 生成 22 縣市按鈕
    TAIWAN_COUNTIES.forEach((c) => {
      const btn = document.createElement('button');
      btn.className = 'county-chip-btn';
      btn.textContent = c.name;
      btn.addEventListener('click', () => {
        this.selectLocation(c.name, c.lat, c.lng, c.name);
        drawer?.classList.add('hidden');
      });
      countyGrid?.appendChild(btn);
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
        drawer?.classList.add('hidden');
      });
      spotsList?.appendChild(btn);
    });

    const doSearch = () => {
      if (searchInput?.value) {
        this.handleSearchLocation(searchInput.value);
        drawer?.classList.add('hidden');
      }
    };

    searchSubmit?.addEventListener('click', doSearch);
    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
    });
  }

  selectLocation(name, lat, lng, county) {
    this.lat = lat;
    this.lng = lng;
    this.currentCounty = county;
    this.currentLocationName = name;
    this.updateLocationPillText();

    if (this.mapView) {
      this.mapView.panTo(lat, lng, 14);
    }
    this.recalculateAndDispatch();
  }

  updateLocationPillText() {
    const el = document.getElementById('current-location-pill-text');
    if (el) el.textContent = this.currentLocationName.split(' ')[0];
  }

  locateCurrentGPS() {
    if (!navigator.geolocation) {
      this.showToast('您的瀏覽器不支援 GPS 定位');
      return;
    }

    const gpsBtn = document.getElementById('btn-locate-gps');
    if (gpsBtn) gpsBtn.textContent = '⏳';

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const nearest = findNearestCounty(latitude, longitude);
        this.lat = latitude;
        this.lng = longitude;
        this.currentCounty = nearest.name;
        this.currentLocationName = `${nearest.name} (目前位置)`;
        this.updateLocationPillText();

        if (this.mapView) {
          this.mapView.panTo(latitude, longitude, 15);
        }
        if (gpsBtn) gpsBtn.textContent = '📍';
        this.showToast(`✅ 定位成功！經緯度: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
        this.recalculateAndDispatch();
      },
      (err) => {
        if (gpsBtn) gpsBtn.textContent = '📍';
        this.showToast('請確認手機已允許瀏覽器存取「定位權限」');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async handleSearchLocation(query) {
    if (!query || !query.trim()) return;
    const q = query.trim();

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
        this.showToast(`未找到「${q}」，請點選地圖直接標記`);
      }
    } catch (e) {
      this.showToast('搜尋逾時，請直接點選地圖標記');
    }
  }

  recalculateAndDispatch(updateFullDay = true) {
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

    const dateStr = this.currentDate.toISOString().slice(0, 10);
    const cwaRecord = cwaUpdater.getCwaRecord(this.currentCounty, dateStr);
    const ephemData = getEphemerisAt(simTime, this.lat, this.lng);

    if (updateFullDay || !this.cachedTrajectories) {
      this.cachedTrajectories = getDayTrajectories(simTime, this.lat, this.lng);
      if (this.timelineSlider) {
        this.timelineSlider.updateMarkers(ephemData, cwaRecord);
      }
    }

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

    if (this.compassView) {
      this.compassView.update(ephemData, this.cachedTrajectories);
    }

    if (this.arView) {
      this.arView.update(ephemData, this.cachedTrajectories);
    }

    if (this.ephemerisView) {
      this.ephemerisView.update(ephemData, cwaRecord, this.currentCounty);
    }

    if (this.timelineSlider) {
      this.timelineSlider.updateStatusChips(ephemData);
    }
  }

  updateDateDisplay() {
    const y = this.currentDate.getFullYear();
    const m = String(this.currentDate.getMonth() + 1).padStart(2, '0');
    const d = String(this.currentDate.getDate()).padStart(2, '0');
    
    const textEl = document.getElementById('date-display-text');
    if (textEl) textEl.textContent = `${y}/${m}/${d}`;

    const input = document.getElementById('input-date-picker');
    if (input) input.value = `${y}-${m}-${d}`;
  }

  setupModalEvents() {
    const modal = document.getElementById('modal-info');
    const closeModal = () => modal?.classList.add('hidden');

    document.getElementById('btn-open-info')?.addEventListener('click', () => {
      modal?.classList.remove('hidden');
    });
    document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);
    document.getElementById('btn-modal-dismiss')?.addEventListener('click', closeModal);

    modal?.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal?.classList.contains('hidden')) closeModal();
    });

    const syncBtn = document.getElementById('btn-manual-sync-cwa');
    const syncMsg = document.getElementById('manual-sync-status');
    syncBtn?.addEventListener('click', async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = '⏳ 正在連線氣象署伺服器...';
      if (syncMsg) syncMsg.textContent = '連線中，請稍候...';

      try {
        await cwaUpdater.checkAndAutoUpdate();
        if (syncMsg) syncMsg.textContent = '✅ 已完成氣象署資料集檢查與同步！';
        this.recalculateAndDispatch();
      } catch (e) {
        if (syncMsg) syncMsg.textContent = '連線完成，已載入最新有效版本。';
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
        top: 60px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.95);
        color: #fff;
        border: 1px solid rgba(56, 189, 248, 0.4);
        padding: 6px 14px;
        border-radius: 20px;
        font-size: 0.74rem;
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

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        const swUrl = (import.meta.env.BASE_URL || './').replace(/\/$/, '') + '/sw.js';
        navigator.serviceWorker.register(swUrl).catch(() => {});
      });
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new MoonSurveyorApp();
  app.init();
});
