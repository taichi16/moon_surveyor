/**
 * 擴增實境相機視圖 (AR Augmented Reality Camera View)
 * 調用手機後鏡頭與感測器，將月亮與太陽的運行軌跡直接投影在真實天空中
 * (桌機或無相機權限時自動提供逼真的模擬星空天際線背景)
 */

export class ARCameraView {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.video = null;
    this.canvas = null;
    this.ctx = null;

    this.stream = null;
    this.isCameraActive = false;
    this.isSimulated = false;

    // 視場角 (Field of View，手機鏡頭約 60 度)
    this.fovH = 65; 
    this.fovV = 45;

    // 感測器姿態
    this.heading = 120; // 水平方位
    this.pitch = 20;    // 仰角 (垂直)
    this.roll = 0;      // 旋轉

    // 數據快取
    this.currentData = null;
    this.dayTrajectories = [];

    this.initDOM();
  }

  initDOM() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="ar-wrapper">
        <video id="ar-video" autoplay playsinline muted class="ar-video-stream"></video>
        <canvas id="ar-overlay-canvas" class="ar-overlay"></canvas>
        <div class="ar-controls-dock">
          <button id="btn-toggle-camera" class="ar-glass-btn">
            📷 <span id="ar-cam-text">啟動手機鏡頭</span>
          </button>
          <button id="btn-calibrate-ar" class="ar-glass-btn">
            🧭 校準指南針
          </button>
        </div>
        <div class="ar-hud-badge">
          <span id="ar-hud-az">方位: 120° ESE</span>
          <span class="hud-sep">|</span>
          <span id="ar-hud-alt">仰角: +20°</span>
        </div>
      </div>
    `;

    this.video = document.getElementById('ar-video');
    this.canvas = document.getElementById('ar-overlay-canvas');
    this.ctx = this.canvas.getContext('2d');

    document.getElementById('btn-toggle-camera').addEventListener('click', () => {
      this.toggleCamera();
    });

    document.getElementById('btn-calibrate-ar').addEventListener('click', () => {
      this.heading = (this.heading + 15) % 360;
      this.render();
    });

    this.setupInteractions();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.render();
  }

  setupInteractions() {
    // 監聽設備姿態
    window.addEventListener('deviceorientation', (e) => {
      if (e.webkitCompassHeading !== undefined) {
        this.heading = e.webkitCompassHeading;
      } else if (e.alpha !== null) {
        this.heading = (360 - e.alpha) % 360;
      }
      if (e.beta !== null) {
        // beta 90 = 手機直立向上
        this.pitch = e.beta - 90;
      }
      this.render();
    });

    // 支援手勢滑動手動調整方位與仰角 (方便桌面測試)
    let isDragging = false;
    let startX = 0, startY = 0;

    const onStart = (x, y) => {
      isDragging = true;
      startX = x;
      startY = y;
    };

    const onMove = (x, y) => {
      if (!isDragging) return;
      const dx = x - startX;
      const dy = y - startY;
      startX = x;
      startY = y;

      this.heading = (this.heading - dx * 0.2 + 360) % 360;
      this.pitch = Math.max(-30, Math.min(85, this.pitch + dy * 0.2));
      this.render();
    };

    const onEnd = () => { isDragging = false; };

    this.canvas.addEventListener('mousedown', (e) => onStart(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onEnd);

    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) onStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    window.addEventListener('touchend', onEnd);
  }

  async toggleCamera() {
    if (this.isCameraActive) {
      this.stopCamera();
    } else {
      await this.startCamera();
    }
  }

  async startCamera() {
    const textEl = document.getElementById('ar-cam-text');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('此瀏覽器不支援相機 API');
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      this.video.srcObject = this.stream;
      await this.video.play();
      this.isCameraActive = true;
      this.isSimulated = false;
      if (textEl) textEl.textContent = '關閉實景相機';
    } catch (err) {
      console.warn('無法開啟實體相機，自動啟用全景模擬背景:', err);
      this.isSimulated = true;
      this.isCameraActive = false;
      if (textEl) textEl.textContent = '相機未授權 (模擬實景中)';
    }
    this.render();
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.isCameraActive = false;
    this.isSimulated = true;
    const textEl = document.getElementById('ar-cam-text');
    if (textEl) textEl.textContent = '啟動手機鏡頭';
    this.render();
  }

  update(data, trajectories = []) {
    this.currentData = data;
    this.dayTrajectories = trajectories;
    this.render();
  }

  // 將世界天球 (方位角 az, 仰角 alt) 投影到目前相機螢幕 (X, Y)
  projectToScreen(az, alt) {
    // 水平角差 (需考慮跨越 0°/360°)
    let dAz = az - this.heading;
    while (dAz > 180) dAz -= 360;
    while (dAz < -180) dAz += 360;

    // 垂直角差
    const dAlt = alt - this.pitch;

    // 視場角換算像素
    const pxPerDegX = this.width / this.fovH;
    const pxPerDegY = this.height / this.fovV;

    const screenX = this.width / 2 + dAz * pxPerDegX;
    const screenY = this.height / 2 - dAlt * pxPerDegY;

    const isVisible = Math.abs(dAz) < this.fovH / 1.5 && Math.abs(dAlt) < this.fovV / 1.5;

    return { x: screenX, y: screenY, isVisible };
  }

  render() {
    if (!this.ctx || !this.width || !this.height) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.clearRect(0, 0, w, h);

    // 1. 若無相機畫面，繪製擬真星空背景
    if (!this.isCameraActive) {
      this.drawSimulatedBackground(ctx, w, h);
    }

    // 2. 頂部水平羅盤滾動刻度帶 (Heading Ribbon)
    this.drawHeadingRibbon(ctx, w);

    // 3. 虛擬地平線 (Horizon) 與仰角階梯
    this.drawHorizonAndPitchLadder(ctx, w, h);

    // 4. 繪製日月在空中的虛擬運行天軌
    if (this.dayTrajectories.length > 0) {
      this.drawARVirtualTrack(ctx, 'sun', '#f59e0b');
      this.drawARVirtualTrack(ctx, 'moon', '#38bdf8');
    }

    // 5. 繪製空中當前太陽與月亮
    if (this.currentData) {
      const { sun, moon } = this.currentData;
      if (sun) this.drawARCelestialBody(ctx, sun.azimuth, sun.altitude, 'sun');
      if (moon) this.drawARCelestialBody(ctx, moon.azimuth, moon.altitude, 'moon', moon.phaseIcon);
    }

    // 6. 中央準心
    this.drawCrosshair(ctx, w / 2, h / 2);

    // 更新 HUD 文字
    const azEl = document.getElementById('ar-hud-az');
    const altEl = document.getElementById('ar-hud-alt');
    if (azEl) azEl.textContent = `朝向: ${Math.round(this.heading)}°`;
    if (altEl) altEl.textContent = `仰角: ${this.pitch > 0 ? '+' : ''}${Math.round(this.pitch)}°`;
  }

  // 模擬山脈夜空背景
  drawSimulatedBackground(ctx, w, h) {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0, '#060a17');
    skyGrad.addColorStop(0.7, '#0f172a');
    skyGrad.addColorStop(1, '#1e293b');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    // 繁星點點
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    const seed = 42;
    for (let i = 0; i < 40; i++) {
      const sx = ((i * 137.5) % w);
      const sy = ((i * 93.7) % (h * 0.65));
      ctx.beginPath();
      ctx.arc(sx, sy, (i % 3) * 0.7 + 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 頂部方位滾動刻度帶
  drawHeadingRibbon(ctx, w) {
    const cy = 28;
    const pxPerDeg = w / this.fovH;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
    ctx.fillRect(0, 0, w, 44);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.strokeRect(0, 0, w, 44);

    const startDeg = Math.floor(this.heading - this.fovH / 2);
    const endDeg = Math.ceil(this.heading + this.fovH / 2);

    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let deg = startDeg; deg <= endDeg; deg++) {
      const norm = ((deg % 360) + 360) % 360;
      const x = w / 2 + (deg - this.heading) * pxPerDeg;

      if (norm % 15 === 0) {
        const isCardinal = norm % 90 === 0;
        ctx.strokeStyle = isCardinal ? '#ef4444' : 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = isCardinal ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x, cy);
        ctx.lineTo(x, cy + (isCardinal ? 12 : 7));
        ctx.stroke();

        const labels = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
        ctx.fillStyle = isCardinal ? '#ef4444' : 'rgba(255, 255, 255, 0.8)';
        ctx.fillText(labels[norm] || `${norm}°`, x, cy - 14);
      }
    }

    // 頂部中央指示三角形
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(w / 2, 42);
    ctx.lineTo(w / 2 - 5, 48);
    ctx.lineTo(w / 2 + 5, 48);
    ctx.closePath();
    ctx.fill();
  }

  // 虛擬地平線與仰角階梯
  drawHorizonAndPitchLadder(ctx, w, h) {
    const pxPerDegY = h / this.fovV;
    const horizonY = h / 2 + this.pitch * pxPerDegY;

    // 0° 地平線
    if (horizonY >= 0 && horizonY <= h) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(w, horizonY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#38bdf8';
      ctx.font = '10px sans-serif';
      ctx.fillText('0° 地平線 (HORIZON)', 75, horizonY - 6);
    }

    // 仰角刻度線 (+10°, +20°, +30°, ...)
    for (let alt = -20; alt <= 80; alt += 10) {
      if (alt === 0) continue;
      const y = h / 2 - (alt - this.pitch) * pxPerDegY;
      if (y >= 50 && y <= h - 40) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(w / 2 - 40, y);
        ctx.lineTo(w / 2 + 40, y);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.fillText(`${alt > 0 ? '+' : ''}${alt}°`, w / 2 + 50, y + 3);
      }
    }
  }

  // 繪製虛擬天軌 (AR 弧線)
  drawARVirtualTrack(ctx, type, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();

    let started = false;
    for (const pt of this.dayTrajectories) {
      const obj = pt[type];
      const p = this.projectToScreen(obj.azimuth, obj.altitude);
      if (p.x >= -100 && p.x <= this.width + 100 && p.y >= -100 && p.y <= this.height + 100) {
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      } else {
        started = false;
      }
    }
    ctx.stroke();
  }

  // 繪製 AR 視圖中的月球/太陽球體
  drawARCelestialBody(ctx, az, alt, type, icon = '☀️') {
    const p = this.projectToScreen(az, alt);
    const isSun = type === 'sun';

    // 若在視場外，在螢幕邊緣顯示導航箭頭
    if (p.x < 30 || p.x > this.width - 30 || p.y < 60 || p.y > this.height - 40) {
      this.drawOffScreenIndicator(ctx, p.x, p.y, isSun ? '☀️' : '🌙', isSun ? '#eab308' : '#38bdf8');
      return;
    }

    const { x, y } = p;

    // 外發光
    const glow = ctx.createRadialGradient(x, y, 5, x, y, 32);
    glow.addColorStop(0, isSun ? 'rgba(251, 191, 36, 0.95)' : 'rgba(56, 189, 248, 0.95)');
    glow.addColorStop(0.6, isSun ? 'rgba(245, 158, 11, 0.35)' : 'rgba(14, 165, 233, 0.3)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 32, 0, Math.PI * 2);
    ctx.fill();

    // 實體球
    ctx.fillStyle = isSun ? '#fef08a' : '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, isSun ? 14 : 12, 0, Math.PI * 2);
    ctx.fill();

    // 標籤浮動膠囊
    ctx.font = '11px -apple-system, sans-serif';
    const label = `${isSun ? '太陽 ☀️' : '月球 🌙'} (${alt.toFixed(1)}°)`;
    const tw = ctx.measureText(label).width + 16;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = isSun ? '#eab308' : '#38bdf8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - tw / 2, y + 20, tw, 22, 11);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + 34);
  }

  // 螢幕外天體導向指示器
  drawOffScreenIndicator(ctx, targetX, targetY, icon, color) {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const angle = Math.atan2(targetY - cy, targetX - cx);

    const margin = 40;
    const rx = Math.cos(angle) * (this.width / 2 - margin);
    const ry = Math.sin(angle) * (this.height / 2 - margin);
    const indX = cx + rx;
    const indY = cy + ry;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(indX, indY, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, indX, indY);
  }

  // 中央十字瞄準線
  drawCrosshair(ctx, cx, cy) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 15, cy); ctx.lineTo(cx - 5, cy);
    ctx.moveTo(cx + 5, cy); ctx.lineTo(cx + 15, cy);
    ctx.moveTo(cx, cy - 15); ctx.lineTo(cx, cy - 5);
    ctx.moveTo(cx, cy + 5); ctx.lineTo(cx, cy + 15);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
  }
}
