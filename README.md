# ggit — Googleドキュメント単体で動くGit風バージョン管理ツール

単一の Google ドキュメント内で、**タブをブランチに見立てた Git 風のバージョン管理**を行う
コンテナバインド型の Google Apps Script（GAS）ツールです。外部リポジトリや追加サービスに依存せず、
**対象ドキュメント単体で完結**します。

提供操作: 明示的な **commit**（チェックポイント）／ **branch**（タブ）／ **diff**（差分）／
**merge**（3-way 合流）。すべてカスタムメニュー「ggit」から GUI 操作できます。

設計の詳細は [`docs/design.md`](docs/design.md) を参照してください。

---

## 概念マッピング

| Git | ggit |
| --- | --- |
| リポジトリ | 対象ドキュメント |
| ブランチ／作業ツリー | タブ |
| コミット | タブ本文のスナップショット＋メタ情報 |
| オブジェクトストア | メタタブ `.vcs`（JSON） |
| HEAD（ブランチ毎） | 各タブの最新コミットへのポインタ |
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
    ├── Commit.js             # commit / log
    ├── Branch.js             # branch / checkout
    ├── Diff.js               # diff（着色 HTML 表示）
    ├── Merge.js              # 3-way merge（行単位 diff3）/ 衝突マーカー
    ├── Store.js              # .vcs メタタブの read/write
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
| **Setup / 権限付与** | 初回利用時に一度実行し、OAuth 権限の承認を済ませる（後述）。 |
| **Commit…** | アクティブタブ本文をスナップショット化。メッセージを入力してコミット。 |
| **Log** | アクティブタブの祖先コミットチェーンを一覧表示。コミットを選ぶと内容／作業中との差分をプレビューでき、「この版に戻す」でアクティブタブ本文へ書き戻せる。 |
| **Diff…** | 2 コミットを選んでテキスト差分を着色表示。 |
| **Branch…** | 新タブを生成し、アクティブタブ内容を複製（新タブ HEAD＝分岐元コミット）。 |
| **Checkout…** | 対象タブの整合性を確認（切替自体は左のタブ一覧から手動で）。 |
| **Merge…** | マージ元ブランチをアクティブタブへ 3-way マージ。競合時はマーカーを本文へ書き戻し。 |

> **初回利用時（重要）**: 最初に **ggit → Setup / 権限付与** を一度実行し、権限承認ダイアログを承認して
> ください。GAS の仕様上、`onOpen` は限定権限で動くため、**承認直後の最初の操作はキャンセルされる**
> ことがあります。その場合は同じ操作（例: Commit…）をもう一度実行してください（2 回目以降は正常）。

> **Log からの復元**: 「この版に戻す」はアクティブタブの**作業本文を上書きするだけ**で、自動コミットは
> しません（未コミットの編集は失われます）。復元内容を履歴に残すには、その後あらためて **Commit…** して
> ください。

> **checkout の制約**: プログラムからのタブのアクティブ化には API 制約があるため、切替は UI 操作
> （タブクリック）が前提です。Checkout… は対象タブの HEAD と本文の整合性確認に留まります
> （設計仕様書 §9）。

> **diff / merge の対象**: 信頼性確保のため **プレーンテキスト**を対象とします。見出し・表・書式など
> リッチテキストの差分・マージは段階的対応です（設計仕様書 §7.3）。

> **書式の記録・復元**: commit は本文の**書式（文字書式・段落書式）も含めて**スナップショット化します。
> そのため「テキストは同じで書式だけ変更した」場合も変更として検知・記録され、**branch（複製）では
> 書式ごと**復元されます。ただし **diff / merge は上記のとおりプレーンテキスト対象**のままです。
> 現状の書式対応の範囲は、文字書式（太字／斜体／下線／取消線／フォント／サイズ／前景色・背景色／リンク）と
> 段落書式（見出し／配置／インデント／行間／段落前後スペース）です。**表・画像・リストのグリフ／ネストは
> 非対応**（テキストとしては保持されますが書式は復元しません）。

> **`.vcs` タブ**: オブジェクトストアは `.vcs` というタブに JSON で保存されます。**手動編集しないでください。**

---

## 検証

### A. エディタ実行の自己テスト

Apps Script エディタで `src/SelfTest.js` の **`_test_all`** を実行し、実行ログに `PASS` が並ぶことを
確認します（hash・スナップショット往復・diff3・LCA を検証）。

### B. 手動 E2E チェックリスト

1. `npm run push` 後、ドキュメントを開き直し、メニュー **ggit** が出る。
2. **Setup / 権限付与** → 権限承認ダイアログを承認し、初期化完了の表示を確認。
3. **Commit…** → `.vcs` タブが生成/更新され、JSON にコミットが入る（初回承認直後は 1 度キャンセル
   されることがあるため、その場合は再実行）。
4. 本文を編集 → 再度 **Commit…** → **Log** に 2 コミット、**Diff…** で差分が着色表示。
5. **Branch…** → 新タブが複製生成され、**新タブに分岐元の本文が入っている**こと、HEAD が分岐元を指すことを確認。
6. **Log** → 旧コミットを選択 → 内容／作業中との差分プレビューを切替表示 → 「この版に戻す」で
   アクティブタブ本文が書き戻され、**自動コミットされない**こと（その後 Commit で記録できる）を確認。
7. 2 タブで別々に編集・コミット後、**Merge…** → クリーン統合、または競合マーカー書き戻しを目視確認。

> 補足: `addDocumentTab` 等のタブ系 API は比較的新しい面のため、push 後に現行ドキュメントで
> 挙動確認してください（設計仕様書 §4.2）。

---

## サードパーティ

`src/vendor/DiffMatchPatch.js` は **diff-match-patch**（Copyright The diff-match-patch Authors,
Neil Fraser, **Apache License 2.0**）をそのまま収録したものです。
出典: <https://github.com/google/diff-match-patch> 。ライセンス条項はファイル冒頭のヘッダコメントを
参照してください。
