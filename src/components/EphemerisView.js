/**
 * 星曆表與月相儀表板視圖 (Ephemeris & CWA Official Cross-Verification)
 * 呈現精密 3D 月相陰影、氣象署官方三年預報對照、攝影黃金藍調時段
 */

import { formatTimeHM, getAzimuthDirectionText, findNextPhases } from '../utils/astronomy.js';

export class EphemerisView {
  constructor(containerId, onDateJump) {
    this.container = document.getElementById(containerId);
    this.onDateJump = onDateJump;
    this.moonCanvas = null;
    this.moonCtx = null;
  }

  init() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="ephemeris-wrapper">
        <!-- 頂部月相卡片 -->
        <div class="glass-card moon-phase-card">
          <div class="moon-canvas-box">
            <canvas id="moon-phase-canvas" width="160" height="160"></canvas>
            <div id="moon-phase-badge" class="phase-glow-badge">滿月 100%</div>
          </div>
          <div class="moon-phase-meta">
            <h3 id="ephem-phase-title">盈凸月</h3>
            <div class="phase-details-grid">
              <div class="meta-item">
                <span class="meta-label">照亮比例</span>
                <span id="ephem-illum-val" class="meta-val highlight-gold">88%</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">月齡</span>
                <span id="ephem-age-val" class="meta-val">11.4 天</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">地月距離</span>
                <span id="ephem-dist-val" class="meta-val">384,400 km</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">視直徑</span>
                <span id="ephem-diameter-val" class="meta-val">31.2'</span>
              </div>
            </div>
            <!-- 快速跳轉月相按鈕 -->
            <div class="phase-jump-actions">
              <button id="btn-jump-full-moon" class="subtle-pill-btn">🌕 下次滿月</button>
              <button id="btn-jump-new-moon" class="subtle-pill-btn">🌑 下次新月</button>
            </div>
          </div>
        </div>

        <!-- 氣象署官方 75381 預報對照卡片 -->
        <div class="glass-card cwa-official-card">
          <div class="card-header-row">
            <div class="card-title-group">
              <span class="cwa-gov-badge">官方資料集 75381</span>
              <h4>中央氣象署月出月沒時刻對照</h4>
            </div>
            <span id="cwa-county-label" class="cwa-location-tag">臺北市</span>
          </div>

          <div class="cwa-times-grid">
            <div class="cwa-time-box">
              <span class="cwa-box-icon">🌅</span>
              <span class="cwa-box-title">官方月出時刻</span>
              <span id="cwa-rise-time" class="cwa-box-time">09:01</span>
              <span id="cwa-rise-az" class="cwa-box-az">方位 118° (東南東)</span>
            </div>
            <div class="cwa-time-box">
              <span class="cwa-box-icon">☀️</span>
              <span class="cwa-box-title">官方過中天時刻</span>
              <span id="cwa-transit-time" class="cwa-box-time">14:21</span>
              <span id="cwa-transit-alt" class="cwa-box-az">仰角 39S (南方 39°)</span>
            </div>
            <div class="cwa-time-box">
              <span class="cwa-box-icon">🌘</span>
              <span class="cwa-box-title">官方月沒時刻</span>
              <span id="cwa-set-time" class="cwa-box-time">19:38</span>
              <span id="cwa-set-az" class="cwa-box-az">方位 241° (西南西)</span>
            </div>
          </div>
          <div class="cwa-verify-footer">
            <span>✅ 氣象署 2025–2027 三年完整天文資料已離線同步</span>
          </div>
        </div>

