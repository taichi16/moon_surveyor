/**
 * 互動地圖模式 (Interactive Map View)
 * 整合高畫質 ESRI 免費圖磚（暗夜天文含標註、衛星空照含標註、地形街道）
 * 繪製月出、月沒、即時月球與太陽方位角射線
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

    // 觀測點座標 (預設台北市信義區)
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

    // 1. 暗夜天文底圖 (ESRI World Dark Gray Base + Reference 道路地名標註)
    this.tileLayers.dark = L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 16
      }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 16
      })
    ]);

    // 2. 衛星空照底圖 (ESRI World Imagery + 邊界地名)
    this.tileLayers.satellite = L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18
      }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18
      })
    ]);

    // 3. 標準街道底圖 (ESRI World Street Map)
    this.tileLayers.streets = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18
    });

    // 預設載入暗夜天文圖層與射線圖層
    this.tileLayers.dark.addTo(this.map);
    this.raysLayer.addTo(this.map);

    // 建立可拖曳的觀測者標記與半徑環
    this.createObserverMarker();

    // 點擊地圖任意處直接移動觀測點
    this.map.on('click', (e) => {
      this.setObserverLocation(e.latlng.lat, e.latlng.lng, true);
    });

    // 多階段自適應重繪 (防止 iOS Safari 尺寸計算延遲)
    this.invalidateSize();
    setTimeout(() => this.invalidateSize(), 150);
    setTimeout(() => this.invalidateSize(), 500);
    window.addEventListener('resize', () => this.invalidateSize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.invalidateSize(), 200));
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
      color: 'rgba(255, 215, 0, 0.4)',
      fillColor: 'rgba(255, 215, 0, 0.08)',
      fillOpacity: 0.15,
      weight: 1.5,
      dashArray: '5, 5'
    }).addTo(this.map);

    this.observerMarker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      this.setObserverLocation(pos.lat, pos.lng, true);
    });
  }

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

  panTo(lat, lng, zoom = 14) {
    this.setObserverLocation(lat, lng, false);
    if (this.map) {
      this.map.flyTo([lat, lng], zoom, { duration: 0.8 });
      setTimeout(() => this.invalidateSize(), 850);
    }
  }

  switchTile(key) {
    if (this.currentTileKey === key || !this.tileLayers[key] || !this.map) return;
    this.map.removeLayer(this.tileLayers[this.currentTileKey]);
    this.tileLayers[key].addTo(this.map);
    this.currentTileKey = key;
    if (this.map.hasLayer(this.raysLayer)) {
      this.raysLayer.bringToFront();
    }
  }

  calculateDestinationPoint(lat, lng, azimuthDeg, distanceMeters = 3500) {
    const R = 6371e3;
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

    return [(phi2 * 180) / Math.PI, (lambda2 * 180) / Math.PI];
  }

  updateRays({ moonAz, moonAlt, sunAz, sunAlt, moonRiseAz, moonSetAz, officialRecord }) {
    if (!this.map) return;

    this.raysLayer.clearLayers();

    const origin = [this.lat, this.lng];
    const rayDist = 4500;

    // 1. 月出方位線 (金黃色虛線)
    const riseAz = officialRecord?.riseAz ?? moonRiseAz;
    if (riseAz !== null && riseAz !== undefined && !isNaN(riseAz)) {
      const riseEnd = this.calculateDestinationPoint(this.lat, this.lng, riseAz, rayDist);
      const riseLine = L.polyline([origin, riseEnd], {
        color: '#f6c343',
        weight: 3.5,
        opacity: 0.9,
        dashArray: '6, 6'
      });
      riseLine.bindTooltip(`🌕 月出: ${riseAz.toFixed(1)}° (${officialRecord?.rise || '當日'})`, {
        permanent: false,
        className: 'map-ray-tooltip ray-rise-tooltip'
      });
      this.raysLayer.addLayer(riseLine);
    }

    // 2. 月沒方位線 (橙紅色虛線)
    const setAz = officialRecord?.setAz ?? moonSetAz;
    if (setAz !== null && setAz !== undefined && !isNaN(setAz)) {
      const setEnd = this.calculateDestinationPoint(this.lat, this.lng, setAz, rayDist);
      const setLine = L.polyline([origin, setEnd], {
        color: '#f43f5e',
        weight: 3.5,
        opacity: 0.9,
        dashArray: '6, 6'
      });
      setLine.bindTooltip(`🌘 月沒: ${setAz.toFixed(1)}° (${officialRecord?.set || '當日'})`, {
        permanent: false,
        className: 'map-ray-tooltip ray-set-tooltip'
      });
      this.raysLayer.addLayer(setLine);
    }

    // 3. 即時太陽方位線 (琥珀金色)
    if (sunAz !== undefined && sunAz !== null && !isNaN(sunAz)) {
      const sunEnd = this.calculateDestinationPoint(this.lat, this.lng, sunAz, rayDist);
      const sunOpacity = sunAlt > 0 ? 0.95 : 0.4;
      const sunLine = L.polyline([origin, sunEnd], {
        color: '#f59e0b',
        weight: sunAlt > 0 ? 3.5 : 2,
        opacity: sunOpacity
      });
      this.raysLayer.addLayer(sunLine);

      const sunIcon = L.divIcon({
        className: 'celestial-ray-icon sun-ray-icon',
        html: `<div class="ray-tag sun-tag">${sunAlt > 0 ? '☀️' : '🌅'} ${sunAlt.toFixed(0)}°</div>`,
        iconSize: [44, 22]
      });
      this.raysLayer.addLayer(L.marker(sunEnd, { icon: sunIcon, interactive: false }));
    }

    // 4. 即時月球方位線 (青銀色光芒)
    if (moonAz !== undefined && moonAz !== null && !isNaN(moonAz)) {
      const moonEnd = this.calculateDestinationPoint(this.lat, this.lng, moonAz, rayDist);
      const moonOpacity = moonAlt > 0 ? 1.0 : 0.45;
      const moonLine = L.polyline([origin, moonEnd], {
        color: '#38bdf8',
        weight: moonAlt > 0 ? 4 : 2.5,
        opacity: moonOpacity
      });
      this.raysLayer.addLayer(moonLine);

      const moonIcon = L.divIcon({
        className: 'celestial-ray-icon moon-ray-icon',
        html: `<div class="ray-tag moon-tag">🌙 ${moonAlt.toFixed(0)}°</div>`,
        iconSize: [44, 22]
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
