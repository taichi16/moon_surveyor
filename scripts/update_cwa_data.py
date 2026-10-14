#!/usr/bin/env python3
"""
CWA Moon Dataset Updater (中央氣象署月出月沒時刻自動更新程式)
Dataset ID: A-B0063-001 (月出月沒時刻)
"""

import sys
import os
import json
import ssl
import gzip
import urllib.request
from datetime import datetime

# API 端點
CWA_API_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/A-B0063-001?Authorization=rdec-key-123-45678-011121314"
CWA_FILE_API = "https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/A-B0063-001?Authorization=rdec-key-123-45678-011121314&format=JSON"
S3_FALLBACK_URL = "https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Astronomy/A-B0063-001.json"

def fetch_cwa_data():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    print("[1/3] 正在連接中央氣象署資料端點...")
    
    # 首先嘗試 S3 直連（速度最快且資料年份最完整）
    urls = [S3_FALLBACK_URL, CWA_FILE_API, CWA_API_URL]
    
    for url in urls:
        try:
            print(f"嘗試抓取: {url[:60]}...")
            req = urllib.request.Request(
                url, 
                headers={'User-Agent': 'Mozilla/5.0 MoonSurveyor-AutoUpdater/1.0'}
            )
            with urllib.request.urlopen(req, context=ctx, timeout=20) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                
                # 解析不同的回傳結構
                if 'cwaopendata' in data and 'dataset' in data['cwaopendata']:
                    locs = data['cwaopendata']['dataset'].get('location', [])
                    if locs:
                        print(f"成功取得 CWA 檔案資料，共 {len(locs)} 個縣市。")
                        return locs
                elif 'records' in data and 'locations' in data['records']:
                    locs = data['records']['locations'].get('location', [])
                    if locs:
                        print(f"成功取得 CWA REST API 資料，共 {len(locs)} 個縣市。")
                        return locs
        except Exception as e:
            print(f"嘗試失敗 ({e})，準備切換備援端點...")

    raise RuntimeError("無法從任何 CWA 端點下載最新月出月沒資料！")

def process_and_save(locations, target_dir="public/data"):
    print("[2/3] 正在重整結構並壓縮為高效索引格式...")
    os.makedirs(target_dir, exist_ok=True)

    # 彙整所有日期
    all_dates = set()
    raw_map = {}

    for loc in locations:
        county = loc.get('CountyName')
        if not county:
            continue
        raw_map[county] = {}
        for t in loc.get('time', []):
            d = t.get('Date')
            if not d:
                continue
            all_dates.add(d)
            raw_map[county][d] = [
                t.get('MoonRiseTime', ''),
                float(t['MoonRiseAZ']) if t.get('MoonRiseAZ') else None,
                t.get('MoonTransitTime', ''),
                t.get('MoonTransitAlt', ''),
                t.get('MoonSetTime', ''),
                float(t['MoonSetAZ']) if t.get('MoonSetAZ') else None
            ]

    sorted_dates = sorted(list(all_dates))
    print(f"涵蓋總日數: {len(sorted_dates)} 天 ({sorted_dates[0]} 至 {sorted_dates[-1]})")

    compact = {
        'version': f"{sorted_dates[0][:4]}-{sorted_dates[-1][:4]}",
        'updatedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'startDate': sorted_dates[0],
        'endDate': sorted_dates[-1],
        'dates': sorted_dates,
        'counties': {}
    }

    for county, date_dict in raw_map.items():
        arr = []
        for d in sorted_dates:
            arr.append(date_dict.get(d, ['', None, '', '', '', None]))
        compact['counties'][county] = arr

    out_file = os.path.join(target_dir, "cwa_moon_compact.json")
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(compact, f, ensure_ascii=False, separators=(',', ':'))

    size_kb = os.path.getsize(out_file) / 1024
    print(f"[3/3] 更新完成！儲存至 {out_file} (檔案大小: {size_kb:.1f} KB)")
    return out_file

if __name__ == '__main__':
    try:
        locs = fetch_cwa_data()
        process_and_save(locs)
        print("CWA 月出月沒時刻資料集更新成功！")
    except Exception as e:
        print(f"錯誤: {e}", file=sys.stderr)
        sys.exit(1)
