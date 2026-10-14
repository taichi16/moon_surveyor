/**
 * 24 小時時光機滑桿元件 (Timeline Slider Dock)
 * 提供 60fps 毫秒級推演、關鍵天象標記 (日出沒/月出沒)、模擬播放功能
 */

export class TimelineSlider {
  constructor(containerId, onTimeChange) {
    this.container = document.getElementById(containerId);
    this.onTimeChange = onTimeChange;

    this.currentMinutes = 0; // 0 ~ 1439 (24小時換算分鐘)
    this.isPlaying = false;
    this.playTimer = null;

    this.sliderInput = null;
    this.timeDisplay = null;
    this.markersContainer = null;
    this.moonChip = null;
    this.sunChip = null;

    this.initDOM();
  }

  initDOM() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="timeline-dock">
        <!-- 頂部即時天體狀態數據標籤列 -->
        <div class="timeline-status-row">
          <div class="chip-group">
            <span id="chip-moon-status" class="status-chip chip-moon">🌙 月球 18° / 245°</span>
            <span id="chip-sun-status" class="status-chip chip-sun">☀️ 太陽 -42° / 282°</span>
          </div>

          <div class="playback-controls">
            <button id="btn-time-step-prev" class="time-btn time-step-btn" title="倒退 30 分鐘">⏮ -30m</button>
            <button id="btn-toggle-play" class="time-btn time-play-btn" title="模擬日間與夜空運行">
              <span id="play-icon">▶</span> <span id="play-text">播放推演</span>
            </button>
            <button id="btn-time-step-next" class="time-btn time-step-btn" title="前進 30 分鐘">+30m ⏭</button>
            <button id="btn-reset-now" class="time-btn time-now-btn" title="回到現在時刻">現在</button>
          </div>
        </div>

        <!-- 24小時滑桿軌道與刻度標記 -->
        <div class="timeline-slider-wrapper">
          <div class="slider-track-bg">
            <div id="timeline-markers" class="timeline-markers-layer"></div>
          </div>
          <input 
            type="range" 
            id="timeline-range" 
            min="0" 
            max="1439" 
            step="1" 
            value="720" 
            class="timeline-range-input"
          />
        </div>

