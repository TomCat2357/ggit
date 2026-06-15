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
    .addItem('Setup / 権限付与', 'ggitUI_setup')
    .addSeparator()
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

function ggitUI_setup() {
  var ui = DocumentApp.getUi();
  try {
    var info = Ggit_authorize();
    ui.alert('ggit setup',
      '初期化が完了しました。\n' +
      'ドキュメント: ' + info.title + '\n' +
      'タブ数: ' + info.tabCount + '\n\n' +
      'これで Commit などの操作が利用できます。\n' +
      '※ 権限承認の直後はGASの仕様により最初の操作がキャンセルされることがあります。' +
      'その場合は同じ操作をもう一度実行してください。', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('ggit setup', '初期化中にエラー: ' + e.message, ui.ButtonSet.OK);
  }
}

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

/** 指定コミットの本文全文を返す（プレビュー用）。 */
function Ggit_previewCommit(id) {
  return Ggit_materialize(Ggit_storeLoad(), id);
}

/** 指定コミット本文と現在の作業本文（アクティブタブ）の差分HTML（A=コミット, B=作業中）。 */
function Ggit_diffCommitVsWorkingHtml(id) {
  var doc = DocumentApp.getActiveDocument();
  var working = Ggit_tabText(doc.getActiveTab());
  var committed = Ggit_materialize(Ggit_storeLoad(doc), id);
  return Ggit_diffHtml(committed, working);
}

/**
 * 指定コミットの本文をアクティブタブの作業本文へ復元する（自動コミットしない）。
 * jj の working-copy モデルに合わせ、記録はユーザの明示 commit に委ねる。
 * アクティブタブ＝単一インスタンスのため Docs API は不要。
 */
function Ggit_restoreCommit(id) {
  var doc = DocumentApp.getActiveDocument();
  var tab = doc.getActiveTab();
  var meta = Ggit_metaTab(doc);
  if (meta && tab.getId() === meta.getId()) {
    throw new Error('.vcs メタタブには復元できません。対象タブを選択してください。');
  }
  var store = Ggit_storeLoad(doc);
  if (!store.objects[id]) throw new Error('コミットが見つかりません: ' + id);
  Ggit_setTabText(tab, Ggit_materialize(store, id));
  return { restored: id, tabTitle: tab.getTitle() };
}

function ggitUI_log() {
  var commits = Ggit_uiListCommits();
  if (!commits.length) {
    Ggit_showModal(
      '<div style="font:13px/1.5 Roboto,Arial,sans-serif;padding:8px;color:#888">コミットがありません。</div>',
      'ggit log', 480, 200);
    return;
  }
  var rows = commits.map(function (c) {
    return '<div class="row" data-id="' + Ggit_esc(c.id) + '" onclick="sel(this)">' +
      '<span style="font-family:monospace;color:#1a73e8">' + Ggit_esc(c.id) + '</span> ' +
      Ggit_esc(c.message) +
      '<div style="color:#888;font-size:11px">' + Ggit_esc(c.timestamp) + '</div></div>';
  }).join('');

  var html =
    '<div style="font:13px/1.5 Roboto,Arial,sans-serif;display:flex;height:470px">' +
    '<div style="width:38%;overflow:auto;border-right:1px solid #ddd">' + rows + '</div>' +
    '<div style="flex:1;display:flex;flex-direction:column;padding:0 8px;min-width:0">' +
    '<div style="margin:6px 0">' +
    '<label><input type="radio" name="mode" value="content" checked onclick="render()">内容</label> ' +
    '<label><input type="radio" name="mode" value="diff" onclick="render()">作業中との差分</label> ' +
    '<button id="restore" onclick="restore()" disabled>この版に戻す</button>' +
    '<span id="msg" style="color:#188038;margin-left:8px"></span></div>' +
    '<div id="out" style="border:1px solid #ddd;padding:8px;flex:1;overflow:auto;' +
    'white-space:pre-wrap;font-family:monospace">コミットを選択してください。</div>' +
    '</div>' +
    '<style>.row{padding:6px 8px;cursor:pointer;border-bottom:1px solid #eee}' +
    '.row.on{background:#e8f0fe}</style>' +
    '<script>' +
    'var cur=null;' +
    'function sel(el){' +
    'var rs=document.querySelectorAll(".row");for(var i=0;i<rs.length;i++)rs[i].className="row";' +
    'el.className="row on";cur=el.getAttribute("data-id");' +
    'document.getElementById("restore").disabled=false;' +
    'document.getElementById("msg").innerText="";render();}' +
    'function render(){if(!cur)return;' +
    'var mode=document.querySelector("input[name=mode]:checked").value;' +
    'var out=document.getElementById("out");out.innerText="読み込み中…";' +
    'if(mode==="content"){' +
    'google.script.run.withSuccessHandler(function(t){out.innerText=t;})' +
    '.withFailureHandler(function(e){out.innerText=e.message;}).Ggit_previewCommit(cur);' +
    '}else{' +
    'google.script.run.withSuccessHandler(function(h){out.innerHTML=h;})' +
    '.withFailureHandler(function(e){out.innerText=e.message;}).Ggit_diffCommitVsWorkingHtml(cur);}}' +
    'function restore(){if(!cur)return;' +
    'if(!confirm("選択した版の内容をアクティブタブの本文に書き戻します。未コミットの編集は失われます。よろしいですか？"))return;' +
    'document.getElementById("restore").disabled=true;' +
    'google.script.run.withSuccessHandler(function(r){' +
    'document.getElementById("msg").innerText="復元しました（"+r.restored+"）。必要なら Commit で記録してください。";' +
    'document.getElementById("restore").disabled=false;})' +
    '.withFailureHandler(function(e){document.getElementById("msg").innerText=e.message;' +
    'document.getElementById("restore").disabled=false;}).Ggit_restoreCommit(cur);}' +
    '</script></div>';
  Ggit_showModal(html, 'ggit log', 820, 520);
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
    '差分・マージはプレーンテキストを対象とします（設計仕様書 §7.3）。' +
    '</div>';
  Ggit_showModal(html, 'About ggit', 480, 220);
}
