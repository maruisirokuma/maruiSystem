# 🥪 サンドイッチ販売支援システム

アルバイト先のサンドイッチ販売業務を効率化するスマホ向けWebシステムです。

## 機能一覧

| 画面 | 機能 |
|------|------|
| ダッシュボード | 完売確率・推奨割引・売れ筋ランキング・ロスランキング表示 |
| 製造計算 | 商品ごとの製造個数入力・小計・総額計算 |
| ロス計算 | 20%/30%/50%割引個数・ロス個数の記録と集計 |
| 割引分析 | 10分ごとの在庫入力・在庫推移グラフ・完売予測・割引推奨 |
| 日報 | 売上・客数・客単価の記録とLINE向けフォーマット生成 |
| 商品管理 | 商品の追加・編集・販売終了・並び替え |
| 設定 | JSONバックアップ出力・CSV出力・JSONインポート・全データ削除 |

## 技術仕様

- **フロントエンド**: Vanilla HTML / CSS / JavaScript（ES Modules）
- **データ保存**: IndexedDB（オフライン・永続保存）
- **グラフ**: Chart.js v4
- **PWA対応**: Service Worker によるオフライン利用可能
- **デプロイ**: GitHub Pages（GitHub Actions で自動デプロイ）

## セットアップ

### GitHub Pages へのデプロイ手順

1. このリポジトリを fork またはクローンする
2. GitHub リポジトリの Settings → Pages を開く
3. Source を「GitHub Actions」に設定する
4. `main` ブランチへ push すると自動デプロイされる

### ローカル確認

ES Modules を使用しているため、ローカルでは HTTP サーバーが必要です。

```bash
# Python がある場合
cd src
python3 -m http.server 8080

# Node.js がある場合
npx serve src
```

ブラウザで `http://localhost:8080` を開く。

## ディレクトリ構成

```
.
├── .github/
│   └── workflows/
│       └── deploy.yml     # GitHub Actions 自動デプロイ
├── src/
│   ├── index.html         # エントリーポイント
│   ├── manifest.json      # PWAマニフェスト
│   ├── sw.js              # Service Worker
│   ├── css/
│   │   └── style.css      # スタイルシート
│   └── js/
│       ├── app.js         # ルーティング・共通処理
│       ├── db.js          # IndexedDB操作
│       ├── predict.js     # 完売予測・割引推奨ロジック
│       ├── dashboard.js   # ダッシュボード
│       ├── manufacture.js # 製造計算
│       ├── loss.js        # ロス計算
│       ├── report.js      # 日報
│       ├── discount.js    # 割引分析
│       ├── products.js    # 商品管理
│       └── settings.js    # 設定
└── README.md
```

## 実装フェーズ

- **Phase 1** ✅ 商品マスタ・製造計算・ロス計算・日報
- **Phase 2** ✅ 割引分析・グラフ（Chart.js）
- **Phase 3** ✅ 完売確率予測・追加製造最適化
- **Phase 4** 🔜 AIによる需要予測・売上補正自動学習

## データ仕様

### IndexedDB テーブル

| テーブル名 | 説明 |
|-----------|------|
| ProductMaster | 商品マスタ（名前・価格・原価・カテゴリ） |
| ManufactureRecord | 日次製造記録 |
| LossRecord | 日次ロス・割引記録 |
| DailyReport | 日報 |
| DiscountAnalysisRecord | 割引分析・在庫ログ |

### バックアップ・引き継ぎ

- 設定画面から **JSON バックアップ** を出力して保管
- 端末変更時は JSON インポートで復元
- **CSV 出力** で Excel・スプレッドシートへのエクスポートも可能

## 注意事項

- データは **ブラウザの IndexedDB に保存** されます
- ブラウザのデータ削除（「サイトデータを削除」など）を行うとデータが消えます
- 定期的に JSON バックアップを取ることを推奨します
- ホーム画面に追加（PWA）すると、アプリのように使用できます
