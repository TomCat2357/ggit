/**
 * Menu.js — onOpen カスタムメニューと UI ハンドラ。
 *
 * Jujutsu 流モデル: commit は現在地 working（@）を前進させ、ブックマークは手動で設定/移動する。
 * Log はブランチ（分岐）を意識した ASCII レーングラフで表示し、フラット表示にも切替できる。
 * スタッシュは objects 内の仮コミット（stash:true）として一覧し、pop（戻して消す）/ drop できる。
 * 選択が必要な操作（diff / merge / goto / bookmark）は HtmlService の小ダイアログで行う。
 */

/** ドキュメントを開いたときにカスタムメニューを生成する（単純トリガ）。 */
function onOpen() {
  DocumentApp.getUi()
    .createMenu('ggit')
    .addItem('初期化（権限付与・.vcs作成）', 'ggitUI_setup')
    .addSeparator()
    .addItem('Commit…', 'ggitUI_commit')
    .addItem('Log（グラフ）', 'ggitUI_log')
    .addItem('Diff…', 'ggitUI_diff')
    .addSeparator()
    .addItem('Bookmark…', 'ggitUI_bookmark')
    .addItem('Goto…', 'ggitUI_goto')
    .addItem('ステータス', 'ggitUI_status')
    .addSeparator()
    .addItem('Merge…', 'ggitUI_merge')
    .addSeparator()
    .addItem('修復（壊れた履歴の復旧）', 'ggitUI_repair')
    .addItem('About', 'ggitUI_about')
    .addToUi();
}

/**
 * 初期化済み（`.vcs` あり）でなければ、案内を出して false を返す共通ガード。
 *
 * メニュー項目は onOpen（AuthMode.NONE）で静的に作られ状態で出し分けできないため、各操作の
 * 入口でこれを呼ぶ。`.vcs` 未作成のうちに commit 等が中途半端に動いて「できている」と
 * 誤解させないよう、まず「初期化（権限付与・.vcs作成）」へ誘導する。
 */
