/**
 * 天球羅盤視圖 (3D / 2D Celestial Compass View)
 * 支援手機陀螺儀/電子羅盤 (DeviceOrientation) 隨身旋轉
 * 繪製天頂俯視仰角同心環 (0°~90°)、日月 24H 天球軌跡弧線與即時方位
 */

export class CompassView {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;

    // 視角旋轉狀態 (度數)
    this.heading = 0; // 朝向 (0 = 北)
    this.pitch = 0;   // 俯仰 (0 = 平放, 90 = 直立)
    this.isSensorActive = false;
    this.isManualDragging = false;
    this.lastTouchX = 0;

    // 天文渲染數據快取
    this.currentData = null;
    this.dayTrajectories = [];

    this.initCanvas();
    this.setupInteractions();
  }

  initCanvas() {
    if (!this.canvas) return;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    if (this.ctx) {
      this.ctx.scale(dpr, dpr);
    }
    this.render();
  }

  setupInteractions() {
    if (!this.canvas) return;

    // 手動觸控/滑鼠拖曳旋轉羅盤
    const onStart = (clientX) => {
      this.isManualDragging = true;
      this.lastTouchX = clientX;
    };

    const onMove = (clientX) => {
      if (!this.isManualDragging) return;
      const dx = clientX - this.lastTouchX;
      this.lastTouchX = clientX;
      this.heading = (this.heading - dx * 0.5 + 360) % 360;
      this.render();
    };

    const onEnd = () => {
      this.isManualDragging = false;
    };

    this.canvas.addEventListener('mousedown', (e) => onStart(e.clientX));
    window.addEventListener('mousemove', (e) => onMove(e.clientX));
    window.addEventListener('mouseup', onEnd);

    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) onStart(e.touches[0].clientX);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) onMove(e.touches[0].clientX);
    }, { passive: true });

    window.addEventListener('touchend', onEnd);
  }

  // 啟用手機真實陀螺儀/電子指南針
  async enableSensor() {
    if (typeof DeviceOrientationEvent !== 'undefined') {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iOS 13+ 權限請求
        try {
          const permission = await DeviceOrientationEvent.requestPermission();
          if (permission === 'granted') {
            this.bindOrientationEvent();
            return true;
          }
        } catch (e) {
          console.warn('陀螺儀權限被拒絕或發生錯誤', e);
        }
      } else {
        // Android / 標準瀏覽器
        this.bindOrientationEvent();
        return true;
      }
    }
    return false;
  }

  bindOrientationEvent() {
    window.addEventListener('deviceorientation', (e) => {
      if (this.isManualDragging) return; // 手動拖曳時優先

      let compassHeading = null;
      if (e.webkitCompassHeading !== undefined) {
        // iOS Safari 專用高精度磁北羅盤航向
        compassHeading = e.webkitCompassHeading;
      } else if (e.alpha !== null) {
        // Android / 標準設備 (alpha 為逆時針旋轉角度)
        compassHeading = (360 - e.alpha) % 360;
      }

      if (compassHeading !== null) {
        this.heading = compassHeading;
        this.pitch = e.beta || 0;
        this.isSensorActive = true;
        this.render();
      }
    });
  }

  // 更新數據
  update(data, trajectories = []) {
    this.currentData = data;
    this.dayTrajectories = trajectories;
    this.render();
  }

  render() {
    if (!this.ctx || !this.width || !this.height) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) - 26;

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(cx, cy);

    // 依據 heading 旋轉羅盤盤面
    ctx.rotate((-this.heading * Math.PI) / 180);

    // 1. 繪製星空暗夜漸層底盤
    const bgGrad = ctx.createRadialGradient(0, 0, 10, 0, 0, radius);
    bgGrad.addColorStop(0, '#0c1427');
    bgGrad.addColorStop(0.7, '#070b14');
    bgGrad.addColorStop(1, '#020409');
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    // 2. 仰角同心環 (0° 地平線, 30°, 60°, 90° 天頂)
    const ringAlts = [0, 30, 60];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '10px -apple-system, sans-serif';

    ringAlts.forEach((alt) => {
      const r = radius * ((90 - alt) / 90);
      ctx.strokeStyle = alt === 0 ? 'rgba(255, 255, 255, 0.35)' : 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = alt === 0 ? 1.5 : 1;
      ctx.setLineDash(alt === 0 ? [] : [3, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();

      if (alt > 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillText(`${alt}°`, 0, -r + 10);
      }
    });
    ctx.setLineDash([]);

    // 天頂十字準心 (90°)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-10, 0); ctx.lineTo(10, 0);
    ctx.moveTo(0, -10); ctx.lineTo(0, 10);
    ctx.stroke();

    // 3. 360° 方位刻度與文字
    ctx.font = '11px -apple-system, sans-serif';
    for (let deg = 0; deg < 360; deg += 10) {
      const rad = (deg * Math.PI) / 180;
      const isMajor = deg % 90 === 0;
      const isMedium = deg % 30 === 0;
      const tickLen = isMajor ? 12 : (isMedium ? 8 : 4);

      const x1 = Math.sin(rad) * radius;
      const y1 = -Math.cos(rad) * radius;
      const x2 = Math.sin(rad) * (radius - tickLen);
      const y2 = -Math.cos(rad) * (radius - tickLen);

      ctx.strokeStyle = isMajor ? '#38bdf8' : (isMedium ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)');
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      if (isMajor) {
        const labelDist = radius - 20;
        const lx = Math.sin(rad) * labelDist;
        const ly = -Math.cos(rad) * labelDist;
        const dirs = { 0: 'N (北)', 90: 'E (東)', 180: 'S (南)', 270: 'W (西)' };

        ctx.fillStyle = deg === 0 ? '#ef4444' : '#38bdf8';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(dirs[deg], lx, ly);
      }
    }

    // 4. 繪製整日太陽運行天球弧線 (金黃色漸層)
    if (this.dayTrajectories.length > 0) {
      this.drawTrajectoryArc(ctx, radius, 'sun', '#f59e0b', 'rgba(245, 158, 11, 0.15)');
      this.drawTrajectoryArc(ctx, radius, 'moon', '#38bdf8', 'rgba(56, 189, 248, 0.2)');
    }

    // 5. 繪製當前月球與太陽標記點
    if (this.currentData) {
      const { sun, moon } = this.currentData;

      // 太陽位置
      if (sun && sun.altitude > -18) {
        const sunPos = this.altAzToXY(sun.altitude, sun.azimuth, radius);
        this.drawCelestialBody(ctx, sunPos.x, sunPos.y, 'sun', sun.altitude, sun.azimuth);
      }

      // 月球位置
      if (moon && moon.altitude > -18) {
        const moonPos = this.altAzToXY(moon.altitude, moon.azimuth, radius);
        this.drawCelestialBody(ctx, moonPos.x, moonPos.y, 'moon', moon.altitude, moon.azimuth, moon.phaseIcon);
      }
    }

    ctx.restore();

    // 6. 外圍固定指北標頭與航向角度顯示
    this.drawHeadingOverlay(ctx, cx, cy, radius);
  }

  // 將仰角 (alt) 與方位角 (az) 轉為羅盤平面 X, Y 座標
  altAzToXY(altitudeDeg, azimuthDeg, radius) {
    // 仰角 90° 位於中心 (0, 0)，0° 位於邊緣 radius，負仰角擴展至邊緣外
    const clampedAlt = Math.max(-10, Math.min(90, altitudeDeg));
    const r = radius * ((90 - clampedAlt) / 90);
    const rad = (azimuthDeg * Math.PI) / 180;
    return {
      x: Math.sin(rad) * r,
      y: -Math.cos(rad) * r
    };
  }

  // 繪製運行天體弧線
  drawTrajectoryArc(ctx, radius, type, strokeColor, glowColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();

    let started = false;
    for (const pt of this.dayTrajectories) {
      const obj = pt[type];
      if (obj.altitude > 0) {
        const pos = this.altAzToXY(obj.altitude, obj.azimuth, radius);
        if (!started) {
          ctx.moveTo(pos.x, pos.y);
          started = true;
        } else {
          ctx.lineTo(pos.x, pos.y);
        }
      } else {
        started = false;
      }
    }
    ctx.stroke();
  }

  // 繪製太陽/月球發光球體與數值
  drawCelestialBody(ctx, x, y, type, alt, az, icon = '☀️') {
    const isSun = type === 'sun';
    const isUp = alt > 0;

    // 光暈
    const glow = ctx.createRadialGradient(x, y, 2, x, y, 22);
    glow.addColorStop(0, isSun ? 'rgba(251, 191, 36, 0.9)' : 'rgba(56, 189, 248, 0.85)');
    glow.addColorStop(0.6, isSun ? 'rgba(245, 158, 11, 0.3)' : 'rgba(14, 165, 233, 0.25)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();

    // 核心球體
    ctx.fillStyle = isSun ? '#fef08a' : '#f8fafc';
    ctx.beginPath();
    ctx.arc(x, y, isSun ? 9 : 8, 0, Math.PI * 2);
    ctx.fill();

    // 標籤背景膠囊
    ctx.font = '10px -apple-system, sans-serif';
    const text = `${isSun ? '☀️' : '🌙'} ${alt.toFixed(0)}°`;
    const tw = ctx.measureText(text).width + 12;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = isSun ? '#eab308' : '#38bdf8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - tw / 2, y + 14, tw, 18, 9);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y + 23);
  }

  // 外圍即時指北標籤與目前朝向顯示
  drawHeadingOverlay(ctx, cx, cy, radius) {
    // 頂部當前朝向十字準星標記 (三角形)
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius - 16);
    ctx.lineTo(cx - 7, cy - radius - 26);
    ctx.lineTo(cx + 7, cy - radius - 26);
    ctx.closePath();
    ctx.fill();

    // 頂部目前朝向度數膠囊
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(cx - 45, 10, 90, 24, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(this.heading)}° ${this.isSensorActive ? '📱' : '🖐️'}`, cx, 22);
  }
}
