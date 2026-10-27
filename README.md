# 洛聖都行動 · Los Santos Lite

**繁體中文** | [English](README.en.md)

**Los Santos Lite** — 致敬 GTA V 的瀏覽器 3D 開放世界槍戰、三主角高空衛星切換與銀行劫案沙盒。

操控麥可、富蘭克林與崔佛三位傳奇主角，隨時啟動經典三段式衛星雲端視角切換；按住 `Tab` 呼出八格慢動作武器輪盤，體驗卡賓步槍、重型狙擊鏡、RPG 火箭筒與火神加特林的火爆交火；挑戰太平洋標準銀行大劫案，在五星特警與警用武裝直升機的陸空包圍下殺出重圍！全程繁體中文介面，免登入、免外部金鑰即可於瀏覽器直接遊玩。

[![License: MIT](https://img.shields.io/badge/License-MIT-facc15.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r175-000000.svg)](https://threejs.org/)
[![React](https://img.shields.io/badge/React-19-149ECA.svg)](https://react.dev/)

---

## 核心特色

- **三主角高空衛星切換（3-Protagonist Sky-Cam Switch）**：
  - **麥可 · 德聖塔（Michael）**：特殊能力 **「子彈時間（Bullet Time）」** — 減緩全場時間 65%、零後座力、爆頭傷害 2.5 倍。
  - **富蘭克林 · 克林頓（Franklin）**：特殊能力 **「極限駕馭（Driving Focus）」** — 駕車時減緩時間、雙倍轉向抓地力、支援車窗單手衝鋒槍掃射。
  - **崔佛 · 菲利普（Trevor）**：特殊能力 **「狂暴模式（Red Mist）」** — 輸出雙倍槍械與爆破傷害、僅受 15% 傷害、無限連發不耗彈匣。
- **八格放射狀慢動作武器輪盤（Weapon Wheel）**：
  - 內建 **徒手重拳、戰術手槍、微型衝鋒槍（支援車上射擊）、泵動式霰彈槍、特戰卡賓步槍、重型狙擊步槍（8 倍狙擊鏡）、RPG 火箭發射器、火神六管機槍**。
  - 具備 3D 曳光彈道、槍口火光、爆頭判定與紅叉擊殺回饋、連鎖引爆紅油桶與車輛物理爆炸。
- **五星陸空武裝通緝系統（1–5 Star Wanted System）**：
  - 隨通緝星等提升，LSPD 巡邏警車、NOOSE 防暴裝甲特警小隊與 **警用武裝直升機（Police Maverick，具高空探照燈與狙擊手，可被 RPG 擊落墜毀）** 將全面出動。
- **三大經典劫案合約與街頭商店**：
  - 內建 **【太平洋標準銀行大劫案】**、**【碼頭重軍火攔截戰】**、**【西門限量超跑劫持行動】**，並設有多處可互動的 **武裝國度軍火店（Ammu-Nation）** 與 **洛聖都改車王（LS Customs）**。
- **GTA V 招牌矩形雷達與 Web Audio 合成音效**：
  - 左下角即時顯示道路網格、GPS 任務黃線、視野錐與經典三色狀態條（綠：生命｜藍：護甲｜黃：特殊能力），搭配純 Web Audio API 即時合成的槍聲、爆炸低音與衛星切換音效。

---

## 操作說明

| 按鍵 | 步行槍戰 | 載具駕駛 |
| --- | --- | --- |
| `W` `A` `S` `D` | 八方向移動 | 加速／轉向／倒車 |
| 滑鼠左鍵 | 開火射擊／揮拳 | 車窗單手衝鋒槍掃射（Drive-By） |
| 滑鼠右鍵 | 越肩精準開鏡（ADS）／狙擊鏡 | 車上瞄準 |
| 按住 `Tab` | 開啟八格慢動作武器輪盤 | 切換車用武器 |
| `1` / `2` / `3` | 衛星高空切換：麥可／富蘭克林／崔佛 | 自動下車並切換主角 |
| `Q` 或 `CapsLock` | 啟動／關閉主角專屬特殊能力 | 啟動極限駕馭（富蘭克林） |
| `R` | 裝填彈匣 | 裝填彈匣 |
| `Shift` / `Space` | 衝刺跑步 / 跳躍 | — / 手煞車甩尾 |
| `C` 或 `Ctrl` | 戰術翻滾閃避 | — |
| `E` 或 `F` | 上下車、進入軍火店／改車王、觸發劫案 | 下車、進入改車王 |
| `Esc` | 暫停選單／關閉商店 | 暫停選單 |

---

## 三大劫案合約

| 劫案名稱 | 推薦主角 | 任務流程 | 分紅獎勵 |
| --- | --- | --- | --- |
| **太平洋標準銀行大劫案** | 麥可 | 突破銀行特勤保全 → 奪取金庫債券袋（觸發三星特警與直升機） → 駕車至改車王消星 | `$150,000` |
| **碼頭重軍火攔截戰** | 崔佛 | 清剿西岸貨櫃碼頭黑市傭兵 → 奪取實驗軍火箱（解鎖滿彈 RPG 與加特林） → 殲滅增援部隊 | `$95,000` |
| **西門限量超跑劫持行動** | 富蘭克林 | 潛入羅克福德豪宅區擊退保鑣 → 奪取黃金女妖超跑 → 甩開警車送達洛聖都改車王 | `$65,000` |

---

## 技術棧

| 層級 | 技術 |
| --- | --- |
| 前端框架 | React 19、TypeScript 5.8、Tailwind CSS v4、Vite 6 |
| 3D 引擎 | Three.js（自訂第三人稱越肩射擊鏡頭、Raycasting 彈道、衛星轉場與粒子爆炸） |
| 狀態管理 | Zustand（HUD、三主角獨立狀態、八格武器彈藥與任務進度） |
| 音效引擎 | Web Audio API 即時合成器（免外部音檔） |

---

## 快速開始

需要 **Node.js 20+** 與 npm。

```bash
git clone https://github.com/richie7p/los-santos-lite.git
cd los-santos-lite
npm install
npm run dev
```

瀏覽器開啟 [http://localhost:8080](http://localhost:8080) 即可遊玩。

```bash
npm run typecheck   # TypeScript 靜態型別檢查
npm run build       # 生產環境正式建置
npm run preview     # 預覽建置結果
```

## 授權

MIT License。詳見 [LICENSE](LICENSE)。
