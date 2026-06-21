/**
 * Tabs.js — タブ走査・本文 get/set ヘルパー。
 *
 * Google ドキュメントのタブは木構造（親タブ／子タブ）を成す。本モジュールは
 * 全タブを再帰的に平坦化して扱うためのユーティリティを提供する。
 *
 * 参照: 設計仕様書 §4.2「タブ操作のAPI前提」。
 */

/** 全タブ（子タブ含む）を平坦な配列で返す。 */
function Ggit_allTabs(doc) {
  doc = doc || DocumentApp.getActiveDocument();
  var out = [];
  function rec(tabs) {
    for (var i = 0; i < tabs.length; i++) {
      out.push(tabs[i]);
      rec(tabs[i].getChildTabs());
    }
  }
  rec(doc.getTabs());
  return out;
}

/** タブIDから Tab を引く。見つからなければ null。 */
function Ggit_tabById(doc, id) {
  var all = Ggit_allTabs(doc);
  for (var i = 0; i < all.length; i++) {
    if (all[i].getId() === id) return all[i];
  }
  return null;
}

/** タブ本文のプレーンテキストを取得。 */
function Ggit_tabText(tab) {
  return tab.asDocumentTab().getBody().getText();
}

/** タブ本文をプレーンテキストで上書き。 */
function Ggit_setTabText(tab, text) {
  tab.asDocumentTab().getBody().setText(text);
}

/**
 * Docs API 経由でタブ本文をプレーンテキストで上書きする。
 *
 * `Ggit_setTabText`（DocumentApp）は、`Ggit_createTab` が `openById` で開いた
 * 「2つ目のライブインスタンス」のタブに書くと、実行終了時のフラッシュ競合で
 * 書き込みが失われることがある（新規タブ本文や `.vcs` 生成時に顕在化）。
 * 本関数は DocumentApp を介さず Docs API で書くため、その競合を回避する。
 *
 * 既存本文を deleteContentRange で削除してから insertText する。本文末尾の改行は
 * 削除できないため範囲は `endIndex - 1` まで。すべての Location/Range には対象タブを
 * 指す `tabId` を付与する。
 */
function Ggit_setTabTextApi(docId, tabId, text) {
  var docRes = Docs.Documents.get(docId, {
    includeTabsContent: true,
    fields: 'tabs(tabId,childTabs,documentTab(body(content(endIndex))))'
  });
  var endIndex = Ggit_tabBodyEndIndex_(docRes, tabId);

  var requests = [];
  // 既存本文（index 1 .. endIndex-1）を削除。末尾改行のみ（endIndex<=2）なら何もしない。
  if (endIndex > 2) {
    requests.push({
      deleteContentRange: {
        range: { startIndex: 1, endIndex: endIndex - 1, tabId: tabId }
      }
    });
  }
  // 新本文を本文先頭（index 1）へ挿入。
  if (text && text.length) {
    requests.push({
      insertText: { location: { index: 1, tabId: tabId }, text: text }
    });
  }
  if (requests.length) {
    Docs.Documents.batchUpdate({ requests: requests }, docId);
  }
}

/**
 * Docs.Documents.get レスポンスから、指定タブの本文末尾 index を求める。
 * タブ木（childTabs）を再帰的に辿って tabId 一致タブを探し、その
 * documentTab.body.content 末尾要素の endIndex を返す。空本文時は 1 を返す。
 */
function Ggit_tabBodyEndIndex_(docRes, tabId) {
  var found = null;
  (function rec(tabs) {
    if (!tabs) return;
    for (var i = 0; i < tabs.length; i++) {
      if (found) return;
      if (tabs[i].tabId === tabId) { found = tabs[i]; return; }
      rec(tabs[i].childTabs);
    }
  })(docRes.tabs);

  if (!found || !found.documentTab || !found.documentTab.body ||
      !found.documentTab.body.content) {
    throw new Error('Docs API レスポンスから対象タブの本文を特定できませんでした: ' + tabId);
  }
  var content = found.documentTab.body.content;
  var last = content[content.length - 1];
  return (last && last.endIndex) ? last.endIndex : 1;
}

/** Docs API のドキュメントから全タブID（子タブ含む）を平坦に集める。 */
function Ggit_docsTabIds(docId) {
  var docRes = Docs.Documents.get(docId, { includeTabsContent: false });
  var ids = [];
  function rec(tabs) {
    if (!tabs) return;
    for (var i = 0; i < tabs.length; i++) {
      var tp = tabs[i].tabProperties;
      if (tp && tp.tabId) ids.push(tp.tabId);
      rec(tabs[i].childTabs);
    }
  }
  rec(docRes.tabs);
  return ids;
}

/**
 * Docs 拡張サービス経由で新規ドキュメントタブを生成し、生成された Tab を返す。
 *
 * `DocumentApp` 本体にタブ追加メソッドは無いため、Docs API の batchUpdate
 * （addDocumentTab）を用いる（設計仕様書 §4.2）。
 *
 * 新タブの特定は二段構えで行う:
 *  1) batchUpdate と同じバックエンド（強整合）の Docs API で生成前後のタブID差分を取り、
 *     新タブIDを確定する（レスポンス形状に依存しない）。
 *  2) Docs API の書き込みが DocumentApp 側へ反映されるまで遅延し得るため、
 *     反映を待ちながら（リトライ）新タブの DocumentApp.Tab を取得して返す。
 */
function Ggit_createTab(doc, title) {
  var docId = doc.getId();
  var beforeIds = Ggit_docsTabIds(docId);

  try {
    Docs.Documents.batchUpdate(
      { requests: [{ addDocumentTab: { tabProperties: { title: title } } }] },
      docId
    );
  } catch (e) {
    throw new Error(
      'タブ生成に失敗しました（addDocumentTab）。Docs 拡張サービスの有効化と、' +
      '対象ドキュメントのタブAPI対応状況を確認してください。詳細: ' + e.message
    );
  }

  // 1) Docs API（強整合）で新タブIDを確定する。
  var newId = null;
  var afterIds = Ggit_docsTabIds(docId);
  for (var i = 0; i < afterIds.length; i++) {
    if (beforeIds.indexOf(afterIds[i]) === -1) { newId = afterIds[i]; break; }
  }

  // 2) DocumentApp 側へ反映されるまで待って Tab を取得する。
  //    （openById は実行内キャッシュ／反映遅延の影響を受けるため、開き直しつつ待機する）
  for (var attempt = 0; attempt < 6; attempt++) {
    var fresh = DocumentApp.openById(docId);
    var after = Ggit_allTabs(fresh);
    if (newId) {
      for (var k = 0; k < after.length; k++) {
        if (after[k].getId() === newId) return after[k];
      }
    } else {
      // newId 不明時のフォールバック: 同名タブ（末尾優先）。
      for (var j = after.length - 1; j >= 0; j--) {
        if (after[j].getTitle() === title) return after[j];
      }
    }
    Utilities.sleep(400 * (attempt + 1)); // 0.4s,0.8s,...,2.4s（合計 ~8.4s 上限）
  }

  throw new Error(
    'タブは生成されましたが、DocumentApp 側への反映を確認できませんでした。' +
    '少し待ってからページを再読み込みし、再度お試しください。' +
    (newId ? '（新タブID: ' + newId + '）' : '')
  );
}