        <!-- 攝影光影曆 (黃金時段與暮光) -->
        <div class="glass-card photo-hours-card">
          <div class="card-header-row">
            <h4>📸 攝影光影與晨昏時段 (Golden & Blue Hours)</h4>
          </div>
          <div class="photo-times-list">
            <div class="photo-row">
              <span class="photo-phase-name">🌅 晨間藍調 (Blue Hour)</span>
              <span id="time-dawn-blue" class="photo-time-span">05:12 - 05:32</span>
            </div>
            <div class="photo-row highlight-amber">
              <span class="photo-phase-name">✨ 晨間黃金時段 (Golden Hour)</span>
              <span id="time-morn-gold" class="photo-time-span">05:32 - 06:05</span>
            </div>
            <div class="photo-row">
              <span class="photo-phase-name">☀️ 太陽正午 (Solar Noon)</span>
              <span id="time-solar-noon" class="photo-time-span">11:45</span>
            </div>
            <div class="photo-row highlight-amber">
              <span class="photo-phase-name">✨ 傍晚黃金時段 (Golden Hour)</span>
              <span id="time-eve-gold" class="photo-time-span">17:15 - 17:48</span>
            </div>
            <div class="photo-row">
              <span class="photo-phase-name">🌆 傍晚藍調 (Blue Hour)</span>
              <span id="time-dusk-blue" class="photo-time-span">17:48 - 18:08</span>
            </div>
          </div>
        </div>
      </div>
    `;

    this.moonCanvas = document.getElementById('moon-phase-canvas');
    if (this.moonCanvas) {
      this.moonCtx = this.moonCanvas.getContext('2d');
    }

    // 綁定跳轉按鈕
    document.getElementById('btn-jump-full-moon')?.addEventListener('click', () => {
      if (this.lastEphemerisDate) {
        const { nextFull } = findNextPhases(this.lastEphemerisDate);
        if (nextFull && this.onDateJump) this.onDateJump(nextFull);
      }
    });

    document.getElementById('btn-jump-new-moon')?.addEventListener('click', () => {
      if (this.lastEphemerisDate) {
        const { nextNew } = findNextPhases(this.lastEphemerisDate);
        if (nextNew && this.onDateJump) this.onDateJump(nextNew);
      }
    });
  }

  update(ephemData, cwaRecord, countyName) {
    if (!ephemData) return;
    this.lastEphemerisDate = ephemData.date;

    // 1. 繪製動態月相球體
    this.drawMoonSphere(ephemData.moon.phaseValue);

    // 2. 更新月相數值
    const badge = document.getElementById('moon-phase-badge');
    const title = document.getElementById('ephem-phase-title');
    const illum = document.getElementById('ephem-illum-val');
    const age = document.getElementById('ephem-age-val');
    const dist = document.getElementById('ephem-dist-val');
    const diam = document.getElementById('ephem-diameter-val');

    if (badge) badge.textContent = `${ephemData.moon.phaseIcon} ${ephemData.moon.illuminationFraction}%`;
    if (title) title.textContent = `${ephemData.moon.phaseName}`;
    if (illum) illum.textContent = `${ephemData.moon.illuminationFraction}%`;
    if (age) age.textContent = `${ephemData.moon.moonAgeDays} 天`;
    if (dist) dist.textContent = `${ephemData.moon.distanceKm.toLocaleString()} km`;
    if (diam) {
      // 依地月距離推算視直徑 (角分)
      const arcMin = (1873.7 * 60 / ephemData.moon.distanceKm * 206265 / 3600).toFixed(1);
      diam.textContent = `${arcMin}'`;
    }

    // 3. 更新氣象署官方對照
    const countyLabel = document.getElementById('cwa-county-label');
    const riseTime = document.getElementById('cwa-rise-time');
    const riseAz = document.getElementById('cwa-rise-az');
    const transitTime = document.getElementById('cwa-transit-time');
    const transitAlt = document.getElementById('cwa-transit-alt');
    const setTime = document.getElementById('cwa-set-time');
    const setAz = document.getElementById('cwa-set-az');

    if (countyLabel) countyLabel.textContent = countyName || '選定地點';

    if (cwaRecord) {
      if (riseTime) riseTime.textContent = cwaRecord.rise || '--:--';
      if (riseAz) {
        riseAz.textContent = cwaRecord.riseAz !== null 
          ? `方位 ${cwaRecord.riseAz}° (${getAzimuthDirectionText(cwaRecord.riseAz)})` 
          : '當日未升起';
      }
      if (transitTime) transitTime.textContent = cwaRecord.transit || '--:--';
      if (transitAlt) transitAlt.textContent = `仰角 ${cwaRecord.transitAlt || '--'}`;
      if (setTime) setTime.textContent = cwaRecord.set || '--:--';
      if (setAz) {
        setAz.textContent = cwaRecord.setAz !== null 
          ? `方位 ${cwaRecord.setAz}° (${getAzimuthDirectionText(cwaRecord.setAz)})` 
          : '當日未落下';
      }
    } else {
      // 若無官方紀錄 (例如超出氣象署年份)，顯示天文計算值
      if (riseTime) riseTime.textContent = formatTimeHM(ephemData.moon.rise);
      if (riseAz) riseAz.textContent = `計算方位 ${ephemData.moon.azimuth.toFixed(0)}°`;
      if (transitTime) transitTime.textContent = '--:--';
      if (transitAlt) transitAlt.textContent = `計算仰角 ${ephemData.moon.altitude.toFixed(0)}°`;
      if (setTime) setTime.textContent = formatTimeHM(ephemData.moon.set);
      if (setAz) setAz.textContent = '--';
    }

    // 4. 更新攝影光影時段
    const sun = ephemData.sun;
    const dawnBlue = document.getElementById('time-dawn-blue');
    const mornGold = document.getElementById('time-morn-gold');
    const noon = document.getElementById('time-solar-noon');
    const eveGold = document.getElementById('time-eve-gold');
    const duskBlue = document.getElementById('time-dusk-blue');

    if (dawnBlue) dawnBlue.textContent = `${formatTimeHM(sun.nauticalDawn)} - ${formatTimeHM(sun.dawn)}`;
    if (mornGold) mornGold.textContent = `${formatTimeHM(sun.dawn)} - ${formatTimeHM(sun.goldenHourEnd)}`;
    if (noon) noon.textContent = formatTimeHM(sun.solarNoon);
    if (eveGold) eveGold.textContent = `${formatTimeHM(sun.goldenHour)} - ${formatTimeHM(sun.sunset)}`;
    if (duskBlue) duskBlue.textContent = `${formatTimeHM(sun.sunset)} - ${formatTimeHM(sun.dusk)}`;
  }

  // 繪製月相真實終結線 (Terminator Curve Shader on Canvas)
  drawMoonSphere(phase) {
    if (!this.moonCtx || !this.moonCanvas) return;
    const ctx = this.moonCtx;
    const w = this.moonCanvas.width;
    const h = this.moonCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = w / 2 - 14;

    ctx.clearRect(0, 0, w, h);

    // 外部微光暈
    const glow = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r + 12);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.15)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 12, 0, Math.PI * 2);
    ctx.fill();

    // 暗面底球
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // 繪製亮面 (依據 phase 0..1 幾何形狀)
    ctx.fillStyle = '#f8fafc';
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, phase > 0.5);

    // 橢圓終結線
    const cosVal = Math.cos(phase * 2 * Math.PI);
    const rx = Math.abs(r * cosVal);
    ctx.ellipse(cx, cy, rx, r, 0, Math.PI / 2, -Math.PI / 2, (phase < 0.25 || phase > 0.75));
    ctx.fill();
    ctx.restore();

    // 月面隕石坑微紋理
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx - r * 0.25, cy - r * 0.2, r * 0.18, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.3, cy + r * 0.15, r * 0.14, 0, Math.PI * 2);
    ctx.arc(cx - r * 0.1, cy + r * 0.35, r * 0.12, 0, Math.PI * 2);
    ctx.stroke();

    // 外框細環
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}