function Ggit_uiRequireInit_(ui) {
  if (Ggit_isInitialized(DocumentApp.getActiveDocument())) return true;
  ui.alert('ggit',
    'まだ初期化されていません。\n' +
    'メニューの「初期化（権限付与・.vcs作成）」を先に実行してください。',
    ui.ButtonSet.OK);
  return false;
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

/** 1ノードを UI 向けに簡約する。 */
function Ggit_uiNode(node) {
  return {
    id: node.id, message: node.message, timestamp: node.timestamp, author: node.author,
    refs: node.refs || [], isWorking: !!node.isWorking, isStash: !!node.isStash,
    isHead: !!node.isHead, hasStash: !!node.hasStash, isBroken: !!node.isBroken
  };
}

/** Log モーダル用データ: グラフ行・フラット列・現在地・ブックマーク・スタッシュ。 */
function Ggit_uiGraphData() {
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  var nodes = Ggit_collectNodes(store);

  var rows = Ggit_graphLines(nodes).map(function (r) {
    return { graph: r.graph, id: r.id, c: r.node ? Ggit_uiNode(r.node) : null };
  });
  var flat = nodes.map(Ggit_uiNode);
  var bookmarks = [];
  for (var name in store.bookmarks) {
    if (store.bookmarks.hasOwnProperty(name)) bookmarks.push({ name: name, commitId: store.bookmarks[name] });
  }
  var disconnected = Ggit_countDisconnected(store); // 非表示にした孤立／壊れコミットの件数
  var working = store.working || null;
  var workingBroken = !!(working && store.objects.hasOwnProperty(working) &&
    !Ggit_canMaterialize(store, working));
  return {
    rows: rows, flat: flat, working: working,
    bookmarks: bookmarks, stashes: Ggit_listStashes(store),
    disconnected: disconnected, workingBroken: workingBroken
  };
}

/** 全コミット（スタッシュ除く）を新しい順に返す（diff セレクタ用）。 */
function Ggit_uiListCommits() {
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  return Ggit_collectNodes(store)
    .filter(function (n) { return !n.isStash; })
    .map(Ggit_uiNode);
}

/** goto / merge / bookmark のセレクタ用: ブックマーク＋コミット＋現在地。 */
function Ggit_uiListRefs() {
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  var bookmarks = [];
  for (var name in store.bookmarks) {
    if (store.bookmarks.hasOwnProperty(name)) bookmarks.push({ name: name, commitId: store.bookmarks[name] });
  }
  var commits = Ggit_collectNodes(store)
    .filter(function (n) { return !n.isStash; })
    .map(Ggit_uiNode);
  return { bookmarks: bookmarks, commits: commits, working: store.working || null };
}

/* ===================== メニューハンドラ ===================== */

function ggitUI_setup() {
  var ui = DocumentApp.getUi();
  try {
    var info = Ggit_setup();
    ui.alert('ggit 初期化',
      info.created
        ? ('初期化が完了しました。\n' +
           '「.vcs」を作成しました（ドキュメント: ' + info.title + '）。\n' +
           'これで Commit などが使えます。')
        : '既に初期化済みです（「.vcs」あり）。Commit などがそのまま使えます。',
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('ggit 初期化', '初期化中にエラー: ' + e.message, ui.ButtonSet.OK);
  }
}

function ggitUI_commit() {
  var ui = DocumentApp.getUi();
  if (!Ggit_uiRequireInit_(ui)) return;
  var res = ui.prompt('ggit commit', 'コミットメッセージを入力してください:', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var msg = (res.getResponseText() || '').trim();
  if (!msg) { ui.alert('ggit commit', 'メッセージが空です。中止しました。', ui.ButtonSet.OK); return; }
  try {
    var id = Ggit_commit(msg);
    ui.alert('ggit commit', 'コミットしました: ' + id + '\n（現在地 @ をこのコミットへ進めました。ブックマークは動きません。）', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('ggit commit', e.message, ui.ButtonSet.OK);
  }
}

function ggitUI_log() {
  var ui = DocumentApp.getUi();
  if (!Ggit_uiRequireInit_(ui)) return;
  // データ取得・移動・スタッシュ操作はすべてクライアントから google.script.run で呼ぶ。
  // コミット行クリックでその時点へ現在地 @ を移動（未コミット内容はスタッシュへ退避）。
  var html =
    '<div style="font:13px/1.5 Roboto,Arial,sans-serif;padding:4px">' +
    '<div style="margin-bottom:4px">' +
    '<button id="bGraph" onclick="setView(\'graph\')">グラフ</button> ' +
    '<button id="bFlat" onclick="setView(\'flat\')">フラット</button>' +
    '<button id="bGc" onclick="gc()" title="繋がりのなくなったコミットを削除" ' +
    'style="margin-left:10px;display:none;color:#b06000"></button>' +
    '<span id="working" style="margin-left:10px;color:#188038"></span></div>' +
    '<div id="status" style="min-height:18px;color:#188038;margin-bottom:6px"></div>' +
    '<div id="broken" style="color:#d93025;margin-bottom:6px"></div>' +
    '<div style="color:#888;margin-bottom:4px">' +
    '行をクリックすると現在地 @ をそのコミットへ移動します（現在の未コミット内容はスタッシュに退避）。' +
    'スタッシュ行は移動対象外です（下の一覧で「戻す(pop)」/「破棄」してください）。' +
    'コミットは @ を移しても消えません（匿名ヘッドとして残ります）。不要な枝は葉の「破棄」で削除できます。' +
    '内容を復元できない壊れたコミットだけは表示されず、「掃除」で削除できます。' +
    '<code>&lt;name&gt;</code>=ブックマーク, <code>@</code>=現在地, <code>[stash]</code>=スタッシュ。</div>' +
    '<div id="list">読み込み中…</div>' +
    '<div id="stashes"></div>' +
    '<script>' +
    'var DATA=null,VIEW="graph";' +
    'function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}' +
    'function setStatus(m,err){var d=document.getElementById("status");d.style.color=err?"#d93025":"#188038";d.innerText=m||"";}' +
    'function onErr(e){setStatus(e.message||String(e),true);}' +
    'function refs(c){var h="";if(c.refs&&c.refs.length){h+=" "+c.refs.map(function(n){return "<span style=\\"background:#e8f0fe;color:#1a73e8;border-radius:3px;padding:0 4px\\">"+esc(n)+"</span>";}).join(" ");}' +
    'if(c.isWorking){h+=" <span style=\\"color:#188038;font-weight:bold\\">@</span>";}' +
    'if(c.isStash){h+=" <span style=\\"color:#b06000\\">[stash]</span>";}' +
    'if(c.isBroken){h+=" <span style=\\"color:#d93025;font-weight:bold\\">[壊れ]</span>";}return h;}' +
    'function commitCell(c){var ab=(c.isHead&&!c.isWorking&&!c.isStash)?" <button onclick=\\"event.stopPropagation();abandon(\'"+esc(c.id)+"\',"+(c.hasStash?"true":"false")+")\\" title=\\"この葉コミットの枝を破棄\\" style=\\"color:#b06000\\">破棄</button>":"";' +
    'return "<span style=\\"font-family:monospace;color:#1a73e8\\">"+esc(c.id)+"</span>"+refs(c)+"  "+esc(c.message)+" <span style=\\"color:#aaa\\">"+esc(c.timestamp)+"</span>"+ab;}' +
    'function rowClick(id){return "onclick=\\"goTo(\'"+esc(id)+"\')\\" onmouseover=\\"this.style.background=\'#f1f3f4\'\\" onmouseout=\\"this.style.background=\'\'\\" style=\\"cursor:pointer\\"";}' +
    'function renderGraph(){var rows=DATA.rows;if(!rows.length)return "<div style=\\"color:#888\\">コミットがありません。</div>";' +
    'var h="<table style=\\"border-collapse:collapse;width:100%\\">";' +
    'for(var i=0;i<rows.length;i++){var r=rows[i];' +
    'var g="<td style=\\"font-family:monospace;white-space:pre;color:#444\\">"+esc(r.graph)+"</td>";' +
    'if(r.c){h+="<tr "+(r.c.isStash?"":rowClick(r.c.id))+">"+g+"<td>"+commitCell(r.c)+"</td></tr>";}' +
    'else{h+="<tr>"+g+"<td></td></tr>";}}' +
    'return h+"</table>";}' +
    'function renderFlat(){var f=DATA.flat;if(!f.length)return "<div style=\\"color:#888\\">コミットがありません。</div>";' +
    'var h="<table style=\\"border-collapse:collapse;width:100%\\">";' +
    'for(var i=0;i<f.length;i++){var c=f[i];h+="<tr "+(c.isStash?"":rowClick(c.id))+"><td>"+commitCell(c)+"</td></tr>";}' +
    'return h+"</table>";}' +
    'function render(){' +
    'document.getElementById("working").innerText=DATA.working?("現在地 @ "+DATA.working):"(現在地なし)";' +
    'document.getElementById("bGraph").disabled=(VIEW==="graph");' +
    'document.getElementById("bFlat").disabled=(VIEW==="flat");' +
    'var dc=DATA.disconnected||{total:0,orphans:0,broken:0};' +
    'var gb=document.getElementById("bGc");' +
    'if(dc.total>0){gb.style.display="";gb.innerText="掃除 ("+dc.total+")";' +
    'gb.title="繋がりのなくなったコミット "+dc.total+" 件（孤立 "+dc.orphans+" / 壊れ "+dc.broken+"）を削除";}' +
    'else{gb.style.display="none";}' +
    'var bk=document.getElementById("broken");' +
    'bk.innerHTML=DATA.workingBroken?"現在地 @ の内容を復元できません（壊れています）。メニューの「修復」で立て直してください。":"";' +
    'document.getElementById("list").innerHTML=(VIEW==="graph")?renderGraph():renderFlat();' +
    'var s=document.getElementById("stashes");' +
    'if(!DATA.stashes.length){s.innerHTML="";}' +
    'else{var sr=DATA.stashes.map(function(o){' +
    'return "<tr><td style=\\"font-family:monospace;white-space:nowrap\\">"+esc(o.id)+"</td>"+' +
    '"<td>"+esc(o.message)+"</td>"+' +
    '"<td style=\\"color:#888;white-space:nowrap\\">"+esc(o.timestamp)+"</td>"+' +
    '"<td style=\\"white-space:nowrap\\"><button onclick=\\"popStash(\'"+esc(o.id)+"\')\\">戻す(pop)</button> "+' +
    '"<button onclick=\\"dropStash(\'"+esc(o.id)+"\')\\">破棄</button></td></tr>";}).join("");' +
    's.innerHTML="<div style=\\"margin-top:14px;font-weight:bold\\">スタッシュ（仮コミット）</div>"+' +
    '"<table style=\\"border-collapse:collapse;width:100%\\"><thead><tr style=\\"text-align:left;border-bottom:1px solid #ddd\\">"+' +
    '"<th>id</th><th>message</th><th>timestamp</th><th></th></tr></thead><tbody>"+sr+"</tbody></table>";}}' +
    'function setView(v){VIEW=v;if(DATA)render();}' +
    'function refresh(){google.script.run.withSuccessHandler(function(d){DATA=d;render();}).withFailureHandler(onErr).Ggit_uiGraphData();}' +
    'function goTo(id){if(!confirm("現在地 @ を "+id+" へ移動します。\\n現在の未コミット内容はスタッシュに退避されます。よろしいですか？"))return;' +
    'setStatus("移動中…");google.script.run.withSuccessHandler(function(r){setStatus("移動しました: "+r.commitId+(r.stashed?"（未コミット内容をスタッシュに退避）":""));refresh();}).withFailureHandler(onErr).Ggit_goto(id);}' +
    'function popStash(id){if(!confirm("スタッシュ "+id+" の内容を現在のタブに戻し、このスタッシュを消します。よろしいですか？"))return;' +
    'setStatus("適用中…");google.script.run.withSuccessHandler(function(r){setStatus("スタッシュを戻して消しました"+(r.stashed?"（直前の内容を退避）":""));refresh();}).withFailureHandler(onErr).Ggit_popStash(id);}' +
    'function dropStash(id){if(!confirm("スタッシュ "+id+" を破棄します。元に戻せません。よろしいですか？"))return;' +
    'google.script.run.withSuccessHandler(function(){setStatus("スタッシュを破棄しました");refresh();}).withFailureHandler(onErr).Ggit_dropStash(id);}' +
    'function abandon(id,hasStash){var m=hasStash?("コミット "+id+" には未コミット内容のスタッシュが付いています。\\n枝を破棄すると、その付随スタッシュも一緒に破棄されます（元に戻せません）。よろしいですか？"):("コミット "+id+" の枝を破棄します（葉から分岐元まで遡って削除）。\\n現在地 @ ・ブックマーク先・他の枝が乗る地点は残します。元に戻せません。よろしいですか？");if(!confirm(m))return;' +
    'setStatus("破棄中…");google.script.run.withSuccessHandler(function(r){setStatus("破棄しました: "+r.removed+" 件削除"+(r.droppedStashes?("（スタッシュ "+r.droppedStashes+" 件も破棄）"):""));refresh();}).withFailureHandler(onErr).Ggit_abandonCommit(id);}' +
    'function gc(){var dc=DATA.disconnected||{total:0,orphans:0,broken:0};if(!dc.total)return;' +
    'if(!confirm("繋がりのなくなったコミット "+dc.total+" 件（孤立 "+dc.orphans+" / 壊れ "+dc.broken+"）を削除します。\\n現在地 @ は残します。元に戻せません。よろしいですか？"))return;' +
    'setStatus("掃除中…");' +
    'google.script.run.withSuccessHandler(function(r){setStatus("掃除しました: "+r.removed+" 件削除（孤立 "+r.orphans+" / 壊れ "+r.broken+"）"+(r.workingBroken?" ※現在地 @ が壊れています。修復してください。":""));refresh();}).withFailureHandler(onErr).Ggit_gcDisconnected();}' +
    'refresh();' +
    '</script></div>';
  Ggit_showModal(html, 'ggit log', 720, 560);
}

function ggitUI_diff() {
  var ui = DocumentApp.getUi();
  if (!Ggit_uiRequireInit_(ui)) return;
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

function ggitUI_bookmark() {
  var ui = DocumentApp.getUi();
  if (!Ggit_uiRequireInit_(ui)) return;
  var refs = Ggit_uiListRefs();
  if (!refs.commits.length) {
    ui.alert('ggit bookmark', 'コミットがありません。先にコミットしてください。', ui.ButtonSet.OK);
    return;
  }
  var optsC = refs.commits.map(function (c) {
    var sel = (c.id === refs.working) ? ' selected' : '';
    return '<option value="' + Ggit_esc(c.id) + '"' + sel + '>' +
      Ggit_esc(c.id + ' — ' + c.message) + '</option>';
  }).join('');
  var optsExisting = refs.bookmarks.map(function (b) {
    return '<option value="' + Ggit_esc(b.name) + '">' + Ggit_esc(b.name + ' @ ' + b.commitId) + '</option>';
  }).join('');

  var html =
    '<div style="font:13px/1.5 Roboto,Arial,sans-serif;padding:4px">' +
    '<p><b>ブックマーク</b>は手動で付ける名前付きポインタです。commit では自動で動きません。</p>' +
    '<div style="margin-bottom:8px">' +
    '名前: <input id="name" type="text" placeholder="main など" /> ' +
    '位置: <select id="commit">' + optsC + '</select> ' +
    '<button id="set" onclick="doSet()">設定/移動</button></div>' +
    '<div style="margin-bottom:8px">' +
    '削除: <select id="del">' + (optsExisting || '<option value="">（なし）</option>') + '</select> ' +
    '<button id="rm" onclick="doDel()" ' + (optsExisting ? '' : 'disabled') + '>削除</button></div>' +
    '<div id="out" style="margin-top:8px"></div>' +
    '<script>' +
    'function out(m,err){var d=document.getElementById("out");d.style.color=err?"#d93025":"#188038";d.innerText=m;}' +
    'function doSet(){var n=document.getElementById("name").value.trim();if(!n){out("名前が空です。",true);return;}' +
    'var c=document.getElementById("commit").value;document.getElementById("set").disabled=true;' +
    'google.script.run.withSuccessHandler(function(r){out("ブックマーク「"+r.name+"」を "+r.commitId+" に設定しました。");document.getElementById("set").disabled=false;})' +
    '.withFailureHandler(function(e){out(e.message,true);document.getElementById("set").disabled=false;}).Ggit_bookmarkSet(n,c);}' +
    'function doDel(){var n=document.getElementById("del").value;if(!n){return;}' +
    'if(!confirm("ブックマーク「"+n+"」を削除します。よろしいですか？"))return;' +
    'google.script.run.withSuccessHandler(function(r){out("ブックマーク「"+r.name+"」を削除しました。");})' +
    '.withFailureHandler(function(e){out(e.message,true);}).Ggit_bookmarkDelete(n);}' +
    '</script></div>';
  Ggit_showModal(html, 'ggit bookmark', 560, 320);
}

function ggitUI_goto() {
  var ui = DocumentApp.getUi();
  if (!Ggit_uiRequireInit_(ui)) return;
  var refs = Ggit_uiListRefs();
  if (!refs.commits.length) {
    ui.alert('ggit goto', '移動先のコミットがありません。先にコミットしてください。', ui.ButtonSet.OK);
    return;
  }
  var optsB = refs.bookmarks.map(function (b) {
    return '<option value="' + Ggit_esc(b.name) + '">' + Ggit_esc('ブックマーク: ' + b.name + ' @ ' + b.commitId) + '</option>';
  }).join('');
  var optsC = refs.commits.map(function (c) {
    return '<option value="' + Ggit_esc(c.id) + '">' + Ggit_esc('コミット: ' + c.id + ' — ' + c.message) + '</option>';
  }).join('');

  var html =
    '<div style="font:13px/1.5 Roboto,Arial,sans-serif;padding:4px">' +
    '<p>現在地 @ を選択先へ移動し、現在のタブの本文をその内容に置き換えます。' +
    '未コミットの変更はスタッシュ（仮コミット）へ自動退避します。</p>' +
    '移動先: <select id="t">' + optsB + optsC + '</select> ' +
    '<button id="go" onclick="run()">移動</button>' +
    '<div id="out" style="margin-top:8px"></div>' +
    '<script>' +
    'function run(){document.getElementById("go").disabled=true;' +
    'var t=document.getElementById("t").value;' +
    'document.getElementById("out").innerText="移動中…";' +
    'google.script.run.withSuccessHandler(function(r){' +
    'document.getElementById("out").innerText="現在地 @ を "+r.commitId+" へ移動しました。"+(r.stashed?"（未コミット内容をスタッシュに退避）":"");' +
    'document.getElementById("go").disabled=false;})' +
    '.withFailureHandler(function(e){document.getElementById("out").innerText=e.message;document.getElementById("go").disabled=false;})' +
    '.Ggit_goto(t);}' +
    '</script></div>';
  Ggit_showModal(html, 'ggit goto', 560, 300);
}

function ggitUI_status() {
  var ui = DocumentApp.getUi();
  if (!Ggit_uiRequireInit_(ui)) return;
  var doc = DocumentApp.getActiveDocument();
  var store = Ggit_storeLoad(doc);
  var working = Ggit_resolveWorking(doc, store);
  if (!working) {
    ui.alert('ggit', 'まだコミットがありません。Commit… で最初のコミットを作成してください。', ui.ButtonSet.OK);
    return;
  }
  var bm = [];
  for (var k in store.bookmarks) {
    if (store.bookmarks.hasOwnProperty(k)) bm.push(k + ' @ ' + store.bookmarks[k]);
  }
  var stashes = Ggit_listStashes(store);
  ui.alert('ggit',
    '現在地 @: ' + working + '\n' +
    'このコミットまでの履歴: ' + Ggit_logChain(store, working).length + '\n' +
    'ブックマーク: ' + (bm.length ? bm.join(', ') : '（なし）') + '\n' +
    'スタッシュ: ' + stashes.length + ' 件', ui.ButtonSet.OK);
}

function ggitUI_merge() {
  var ui = DocumentApp.getUi();
  if (!Ggit_uiRequireInit_(ui)) return;
  var refs = Ggit_uiListRefs();
  if (!refs.working) {
    ui.alert('ggit merge', '現在地がありません。先にコミットしてください。', ui.ButtonSet.OK);
    return;
  }
  var optsB = refs.bookmarks.map(function (b) {
    return '<option value="' + Ggit_esc(b.name) + '">' + Ggit_esc('ブックマーク: ' + b.name) + '</option>';
  }).join('');
  var optsC = refs.commits.filter(function (c) { return c.id !== refs.working; }).map(function (c) {
    return '<option value="' + Ggit_esc(c.id) + '">' + Ggit_esc('コミット: ' + c.id + ' — ' + c.message) + '</option>';
  }).join('');
  if (!optsB && !optsC) {
    ui.alert('ggit merge', 'マージ可能な対象がありません。', ui.ButtonSet.OK);
    return;
  }

  var html =
    '<div style="font:13px/1.5 Roboto,Arial,sans-serif;padding:4px">' +
    '<p>選択したマージ元を、現在地 @ へ 3-way マージします。</p>' +
    'マージ元: <select id="s">' + optsB + optsC + '</select> ' +
    '<button id="go" onclick="run()">マージ実行</button>' +
    '<div id="out" style="margin-top:8px"></div>' +
    '<script>' +
    'function run(){document.getElementById("go").disabled=true;' +
    'document.getElementById("out").innerText="マージ中…";' +
    'var s=document.getElementById("s").value;' +
    'google.script.run.withSuccessHandler(function(r){' +
    'var m;if(r.upToDate){m="既に取り込み済みです（変更なし）。";}' +
    'else if(r.fastForward){m="早送り（fast-forward）で取り込みました。"+(r.stashed?"（未コミット内容をスタッシュに退避）":"");}' +
    'else if(r.conflict){m="競合が発生しました。本文に <<<<<<< / ======= / >>>>>>> マーカーを書き戻しました。手動で解決後、commit してください。";}' +
    'else{m="クリーンにマージしました。マージコミット: "+r.commitId;}' +
    'document.getElementById("out").innerText=m;document.getElementById("go").disabled=false;})' +
    '.withFailureHandler(function(e){document.getElementById("out").innerText=e.message;document.getElementById("go").disabled=false;})' +
    '.Ggit_merge(s);}' +
    '</script></div>';
  Ggit_showModal(html, 'ggit merge', 560, 260);
}

function ggitUI_repair() {
  var ui = DocumentApp.getUi();
  if (!Ggit_uiRequireInit_(ui)) return;
  var res = ui.alert('ggit 修復',
    '壊れた履歴（破棄されたスタッシュ等で親を失ったコミット）を復旧します。\n\n' +
    '・現在地 @ の本文が復元できない場合、いま開いているタブの本文を @ の内容として作り直します。\n' +
    '  → 必ず @ の作業タブを開いた状態で実行してください。\n' +
    '・親を失ったその他のコミットは根として切り離します（差分連鎖が壊れたものは本文を復元できません）。\n\n' +
    '実行しますか？', ui.ButtonSet.OK_CANCEL);
  if (res !== ui.Button.OK) return;
  try {
    var r = Ggit_repairStore();
    ui.alert('ggit 修復',
      '完了しました。\n' +
      '現在地 @ の再構築: ' + (r.recoveredWorking ? 'あり（タブ本文から復元）' : 'なし') + '\n' +
      '切り離した参照: ' + r.detached + ' 件\n' +
      (r.lost.length ? '本文を復元できなかったコミット: ' + r.lost.join(', ')
                     : '本文の欠落はありませんでした'),
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('ggit 修復', e.message, ui.ButtonSet.OK);
  }
}

function ggitUI_about() {
  var html =
    '<div style="font:13px/1.6 Roboto,Arial,sans-serif;padding:8px">' +
    '<b>ggit</b> — Googleドキュメント単体で動く Git/Jujutsu 風バージョン管理ツール<br>' +
    '1枚の作業タブの中で commit / log（グラフ）/ diff / bookmark / goto / merge を提供します。<br><br>' +
    '<b>Jujutsu 流モデル</b>: 現在地 <code>@</code> はコミットID（匿名ヘッド）。commit は <code>@</code> を' +
    '前進させますが、<b>ブックマークは手動で set/move したときだけ動きます</b>。Log はブランチ（分岐）を' +
    '意識した ASCII レーングラフで表示し、フラット表示にも切替できます。<br><br>' +
    'スタッシュは <code>.vcs</code> の中に「<b>スタッシュだと分かる仮コミット（stash:true）</b>」として' +
    '記録され、戻す（pop）と消えます。<br><br>' +
    '初回は <b>「初期化（権限付与・.vcs作成）」</b>を実行してください。権限付与と <code>.vcs</code> 作成までを' +
    'これ1つで完結します。<br>' +
    'commit は <code>@</code> を移しても消えず、<b>匿名ヘッド</b>として Log に残ります。不要な枝は葉の' +
    '<b>「破棄」</b>で削除できます。内容を復元できない<b>壊れたコミット</b>だけは表示されず、' +
    '<b>「掃除」</b>でまとめて削除できます（現在地 @ は残ります）。<br><br>' +
    'オブジェクトストアは <code>.vcs</code> メタタブに JSON で保存されます。<code>.vcs</code> タブは手動編集しないでください。<br>' +
    'commit は本文の書式（文字・段落書式）も記録し、goto では書式ごと復元します。' +
    '差分・マージはプレーンテキストを対象とします（設計仕様書 §7.3 / §7.4）。' +
    '</div>';
  Ggit_showModal(html, 'About ggit', 520, 320);
}
