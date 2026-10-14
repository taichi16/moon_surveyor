/**
 * 高精度天文曆算模組 (基於 SunCalc 與標準天體力學公式)
 */
import * as SunCalc from 'suncalc';
import { TAIWAN_COUNTIES } from './constants.js';

// 弧度轉標準羅盤方位角 (0° = 正北, 90° = 正東, 180° = 正南, 270° = 正西)
export function normalizeAzimuth(azimuthDeg) {
  return ((azimuthDeg % 360) + 360) % 360;
}

// 根據經緯度尋找最近的臺灣縣市
export function findNearestCounty(lat, lng) {
  let minDistance = Infinity;
  let nearest = TAIWAN_COUNTIES[0];

  for (const county of TAIWAN_COUNTIES) {
    const dLat = (county.lat - lat) * 111;
    const dLng = (county.lng - lng) * 102;
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = county;
    }
  }
  return nearest;
}

// 取得月相中文名稱與圖標
export function getMoonPhaseInfo(phaseFraction) {
  // phaseFraction: 0 (新月) -> 0.25 (上弦月) -> 0.5 (滿月) -> 0.75 (下弦月) -> 1.0 (新月)
  const age = phaseFraction * 29.53058867; // 月齡天數
  let name = '';
  let icon = '🌑';

  if (phaseFraction < 0.03 || phaseFraction >= 0.97) {
    name = '新月 (朔月)';
    icon = '🌑';
  } else if (phaseFraction < 0.22) {
    name = '娥眉月 (眉月)';
    icon = '🌒';
  } else if (phaseFraction < 0.28) {
    name = '上弦月';
    icon = '🌓';
  } else if (phaseFraction < 0.47) {
    name = '盈凸月 (上凸月)';
    icon = '🌔';
  } else if (phaseFraction < 0.53) {
    name = '滿月 (望月)';
    icon = '🌕';
  } else if (phaseFraction < 0.72) {
    name = '虧凸月 (下凸月)';
    icon = '🌖';
  } else if (phaseFraction < 0.78) {
    name = '下弦月';
    icon = '🌗';
  } else {
    name = '殘月';
    icon = '🌘';
  }

  return { name, icon, age: parseFloat(age.toFixed(1)) };
}

/**
 * 取得指定時間與座標的天文數據
 */
export function getEphemerisAt(date, lat, lng) {
  const moonPos = SunCalc.getMoonPosition(date, lat, lng);
  const sunPos = SunCalc.getPosition(date, lat, lng);
  const moonIllum = SunCalc.getMoonIllumination(date);

  const moonAlt = moonPos.altitude;
  const moonAz = normalizeAzimuth(moonPos.azimuth);

  const sunAlt = sunPos.altitude;
  const sunAz = normalizeAzimuth(sunPos.azimuth);

  const phaseInfo = getMoonPhaseInfo(moonIllum.phase);

  // 計算整天日月時間節點
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
  const sunTimes = SunCalc.getTimes(startOfDay, lat, lng);
  const moonTimes = SunCalc.getMoonTimes(startOfDay, lat, lng);

  return {
    date,
    lat,
    lng,
    moon: {
      altitude: moonAlt,
      azimuth: moonAz,
      distanceKm: Math.round(moonPos.distance),
      parallacticAngle: moonPos.parallacticAngle,
      illuminationFraction: Math.round(moonIllum.fraction * 100),
      phaseValue: moonIllum.phase,
      phaseName: phaseInfo.name,
      phaseIcon: phaseInfo.icon,
      moonAgeDays: phaseInfo.age,
      rise: moonTimes.rise || null,
      set: moonTimes.set || null,
      isAlwaysUp: moonTimes.alwaysUp || false,
      isAlwaysDown: moonTimes.alwaysDown || false
    },
    sun: {
      altitude: sunAlt,
      azimuth: sunAz,
      sunrise: sunTimes.sunrise || null,
      sunset: sunTimes.sunset || null,
      solarNoon: sunTimes.solarNoon || null,
      goldenHour: sunTimes.goldenHour || null,
      goldenHourEnd: sunTimes.goldenHourEnd || null,
      dawn: sunTimes.dawn || null,
      dusk: sunTimes.dusk || null,
      nauticalDawn: sunTimes.nauticalDawn || null,
      nauticalDusk: sunTimes.nauticalDusk || null,
      night: sunTimes.night || null,
      nightEnd: sunTimes.nightEnd || null,
      isDay: sunAlt > 0
    }
  };
}

/**
 * 採樣當天 24 小時的日月天球軌跡 (每 15 分鐘一個點，供羅盤與 AR 弧線繪製)
 */
export function getDayTrajectories(date, lat, lng) {
  const points = [];
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();

  for (let hour = 0; hour < 24; hour++) {
    for (let min = 0; min < 60; min += 15) {
      const t = new Date(y, m, d, hour, min, 0);
      const moonP = SunCalc.getMoonPosition(t, lat, lng);
      const sunP = SunCalc.getPosition(t, lat, lng);

      points.push({
        time: t,
        timeStr: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
        moon: {
          altitude: moonP.altitude,
          azimuth: normalizeAzimuth(moonP.azimuth)
        },
        sun: {
          altitude: sunP.altitude,
          azimuth: normalizeAzimuth(sunP.azimuth)
        }
      });
    }
  }

  return points;
}

/**
 * 尋找最近的下一個滿月與新月日期
 */
export function findNextPhases(fromDate) {
  let nextFull = null;
  let nextNew = null;
  const current = new Date(fromDate.getTime());

  // 搜尋未來 45 天
  for (let i = 1; i <= 45; i++) {
    const t = new Date(current.getTime() + i * 86400000);
    const illum = SunCalc.getMoonIllumination(t);
    // 滿月 phase 近似 0.5
    if (!nextFull && Math.abs(illum.phase - 0.5) < 0.02) {
      nextFull = t;
    }
    // 新月 phase 近似 0.0 或 1.0
    if (!nextNew && (illum.phase < 0.02 || illum.phase > 0.98)) {
      nextNew = t;
    }
    if (nextFull && nextNew) break;
  }

  return { nextFull, nextNew };
}

// 格式化 HH:mm
export function formatTimeHM(dateObj) {
  if (!dateObj || !(dateObj instanceof Date) || isNaN(dateObj.getTime())) return '--:--';
  const h = String(dateObj.getHours()).padStart(2, '0');
  const m = String(dateObj.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// 方位角轉八方位文字 (例如 118° -> 東南東)
export function getAzimuthDirectionText(deg) {
  if (deg === null || deg === undefined || isNaN(deg)) return '--';
  const directions = [
    '正北 (N)', '北北東 (NNE)', '東北 (NE)', '東北東 (ENE)',
    '正東 (E)', '東南東 (ESE)', '東南 (SE)', '南南東 (SSE)',
    '正南 (S)', '南南西 (SSW)', '西南 (SW)', '西南西 (WSW)',
    '正西 (W)', '西北西 (WNW)', '西北 (NW)', '北北西 (NNW)'
  ];
  const index = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return directions[index];
}
