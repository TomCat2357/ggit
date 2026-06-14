/**
 * Menu.js — onOpen カスタムメニューと UI ハンドラ。
 *
 * 設計仕様書 §6: commit / log / diff / branch / checkout / merge をメニューから操作する。
 * 選択が必要な操作（diff / merge / checkout）は HtmlService の小ダイアログを用い、
 * google.script.run でサーバ関数を呼び出す。
 */

/** ドキュメントを開いたときにカスタムメニューを生成する（単純トリガ）。 */
function onOpen() {
  DocumentApp.getUi()
    .createMenu('ggit')
    .addItem('Commit…', 'ggitUI_commit')
    .addItem('Log', 'ggitUI_log')
    .addItem('Diff…', 'ggitUI_diff')
    .addSeparator()
    .addItem('Branch…', 'ggitUI_branch')
    .addItem('Checkout…', 'ggitUI_checkout')
    .addSeparator()
    .addItem('Merge…', 'ggitUI_merge')
    .addSeparator()
    .addItem('About', 'ggitUI_about')
    .addToUi();
}

/* ===================== 共通ユーティリティ ===================== */

function Ggit_esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function Ggit_showModal(htmlStr, title, w, h) {
  var out = HtmlService.createHtmlOutput(htmlStr).setWidth(w).setHeight(h);
  DocumentApp.getUi().showModalDialog(out, title);
}

/* ===================== UI から呼ばれるサーバ補助 ===================== */

/** アクティブタブのコミット列（新しい順）。 */
function Ggit_uiListCommits() {
  var doc = DocumentApp.getActiveDocument();
  var tabId = doc.getActiveTab().getId();
  var store = Ggit_storeLoad(doc);
  return Ggit_logChain(store, tabId).map(function (o) {
    return { id: o.id, message: o.message, timestamp: o.timestamp, author: o.author };
  });
}

/** `.vcs` を除く全タブ。excludeActiveTabId を渡すとそのタブも除外。 */
function Ggit_uiListBranches(excludeActiveTabId) {
  var doc = DocumentApp.getActiveDocument();
  var meta = Ggit_metaTab(doc);
  var metaId = meta ? meta.getId() : null;
  var store = Ggit_storeLoad(doc);
  var out = [];
  Ggit_allTabs(doc).forEach(function (t) {
    var id = t.getId();
    if (id === metaId) return;
    if (excludeActiveTabId && id === excludeActiveTabId) return;
    var br = store.branches[id];
    out.push({ tabId: id, title: t.getTitle(), head: br ? br.head : null, tracked: !!br });
  });
  return out;
}

/* ===================== メニューハンドラ ===================== */

