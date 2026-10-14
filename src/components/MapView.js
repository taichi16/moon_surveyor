/**
 * 互動地圖模式 (Interactive Map View)
 * 呈現日月方位角射線、月出月沒方向、自訂觀測點與衛星/天文圖磚
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export class MapView {
  constructor(containerId, onLocationChange) {
    this.container = document.getElementById(containerId);
    this.onLocationChange = onLocationChange;
    this.map = null;
    this.observerMarker = null;
    this.radiusCircle = null;

    // 射線圖層組
    this.raysLayer = L.layerGroup();

    // 觀測點座標
    this.lat = 25.0375;
    this.lng = 121.5637;

    // 圖磚圖層
    this.tileLayers = {};
    this.currentTileKey = 'dark';
  }

  init(lat, lng) {
    this.lat = lat;
    this.lng = lng;

    if (!this.container) return;

    // 初始化 Leaflet 地圖
    this.map = L.map(this.container, {
      center: [this.lat, this.lng],
      zoom: 14,
      zoomControl: false,
      attributionControl: false
    });

    // 預設底圖: ESRI World Dark Gray Canvas (免 API Key，專業暗夜天文灰色底圖)
    this.tileLayers.dark = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16,
      attribution: 'Esri, HERE, DeLorme, MapmyIndia'
    });

    // 衛星影像底圖: ESRI World Imagery (真實地形空照)
    this.tileLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: 'Esri, Maxar, Earthstar Geographics'
    });

    // 標準街道圖: ESRI World Street Map (免 API Key 道路與地名圖)
    this.tileLayers.streets = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: 'Esri, HERE, Garmin, USGS'
    });

    this.tileLayers.dark.addTo(this.map);
    this.raysLayer.addTo(this.map);

    // 建立可拖曳的觀測者標記
    this.createObserverMarker();

    // 點擊地圖任意處直接移動觀測點
    this.map.on('click', (e) => {
      this.setObserverLocation(e.latlng.lat, e.latlng.lng, true);
    });

    // 視窗 resize 自適應
    setTimeout(() => {
      this.map.invalidateSize();
    }, 200);
  }

  createObserverMarker() {
    const observerIcon = L.divIcon({
      className: 'observer-marker-icon',
      html: `
        <div class="observer-pin-pulse"></div>
        <div class="observer-pin-dot"></div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    this.observerMarker = L.marker([this.lat, this.lng], {
      icon: observerIcon,
      draggable: true,
      zIndexOffset: 1000
    }).addTo(this.map);

    this.radiusCircle = L.circle([this.lat, this.lng], {
      radius: 1200,
      color: 'rgba(255, 215, 0, 0.25)',
      fillColor: 'rgba(255, 215, 0, 0.05)',
      fillOpacity: 0.15,
      weight: 1,
      dashArray: '4, 4'
    }).addTo(this.map);

    this.observerMarker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      this.setObserverLocation(pos.lat, pos.lng, true);
    });
  }

  // 設定觀測點位置
  setObserverLocation(lat, lng, triggerCallback = false) {
    this.lat = lat;
    this.lng = lng;

    if (this.observerMarker) {
      this.observerMarker.setLatLng([lat, lng]);
    }
    if (this.radiusCircle) {
      this.radiusCircle.setLatLng([lat, lng]);
    }

    if (triggerCallback && this.onLocationChange) {
      this.onLocationChange(lat, lng);
    }
  }

  // 平滑飛至該座標
  panTo(lat, lng, zoom = 14) {
    this.setObserverLocation(lat, lng, false);
    if (this.map) {
      this.map.flyTo([lat, lng], zoom, { duration: 0.8 });
    }
  }

  // 切換底圖 (dark / satellite / streets)
  switchTile(key) {
    if (this.currentTileKey === key || !this.tileLayers[key]) return;
    this.map.removeLayer(this.tileLayers[this.currentTileKey]);
    this.tileLayers[key].addTo(this.map);
    this.currentTileKey = key;
    if (this.map.hasLayer(this.raysLayer)) {
      this.raysLayer.bringToFront();
    }
  }

  // 根據方位角計算終點座標 (延伸距離公尺)
  calculateDestinationPoint(lat, lng, azimuthDeg, distanceMeters = 3500) {
    const R = 6371e3; // 地球半徑
    const brng = (azimuthDeg * Math.PI) / 180;
    const phi1 = (lat * Math.PI) / 180;
    const lambda1 = (lng * Math.PI) / 180;

    const phi2 = Math.asin(
      Math.sin(phi1) * Math.cos(distanceMeters / R) +
      Math.cos(phi1) * Math.sin(distanceMeters / R) * Math.cos(brng)
    );
    const lambda2 = lambda1 + Math.atan2(
      Math.sin(brng) * Math.sin(distanceMeters / R) * Math.cos(phi1),
      Math.cos(distanceMeters / R) - Math.sin(phi1) * Math.sin(phi2)
    );

    return [ (phi2 * 180) / Math.PI, (lambda2 * 180) / Math.PI ];
  }

  /**
   * 繪製天文方位光線 (時光軸拖動時毫秒級重繪)
   */
  updateRays({ moonAz, moonAlt, sunAz, sunAlt, moonRiseAz, moonSetAz, officialRecord }) {
    if (!this.map) return;

    this.raysLayer.clearLayers();

    const origin = [this.lat, this.lng];
    const rayDist = 4500; // 射線長度 4.5 公里

    // 1. 月出方位線 (金黃色粗線)
    const riseAz = officialRecord?.riseAz ?? moonRiseAz;
    if (riseAz !== null && riseAz !== undefined) {
      const riseEnd = this.calculateDestinationPoint(this.lat, this.lng, riseAz, rayDist);
      const riseLine = L.polyline([origin, riseEnd], {
        color: '#f6c343',
        weight: 3,
        opacity: 0.85,
        dashArray: '6, 6'
      });
      riseLine.bindTooltip(`🌕 月出方位: ${riseAz.toFixed(1)}° (${officialRecord?.rise || '當日'})`, {
        permanent: false,
        className: 'map-ray-tooltip ray-rise-tooltip'
      });
      this.raysLayer.addLayer(riseLine);
    }

    // 2. 月沒方位線 (橙紅色線)
    const setAz = officialRecord?.setAz ?? moonSetAz;
    if (setAz !== null && setAz !== undefined) {
      const setEnd = this.calculateDestinationPoint(this.lat, this.lng, setAz, rayDist);
      const setLine = L.polyline([origin, setEnd], {
        color: '#f06548',
        weight: 3,
        opacity: 0.85,
        dashArray: '6, 6'
      });
      setLine.bindTooltip(`🌘 月沒方位: ${setAz.toFixed(1)}° (${officialRecord?.set || '當日'})`, {
        permanent: false,
        className: 'map-ray-tooltip ray-set-tooltip'
      });
      this.raysLayer.addLayer(setLine);
    }

    // 3. 即時太陽方位線 (熾暖琥珀金)
    if (sunAz !== undefined && sunAz !== null) {
      const sunEnd = this.calculateDestinationPoint(this.lat, this.lng, sunAz, rayDist);
      const sunOpacity = sunAlt > 0 ? 0.95 : 0.35;
      const sunLine = L.polyline([origin, sunEnd], {
        color: '#ff9800',
        weight: sunAlt > 0 ? 3.5 : 2,
        opacity: sunOpacity
      });
      sunLine.bindTooltip(`☀️ 太陽: ${sunAz.toFixed(1)}° (仰角 ${sunAlt.toFixed(1)}°)`, {
        permanent: false,
        className: 'map-ray-tooltip ray-sun-tooltip'
      });
      this.raysLayer.addLayer(sunLine);

      // 太陽末端標記
      const sunIcon = L.divIcon({
        className: 'celestial-ray-icon sun-ray-icon',
        html: `<div class="ray-tag sun-tag">${sunAlt > 0 ? '☀️' : '🌅'} ${sunAlt.toFixed(0)}°</div>`,
        iconSize: [40, 24]
      });
      this.raysLayer.addLayer(L.marker(sunEnd, { icon: sunIcon, interactive: false }));
    }

    // 4. 即時月球方位線 (夜光青銀色光束)
    if (moonAz !== undefined && moonAz !== null) {
      const moonEnd = this.calculateDestinationPoint(this.lat, this.lng, moonAz, rayDist);
      const moonOpacity = moonAlt > 0 ? 0.95 : 0.4;
      const moonLine = L.polyline([origin, moonEnd], {
        color: '#38bdf8',
        weight: moonAlt > 0 ? 4 : 2,
        opacity: moonOpacity
      });
      moonLine.bindTooltip(`🌙 月球: ${moonAz.toFixed(1)}° (仰角 ${moonAlt.toFixed(1)}°)`, {
        permanent: true,
        direction: 'top',
        className: 'map-ray-tooltip ray-moon-tooltip'
      });
      this.raysLayer.addLayer(moonLine);

      // 月球末端標記
      const moonIcon = L.divIcon({
        className: 'celestial-ray-icon moon-ray-icon',
        html: `<div class="ray-tag moon-tag">🌙 ${moonAlt.toFixed(0)}°</div>`,
        iconSize: [40, 24]
      });
      this.raysLayer.addLayer(L.marker(moonEnd, { icon: moonIcon, interactive: false }));
    }
  }

  invalidateSize() {
    if (this.map) {
      this.map.invalidateSize();
    }
  }
}
