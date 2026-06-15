# ggit — Googleドキュメント単体で動くGit/Jujutsu風バージョン管理ツール

単一の Google ドキュメント内で、**1枚の作業タブに対する Git/Jujutsu 風のバージョン管理**を行う
コンテナバインド型の Google Apps Script（GAS）ツールです。外部リポジトリや追加サービスに依存せず、
**対象ドキュメント単体で完結**します。

提供操作: 明示的な **commit**（チェックポイント）／ **log**（ブランチを意識した ASCII グラフ）／
**diff**（差分）／ **bookmark**（手動の名前付きポインタ）／ **goto**（現在地の移動）／
**merge**（3-way 合流）。すべてカスタムメニュー「ggit」から GUI 操作できます。

ブランチまわりは **Jujutsu（jj）流のモデル**を採用しています：現在地 `@` はコミットID（匿名ヘッド）で、
commit は `@` を前進させますが**ブックマークは手動操作のときだけ動きます**。スタッシュは「コミットだけど
スタッシュだと分かる」**仮コミット**として残り、戻す（pop）と消えます。設計の詳細は
[`docs/design.md`](docs/design.md)（特に付録C）を参照してください。

---

## 概念マッピング

| Git / jj | ggit |
| --- | --- |
| リポジトリ | 対象ドキュメント |
| 作業ツリー | 単一の作業タブ |
| 現在地（jj `@`） | `store.working`（現在地のコミットID＝匿名ヘッド） |
| ブランチ（jj bookmark） | `store.bookmarks`（名前 → コミットID）。commit で自動前進しない |
| コミット | タブ本文のスナップショット＋メタ情報 |
| スタッシュ | `objects` 内の `stash:true` 付き仮コミット |
| オブジェクトストア | メタタブ `.vcs`（JSON, version 3） |
| コミットID | 本文の SHA-256 短縮ハッシュ |

---

## ディレクトリ構成

```
ggit/
├── README.md
├── docs/design.md            # 設計仕様書
├── package.json              # clasp スクリプト
├── .clasp.json.example       # scriptId プレースホルダ（コピーして .clasp.json を作る）
├── .gitignore
└── src/                      # clasp rootDir（GAS ソース）
    ├── appsscript.json       # マニフェスト（Docs 拡張サービス, scopes, V8）
    ├── Menu.js               # onOpen / カスタムメニュー / UI ダイアログ
    ├── Commit.js             # commit / log チェーン（working 前進）
    ├── Bookmark.js           # bookmark（設定/移動/削除）/ goto（現在地の移動）
    ├── Graph.js              # コミットDAG収集 / ASCII レーングラフ（純粋関数）
    ├── Stash.js              # スタッシュ＝stash:true 付き仮コミット（pop/drop）
    ├── Diff.js               # diff（着色 HTML 表示）
    ├── Merge.js              # 3-way merge（行単位 diff3）/ 衝突マーカー
    ├── Store.js              # .vcs メタタブの read/write（version 3）
    ├── Snapshot.js           # payload（full/delta）生成・復元 / gzip+Base64
    ├── Hash.js               # SHA-256 短縮コミットID
    ├── Tabs.js               # 全タブ走査・本文 get/set / addDocumentTab
    ├── SelfTest.js           # エディタ実行用の自己テスト
    └── vendor/
        └── DiffMatchPatch.js # diff-match-patch（Apache-2.0, 後述）
```

---

## セットアップ

### 1. clasp の準備

```bash
npm install
npx clasp login
```

### 2. 対象ドキュメントのスクリプトに紐付け

1. 対象の Google ドキュメントを開き、`拡張機能 > Apps Script` でスクリプトエディタを開く。
2. プロジェクト設定からスクリプト ID を控える。
3. `.clasp.json.example` を `.clasp.json` にコピーし、`scriptId` を設定する（`rootDir` は `src`）。

```bash
cp .clasp.json.example .clasp.json
# .clasp.json の scriptId を編集
```

### 3. プッシュ

```bash
npm run push   # clasp push
```

### 4. 権限と拡張サービスの有効化

- Apps Script エディタで **Docs API 拡張サービス**（`addDocumentTab` を含む batchUpdate 用）を
  有効化します（`appsscript.json` に宣言済みですが、初回承認が必要です）。
- 必要 OAuth スコープ（`appsscript.json`）:
  - `https://www.googleapis.com/auth/documents` — Docs 拡張サービスでのタブ生成（branch）に必要。
    現ドキュメントの読み書きのみなら `documents.currentonly` でも足りますが、**branch を使うには
    `documents` が必要**です（設計仕様書 §10）。
  - `https://www.googleapis.com/auth/script.container.ui` — メニュー／ダイアログ表示用。

