/**
 * Branch.js — branch / checkout。
 *
 * 設計仕様書 §6:
 *  - branch: addDocumentTab で新タブを生成し分岐元内容を複製。新タブHEAD＝分岐元コミット。
 *  - checkout: プログラムからのアクティブタブ切替はAPI制約があるため、整合性確認に留め、
 *    UI上のタブ選択を促す（§9 既知制約）。
 */

/**
 * アクティブタブを分岐元として新ブランチ（タブ）を作成する。新タブIDを返す。
 */
function Ggit_branch(name) {
  var doc = DocumentApp.getActiveDocument();
  var srcTab = doc.getActiveTab();
  var srcId = srcTab.getId();

  var meta = Ggit_metaTab(doc);
  if (meta && srcId === meta.getId()) {
    throw new Error('.vcs メタタブからは分岐できません。');
  }

  var store = Ggit_storeLoad(doc);
  var br = store.branches[srcId];
  if (!br) {
    throw new Error('分岐元タブに履歴がありません。先にコミットしてからブランチを作成してください。');
  }

  var srcSnap = Ggit_serializeTab(srcTab);
  var newTab = Ggit_createTab(doc, name);
  var newTabId = newTab.getId();
  // テキストだけでなく書式ごと複製する。新タブは openById 由来の別インスタンスに属するが、
  // Ggit_storeSave が .vcs を Docs API（Ggit_setTabTextApi）で書くようになったため、
  // アクティブ doc への DocumentApp 書き込みは無く、ここが唯一の DocumentApp 書き込みとなる。
  // よって同一ドキュメント2インスタンスのフラッシュ競合（本文消失）は起きない。
  Ggit_restoreTab(newTab, srcSnap);

  store.branches[newTabId] = { head: br.head, name: name };
  Ggit_storeSave(doc, store);
  return newTabId;
}

/**
 * checkout: 切替自体はUI操作（タブクリック）が前提。本関数は対象タブの存在と、
 * HEAD と本文の整合性を確認したレポートを返す。
 */
function Ggit_checkout(targetTabId) {
  var doc = DocumentApp.getActiveDocument();
  var tab = Ggit_tabById(doc, targetTabId);
  if (!tab) throw new Error('指定タブが見つかりません。');

  var store = Ggit_storeLoad(doc);
  var br = store.branches[targetTabId];
  var report = {
    tabId: targetTabId,
    title: tab.getTitle(),
    head: br ? br.head : null,
    tracked: !!br,
    clean: null
  };
  if (br) {
    // 書式差も「未コミットの変更」に反映するため、スナップショット同士で比較する。
    report.clean = (Ggit_materialize(store, br.head) === Ggit_serializeTab(tab));
  }
  return report;
}