        <!-- 底部時間刻度尺 (00:00, 06:00, 12:00, 18:00, 24:00) 與當前時刻 -->
        <div class="timeline-scale-row">
          <span class="scale-label">00:00</span>
          <span class="scale-label">06:00</span>
          <span class="scale-label">12:00</span>
          <span class="scale-label">18:00</span>
          <span class="scale-label">23:59</span>
          <div id="timeline-current-time-badge" class="current-time-badge">12:00:00</div>
        </div>
      </div>
    `;

    this.sliderInput = document.getElementById('timeline-range');
    this.timeDisplay = document.getElementById('timeline-current-time-badge');
    this.markersContainer = document.getElementById('timeline-markers');
    this.moonChip = document.getElementById('chip-moon-status');
    this.sunChip = document.getElementById('chip-sun-status');

    this.setupEvents();
  }

  setupEvents() {
    if (!this.sliderInput) return;

    // 滑動時即時觸發
    this.sliderInput.addEventListener('input', (e) => {
      this.currentMinutes = parseInt(e.target.value, 10);
      this.updateTimeDisplay();
      if (this.onTimeChange) {
        this.onTimeChange(this.currentMinutes);
      }
    });

    // 播放 / 暫停模擬
    document.getElementById('btn-toggle-play')?.addEventListener('click', () => {
      this.togglePlay();
    });

    // 步進控制
    document.getElementById('btn-time-step-prev')?.addEventListener('click', () => {
      this.stepMinutes(-30);
    });
    document.getElementById('btn-time-step-next')?.addEventListener('click', () => {
      this.stepMinutes(30);
    });

    // 重設為當前真實時間
    document.getElementById('btn-reset-now')?.addEventListener('click', () => {
      this.resetToNow();
    });
  }

  stepMinutes(delta) {
    this.currentMinutes = (this.currentMinutes + delta + 1440) % 1440;
    this.sliderInput.value = this.currentMinutes;
    this.updateTimeDisplay();
    if (this.onTimeChange) this.onTimeChange(this.currentMinutes);
  }

  resetToNow() {
    const now = new Date();
    this.currentMinutes = now.getHours() * 60 + now.getMinutes();
    this.sliderInput.value = this.currentMinutes;
    this.updateTimeDisplay();
    if (this.onTimeChange) this.onTimeChange(this.currentMinutes);
  }

  setMinutes(mins) {
    this.currentMinutes = mins;
    if (this.sliderInput) this.sliderInput.value = mins;
    this.updateTimeDisplay();
  }

  updateTimeDisplay() {
    const h = Math.floor(this.currentMinutes / 60);
    const m = this.currentMinutes % 60;
    const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (this.timeDisplay) {
      this.timeDisplay.textContent = timeStr;
    }
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  play() {
    this.isPlaying = true;
    const icon = document.getElementById('play-icon');
    const text = document.getElementById('play-text');
    if (icon) icon.textContent = '⏸';
    if (text) text.textContent = '暫停推演';

    // 以 1 秒跳躍 20 分鐘的速度流暢推演
    this.playTimer = setInterval(() => {
      this.currentMinutes = (this.currentMinutes + 2) % 1440;
      this.sliderInput.value = this.currentMinutes;
      this.updateTimeDisplay();
      if (this.onTimeChange) this.onTimeChange(this.currentMinutes);
    }, 40);
  }

  pause() {
    this.isPlaying = false;
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
    const icon = document.getElementById('play-icon');
    const text = document.getElementById('play-text');
    if (icon) icon.textContent = '▶';
    if (text) text.textContent = '播放推演';
  }

  // 更新軌道上的日月節點標記 (日出、日落、月出、月落)
  updateMarkers(ephemData, cwaRecord) {
    if (!this.markersContainer || !ephemData) return;
    this.markersContainer.innerHTML = '';

    const markers = [];

    // 日出
    if (ephemData.sun.sunrise) {
      const m = ephemData.sun.sunrise.getHours() * 60 + ephemData.sun.sunrise.getMinutes();
      markers.push({ min: m, icon: '🌅', label: '日出', class: 'marker-sunrise' });
    }
    // 日落
    if (ephemData.sun.sunset) {
      const m = ephemData.sun.sunset.getHours() * 60 + ephemData.sun.sunset.getMinutes();
      markers.push({ min: m, icon: '🌇', label: '日沒', class: 'marker-sunset' });
    }
    // 官方月出 / 計算月出
    if (cwaRecord?.rise && cwaRecord.rise.includes(':')) {
      const [h, min] = cwaRecord.rise.split(':').map(Number);
      markers.push({ min: h * 60 + min, icon: '🌕', label: '官方月出', class: 'marker-moonrise' });
    } else if (ephemData.moon.rise) {
      const m = ephemData.moon.rise.getHours() * 60 + ephemData.moon.rise.getMinutes();
      markers.push({ min: m, icon: '🌕', label: '月出', class: 'marker-moonrise' });
    }
    // 官方月沒 / 計算月沒
    if (cwaRecord?.set && cwaRecord.set.includes(':')) {
      const [h, min] = cwaRecord.set.split(':').map(Number);
      markers.push({ min: h * 60 + min, icon: '🌘', label: '官方月沒', class: 'marker-moonset' });
    } else if (ephemData.moon.set) {
      const m = ephemData.moon.set.getHours() * 60 + ephemData.moon.set.getMinutes();
      markers.push({ min: m, icon: '🌘', label: '月沒', class: 'marker-moonset' });
    }

    markers.forEach((item) => {
      const pct = (item.min / 1440) * 100;
      const el = document.createElement('div');
      el.className = `timeline-marker-pin ${item.class}`;
      el.style.left = `${pct}%`;
      el.title = `${item.label}: ${Math.floor(item.min / 60)}:${String(item.min % 60).padStart(2, '0')}`;
      el.innerHTML = `<span>${item.icon}</span>`;
      this.markersContainer.appendChild(el);
    });
  }

  // 更新頂部標籤狀態 (仰角與方位)
  updateStatusChips(ephemData) {
    if (!ephemData) return;
    const { moon, sun } = ephemData;

    if (this.moonChip) {
      const isUp = moon.altitude > 0;
      this.moonChip.innerHTML = `🌙 月球: <b>${moon.altitude > 0 ? '+' : ''}${moon.altitude.toFixed(1)}°</b> / ${moon.azimuth.toFixed(0)}° (${isUp ? '地平線上' : '地平線下'})`;
      this.moonChip.className = `status-chip chip-moon ${isUp ? 'is-up' : 'is-down'}`;
    }

    if (this.sunChip) {
      const isDay = sun.altitude > 0;
      this.sunChip.innerHTML = `☀️ 太陽: <b>${sun.altitude > 0 ? '+' : ''}${sun.altitude.toFixed(1)}°</b> / ${sun.azimuth.toFixed(0)}° (${isDay ? '日間' : '夜間'})`;
      this.sunChip.className = `status-chip chip-sun ${isDay ? 'is-up' : 'is-down'}`;
    }
  }
}