function ggitUI_commit() {
  var ui = DocumentApp.getUi();
  var res = ui.prompt('ggit commit', 'コミットメッセージを入力してください:', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var msg = (res.getResponseText() || '').trim();
  if (!msg) { ui.alert('ggit commit', 'メッセージが空です。中止しました。', ui.ButtonSet.OK); return; }
  try {
    var id = Ggit_commit(msg);
    ui.alert('ggit commit', 'コミットしました: ' + id, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('ggit commit', e.message, ui.ButtonSet.OK);
  }
}

function ggitUI_log() {
  var commits = Ggit_uiListCommits();
  var rows;
  if (!commits.length) {
    rows = '<tr><td colspan="3" style="color:#888">コミットがありません。</td></tr>';
  } else {
    rows = commits.map(function (c) {
      return '<tr>' +
        '<td style="font-family:monospace;color:#1a73e8;white-space:nowrap">' + Ggit_esc(c.id) + '</td>' +
        '<td>' + Ggit_esc(c.message) + '</td>' +
        '<td style="color:#888;white-space:nowrap">' + Ggit_esc(c.timestamp) + '</td>' +
        '</tr>';
    }).join('');
  }
  var html =
    '<div style="font:13px/1.5 Roboto,Arial,sans-serif;padding:4px">' +
    '<table style="border-collapse:collapse;width:100%">' +
    '<thead><tr style="text-align:left;border-bottom:1px solid #ddd">' +
    '<th>id</th><th>message</th><th>timestamp</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';
  Ggit_showModal(html, 'ggit log', 640, 480);
}

function ggitUI_diff() {
  var ui = DocumentApp.getUi();
  var commits = Ggit_uiListCommits();
  if (commits.length < 2) {
    ui.alert('ggit diff', '差分表示には2つ以上のコミットが必要です。', ui.ButtonSet.OK);
    return;
  }
  // A は既定で最古、B は既定で最新。
  var last = commits.length - 1;
  var optsA = commits.map(function (c, i) {
    return '<option value="' + Ggit_esc(c.id) + '"' + (i === last ? ' selected' : '') + '>' +
      Ggit_esc(c.id + ' — ' + c.message) + '</option>';
  }).join('');
  var optsB = commits.map(function (c, i) {
    return '<option value="' + Ggit_esc(c.id) + '"' + (i === 0 ? ' selected' : '') + '>' +
      Ggit_esc(c.id + ' — ' + c.message) + '</option>';
  }).join('');

  var html =
    '<div style="font:13px/1.5 Roboto,Arial,sans-serif;padding:4px">' +
    '<div style="margin-bottom:8px">' +
    'A: <select id="a">' + optsA + '</select> ' +
    'B: <select id="b">' + optsB + '</select> ' +
    '<button onclick="run()">差分表示</button></div>' +
    '<div id="out" style="border:1px solid #ddd;padding:8px;min-height:300px;' +
    'white-space:pre-wrap;font-family:monospace;overflow:auto">…</div>' +
    '<script>' +
    'function run(){' +
    'var a=document.getElementById("a").value,b=document.getElementById("b").value;' +
    'document.getElementById("out").innerHTML="計算中…";' +
    'google.script.run.withSuccessHandler(function(h){document.getElementById("out").innerHTML=h;})' +
    '.withFailureHandler(function(e){document.getElementById("out").innerText=e.message;})' +
    '.Ggit_diffCommitsHtml(a,b);}' +
    'run();' +
    '</script></div>';
  Ggit_showModal(html, 'ggit diff', 720, 540);
}

function ggitUI_branch() {
  var ui = DocumentApp.getUi();
  var res = ui.prompt('ggit branch', '新しいブランチ（タブ）名を入力してください:', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var name = (res.getResponseText() || '').trim();
  if (!name) { ui.alert('ggit branch', '名前が空です。中止しました。', ui.ButtonSet.OK); return; }
  try {
    var id = Ggit_branch(name);
    ui.alert('ggit branch',
      'ブランチ「' + name + '」を作成しました（タブID: ' + id + '）。\n' +
      '左側のタブ一覧から新しいタブをクリックして切り替えてください。', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('ggit branch', e.message, ui.ButtonSet.OK);
  }
}

function ggitUI_checkout() {
  var ui = DocumentApp.getUi();
  var doc = DocumentApp.getActiveDocument();
  var branches = Ggit_uiListBranches(doc.getActiveTab().getId());
  if (!branches.length) {
    ui.alert('ggit checkout', '切り替え先の他タブがありません。', ui.ButtonSet.OK);
    return;
  }
  var opts = branches.map(function (b) {
    return '<option value="' + Ggit_esc(b.tabId) + '">' +
      Ggit_esc(b.title + (b.head ? ' @ ' + b.head : ' (履歴なし)')) + '</option>';
  }).join('');
  var html =
    '<div style="font:13px/1.5 Roboto,Arial,sans-serif;padding:4px">' +
    '<p>checkout はプログラムからのタブ切替ができないため（設計仕様書 §9）、' +
    '対象タブの整合性確認のみ行います。確認後、左のタブ一覧から手動で切り替えてください。</p>' +
    '<select id="t">' + opts + '</select> ' +
    '<button onclick="run()">整合性を確認</button>' +
    '<div id="out" style="margin-top:8px"></div>' +
    '<script>' +
    'function run(){var t=document.getElementById("t").value;' +
    'google.script.run.withSuccessHandler(function(r){' +
    'var s=r.tracked?(r.clean?"整合（HEADと本文が一致）":"未コミットの変更あり（本文がHEADと不一致）"):"履歴なし";' +
    'document.getElementById("out").innerText="タブ: "+r.title+"\\nHEAD: "+(r.head||"-")+"\\n状態: "+s;})' +
    '.withFailureHandler(function(e){document.getElementById("out").innerText=e.message;})' +
    '.Ggit_checkout(t);}' +
    '</script></div>';
  Ggit_showModal(html, 'ggit checkout', 520, 280);
}

function ggitUI_merge() {
  var ui = DocumentApp.getUi();
  var doc = DocumentApp.getActiveDocument();
  var activeId = doc.getActiveTab().getId();
  var branches = Ggit_uiListBranches(activeId).filter(function (b) { return b.tracked; });
  if (!branches.length) {
    ui.alert('ggit merge', 'マージ可能な他ブランチ（履歴のあるタブ）がありません。', ui.ButtonSet.OK);
    return;
  }
  var opts = branches.map(function (b) {
    return '<option value="' + Ggit_esc(b.tabId) + '">' + Ggit_esc(b.title) + '</option>';
  }).join('');
  var html =
    '<div style="font:13px/1.5 Roboto,Arial,sans-serif;padding:4px">' +
    '<p>マージ元ブランチを、現在のアクティブタブへ 3-way マージします。</p>' +
    'マージ元: <select id="s">' + opts + '</select> ' +
    '<button id="go" onclick="run()">マージ実行</button>' +
    '<div id="out" style="margin-top:8px"></div>' +
    '<script>' +
    'function run(){document.getElementById("go").disabled=true;' +
    'document.getElementById("out").innerText="マージ中…";' +
    'var s=document.getElementById("s").value;' +
    'google.script.run.withSuccessHandler(function(r){' +
    'var m;if(r.upToDate){m="既に取り込み済みです（変更なし）。";}' +
    'else if(r.conflict){m="競合が発生しました。本文に <<<<<<< / ======= / >>>>>>> マーカーを書き戻しました。手動で解決後、commit してください。";}' +
    'else{m="クリーンにマージしました。マージコミット: "+r.commitId;}' +
    'document.getElementById("out").innerText=m;document.getElementById("go").disabled=false;})' +
    '.withFailureHandler(function(e){document.getElementById("out").innerText=e.message;document.getElementById("go").disabled=false;})' +
    '.Ggit_merge(s);}' +
    '</script></div>';
  Ggit_showModal(html, 'ggit merge', 560, 260);
}

function ggitUI_about() {
  var html =
    '<div style="font:13px/1.6 Roboto,Arial,sans-serif;padding:8px">' +
    '<b>ggit</b> — Googleドキュメント単体で動くGit風バージョン管理ツール<br>' +
    'タブをブランチに見立て、commit / log / diff / branch / checkout / merge を提供します。<br><br>' +
    'オブジェクトストアは <code>.vcs</code> メタタブに JSON で保存されます。' +
    '<code>.vcs</code> タブは手動編集しないでください。<br>' +
    'commit は本文の書式（文字・段落書式）も記録し、branch では書式ごと復元します。' +
    '差分・マージはプレーンテキストを対象とします（設計仕様書 §7.3 / §7.4）。' +
    '</div>';
  Ggit_showModal(html, 'About ggit', 480, 220);
}