プッシュ後、対象ドキュメントを開き直すと、メニューバーに **「ggit」** が表示されます。

---

## 使い方（メニュー「ggit」）

| メニュー | 操作 |
| --- | --- |
| **Commit…** | アクティブタブ本文をスナップショット化。メッセージを入力してコミット（現在地 `@` を前進。ブックマークは動かない）。 |
| **Log（グラフ）** | コミット DAG をブランチ（分岐）を意識した ASCII レーングラフで表示。`@`＝現在地、`<name>`＝ブックマーク、`[stash]`＝スタッシュ。行クリックで goto。フラット表示にも切替可。スタッシュの戻す(pop)/破棄(drop)もここから。 |
| **Diff…** | 2 コミットを選んでテキスト差分を着色表示。 |
| **Bookmark…** | ブックマーク（手動の名前付きポインタ）を任意のコミット（既定＝現在地）に設定/移動/削除。 |
| **Goto…** | 現在地 `@` をブックマーク／コミットへ移動。作業タブ本文をその内容に置き換え、未コミット内容はスタッシュ（仮コミット）へ自動退避。 |
| **Merge…** | マージ元（ブックマーク or コミット）を現在地へ 3-way マージ。競合時はマーカーを本文へ書き戻し。 |

> **goto の仕組み**: プログラムからのタブのアクティブ化には API 制約があるため、ブランチ切替ではなく
> **単一の作業タブ本文をその場で置き換える**方式です（設計仕様書 §9 / 付録C）。

> **diff / merge の対象**: 信頼性確保のため **プレーンテキスト**を対象とします。見出し・表・書式など
> リッチテキストの差分・マージは段階的対応です（設計仕様書 §7.3）。

> **書式の記録・復元**: commit は本文の**書式（文字書式・段落書式）も含めて**スナップショット化します。
> そのため「テキストは同じで書式だけ変更した」場合も変更として検知・記録され、**goto では
> 書式ごと**復元されます。ただし **diff / merge は上記のとおりプレーンテキスト対象**のままです。
> 現状の書式対応の範囲は、文字書式（太字／斜体／下線／取消線／フォント／サイズ／前景色・背景色／リンク）と
> 段落書式（見出し／配置／インデント／行間／段落前後スペース）です。**表・画像・リストのグリフ／ネストは
> 非対応**（テキストとしては保持されますが書式は復元しません）。

> **`.vcs` タブ**: オブジェクトストアは `.vcs` というタブに JSON で保存されます。**手動編集しないでください。**

---

## 検証

### A. エディタ実行の自己テスト

Apps Script エディタで `src/SelfTest.js` の **`_test_all`** を実行し、実行ログに `PASS` が並ぶことを
確認します（hash・スナップショット往復・diff3・LCA・v3 移行・グラフ描画を検証）。

### B. 手動 E2E チェックリスト

1. `npm run push` 後、ドキュメントを開き直し、メニュー **ggit** が出る。
2. **Commit…** → `.vcs` タブが生成/更新され、JSON に version 3 ストア（`working` 設定）が入る。
3. 本文を編集 → 再度 **Commit…** → **Log（グラフ）** に 2 コミット、`@` が前進、**Diff…** で差分が着色表示。
4. **Bookmark…** で現在地に `main` を付与 → グラフに `<main>` chip。
5. あるコミットへ **Goto…** → 内容が差し替わり、未コミット分が `[stash]` ノードとして残る。別の編集を Commit → **Log（グラフ）** に分岐（`|/`）が表示。
6. スタッシュの **戻す(pop)** → 内容が戻り、その `[stash]` が消える。
7. **Merge…**（ブックマーク or コミット）→ クリーン統合（マージコミット）、または競合マーカー書き戻しを目視確認。

> 補足: `addDocumentTab`（`.vcs` タブ生成）等のタブ系 API は比較的新しい面のため、push 後に現行ドキュメントで
> 挙動確認してください（設計仕様書 §4.2）。

---

## サードパーティ

`src/vendor/DiffMatchPatch.js` は **diff-match-patch**（Copyright The diff-match-patch Authors,
Neil Fraser, **Apache License 2.0**）をそのまま収録したものです。
出典: <https://github.com/google/diff-match-patch> 。ライセンス条項はファイル冒頭のヘッダコメントを
参照してください。
