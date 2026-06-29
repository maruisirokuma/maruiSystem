# maruiSystem
# サンドイッチ販売支援システム 要件定義書兼実装プロンプト

# プロジェクト概要

アルバイト先のサンドイッチ販売業務を効率化するためのスマホ向けWebシステムを開発する。

目的は以下。

## 主目的

* 新人でも適切な割引判断ができること
* 利益を最大化すること

## 副目的

* 追加製造の最適化
* 過去データの蓄積と分析
* 日報作成の効率化
* データの引き継ぎを容易にすること

---

# 使用環境

* 利用者：全従業員
* 利用端末：店舗のスマホ1台のみ
* ログイン機能：不要
* 画面：縦向きスマホ最適化
* ダークモード：不要
* オフライン利用：可能にする
* GitHub Pagesへデプロイ
* PWA対応（ホーム画面追加可能）

---

# 技術スタック

## フロントエンド

* HTML
* CSS
* JavaScript

## データ保存

* IndexedDB

理由：

* 数年単位の保存が可能
* LocalStorageより安全
* オフライン対応可能

## グラフ

Chart.jsを使用。

## 将来拡張

* Pythonによる需要予測モデル
* 機械学習導入を想定

---

# ディレクトリ構成

src/
├── index.html
├── css/
│ └── style.css
├── js/
│ ├── app.js
│ ├── db.js
│ ├── dashboard.js
│ ├── manufacture.js
│ ├── loss.js
│ ├── report.js
│ ├── discount.js
│ └── settings.js
├── pages/
│ ├── dashboard.html
│ ├── manufacture.html
│ ├── loss.html
│ ├── report.html
│ ├── discount.html
│ ├── products.html
│ └── settings.html
└── assets/

---

# DB設計

## ProductMaster

商品マスタ。

| カラム       | 型       |
| --------- | ------- |
| id        | number  |
| sortOrder | number  |
| name      | string  |
| category  | string  |
| price     | number  |
| cost      | number  |
| isActive  | boolean |

販売終了時は削除せず isActive=false。

---

## ManufactureRecord

製造記録。

| カラム        | 型      |
| ---------- | ------ |
| date       | string |
| items      | array  |
| totalCount | number |
| totalPrice | number |
| updatedAt  | string |

items

{
productId,
count,
subtotal
}

---

## LossRecord

| カラム            | 型      |
| -------------- | ------ |
| date           | string |
| items          | array  |
| total20        | number |
| total30        | number |
| total50        | number |
| totalDiscount  | number |
| totalLossCount | number |
| totalLossPrice | number |

items

{
productId,
discount20,
discount30,
discount50,
discountPrice,
lossCount,
lossPrice
}

---

## DailyReport

| カラム       | 型      |
| --------- | ------ |
| date      | string |
| sales     | number |
| customers | number |
| unitPrice | number |
| body      | string |
| name      | string |

---

## DiscountAnalysisRecord

1日単位。

| カラム             | 型      |
| --------------- | ------ |
| date            | string |
| weekday         | string |
| hourlySales     | object |
| hourlyCustomers | object |
| inventoryLogs   | array  |
| discountLogs    | array  |
| manufactureLogs | array  |

inventoryLogs

{
time,
stock
}

discountLogs

{
time,
rate
}

manufactureLogs

{
time,
recommendCount,
actualCount
}

---

# 画面設計

## 1. ダッシュボード

表示

* 完売確率
* 今日の推奨割引
* 売れ筋ランキング
* ロスランキング

カード形式。

---

## 2. 製造計算画面

テーブル

|品名|税込価格|製造個数|小計|

下部

* 総製造数
* 総額

ボタン

* 保存
* クリア
* 元に戻す

数字入力UI

[-] [5] [+]

---

## 3. ロス計算画面

テーブル

|品名|20%|30%|50%|割引金額|ロス|ロス金額|

下部

* 総20%
* 総30%
* 総50%
* 総割引金額
* 総ロス個数
* 総ロス金額

---

## 4. 日報画面

入力

* 売上
* 客数
* 本文
* 名前

自動

* 日付
* 曜日
* 客単価

ボタン

* コピー
* 保存

クリップボードへ以下の形式を生成。

お疲れ様です。
丸井店舗売上報告をいたします。
○月○日 ○曜日
総売上 ○円
客数 ○人
客単価 ○円
♥
総括
（本文）
（名前）

---

## 5. 商品管理画面

機能

* 商品追加
* 編集
* 販売終了
* 並び替え

---

## 6. 割引分析画面（最重要）

入力

17:00～20:00の10分ごとの総在庫。

入力形式

17:00 [ ]
17:10 [ ]
17:20 [ ]
…

割引ボタン

20%開始
30%開始
50%開始

時刻手入力も可能。

追加製造入力

時間
おすすめ製造数
実際製造数

---

# 割引分析グラフ

表示する線

1. 現在在庫
2. 理想在庫
3. 曜日平均在庫
4. 昨日在庫
5. 完売予測線

Chart.jsで描画。

---

# 理想在庫

Version1

理想在庫
＝曜日別平均

Version2（将来）

理想在庫
＝曜日別平均 × 売上補正係数

売上補正係数

今日の売上
÷
曜日平均売上

自動計算。

---

# 完売予測

表示例

完売確率 87%

予測完売時刻
20:12

---

# 割引推奨表示

必要時のみ表示。

例

20%割引を推奨

理由
・現在在庫が理想在庫を8個上回っています
・完売予測が20:15です
・19:45時点予測在庫が5個です

---

# 追加製造支援

17:00時点で表示。

例

推奨追加製造数
＋15個

完売確率
92%

---

# 保存仕様

* 保存ボタンでIndexedDBへ保存
* 同日データは上書き保存
* 保存前にクリアを押した場合も自動保存
* 保存成功時は

「✅ 保存しました」

を3秒表示。

---

# 設定画面

機能

* JSONバックアップ出力
* CSV出力
* JSONインポート
* 全データ削除

---

# UI要件

* スマホ縦向き専用
* ボタン大きめ
* 文字大きめ
* パート従業員でも使いやすい操作性
* 入力項目を最小限にする
* タップ数をできるだけ減らす
* Material Design風UI
* レスポンシブ対応
* PWA対応

---

# 実装優先順位

Phase1

* 商品マスタ
* 製造計算
* ロス計算
* 日報

Phase2

* 割引分析
* グラフ

Phase3

* 完売確率予測
* 追加製造最適化

Phase4

* AIによる需要予測
* 売上補正自動学習

---

コードは保守性を重視し、ES Modulesを利用して実装すること。
各機能はモジュール分割し、コメントを丁寧に記述すること。
