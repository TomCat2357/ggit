/**
 * Menu.js — onOpen カスタムメニューと UI ハンドラ。
 *
 * Jujutsu 流モデル: commit は現在地 working（@）を前進させ、ブックマークは手動で設定/移動する。
 * Log はブランチ（分岐）を意識した ASCII レーングラフで表示し、フラット表示にも切替できる。
 * スタッシュは objects 内の仮コミット（stash:true）として一覧し、pop（戻して消す）/ drop できる。
 * Log（グラフ）画面を操作ハブとし、行を選択して diff / merge / bookmark / 移動(goto) を実行できる
 * （diff/merge/bookmark/goto のメニュー項目は廃止し、すべて Log（グラフ）画面に統合した）。
 */

/**
 * ドキュメントを開いたときにカスタムメニューを生成する（単純トリガ）。
 *
 * diff / bookmark / merge は「Log（グラフ）」画面に統合したため、メニューには出さない
 * （要望: ログ画面で bookmark の閲覧・編集・diff の閲覧・merge・移動まで完結する）。
 */
function onOpen() {
  DocumentApp.getUi()
    .createMenu('ggit')
    .addItem('初期化（権限付与・.vcs作成）', 'ggitUI_setup')
    .addSeparator()
    .addItem('Commit…', 'ggitUI_commit')
    .addItem('Log（グラフ・操作ハブ）', 'ggitUI_log')
    .addItem('ステータス', 'ggitUI_status')
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

/**
 * 1ノードを UI 向けに簡約する。
 * parent は「直線表示（クリック地点→ルート）」をクライアント側で辿るための第1親
 * （表示対象の親のみ。表示対象外＝壊れ/孤立の親は collectNodes 段階で落ちているので null）。
 */
function Ggit_uiNode(node) {
  return {
    id: node.id, message: node.message, timestamp: node.timestamp, author: node.author,
    refs: node.refs || [], isWorking: !!node.isWorking, isStash: !!node.isStash,
    isHead: !!node.isHead, hasStash: !!node.hasStash, isBroken: !!node.isBroken,
    parent: (node.parents && node.parents.length) ? node.parents[0] : null
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

/** goto のセレクタ用: ブックマーク＋コミット＋現在地。 */
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

/**
 * Commit ダイアログ。
 *
 * ネイティブの ui.prompt は Enter での確定が効かないため、テキスト入力に Enter キーで
 * コミットできる独自モーダルにする（要望: コミット時に Enter だけで確定）。
 * 成功メッセージは簡潔に（要望: 「ブックマークは動きません」の案内は不要）。
 */
function ggitUI_commit() {
  var ui = DocumentApp.getUi();
  if (!Ggit_uiRequireInit_(ui)) return;
  var html =
    '<div style="font:13px/1.5 Roboto,Arial,sans-serif;padding:6px">' +
    '<p style="margin:0 0 6px">コミットメッセージを入力してください（<b>Enter</b> でコミット）:</p>' +
    '<input id="msg" type="text" style="width:100%;box-sizing:border-box" />' +
    '<div style="margin-top:8px">' +
    '<button id="ok">コミット</button> ' +
    '<button id="cancel">キャンセル</button></div>' +
    '<div id="out" style="margin-top:8px;min-height:18px"></div>' +
    '<script>' +
    'function el(id){return document.getElementById(id);}' +
    'function run(){var msg=(el("msg").value||"").trim();' +
    'if(!msg){el("out").style.color="#d93025";el("out").textContent="メッセージが空です。";el("msg").focus();return;}' +
    'el("ok").disabled=true;el("out").style.color="#188038";el("out").textContent="コミット中…";' +
    'google.script.run.withSuccessHandler(function(id){' +
    'el("out").textContent="コミットしました: "+id;' +
    'setTimeout(function(){google.script.host.close();},800);})' +
    '.withFailureHandler(function(e){el("ok").disabled=false;el("out").style.color="#d93025";el("out").textContent=e.message;el("msg").focus();})' +
    '.Ggit_commit(msg);}' +
    'el("ok").addEventListener("click",run);' +
    'el("cancel").addEventListener("click",function(){google.script.host.close();});' +
    'el("msg").addEventListener("keydown",function(e){if(e.keyCode===13){e.preventDefault();run();}});' +
    'el("msg").focus();' +
    '</script></div>';
  Ggit_showModal(html, 'ggit commit', 460, 200);
}

/**
 * Log（グラフ）= 操作ハブ。
 *
 * 行クリックでコミットを「選択」（ハイライト）し、下部の操作パネルから 移動(goto) / マージ /
 * ブックマーク設定・削除 / diff を実行する。選択コミットは「直線表示（クリック地点→ルート）」の
 * 起点にもなる。データ取得・各操作はすべてクライアントから google.script.run でサーバ関数を呼ぶ
 * （commit/goto/merge/bookmark/diff/stash/gc のロジックは既存実装を再利用）。
 *
 * 行・チップ生成は DOM API（createElement/textContent/dataset）で行い、HTML 文字列の
 * クォートエスケープを避ける。イベントは委譲（addEventListener）で受ける。
 */
function ggitUI_log() {
  var ui = DocumentApp.getUi();
  if (!Ggit_uiRequireInit_(ui)) return;

  var style =
    '<style>' +
    '.gg{font:13px/1.5 Roboto,Arial,sans-serif;padding:4px}' +
    '.gg .hdr{padding:6px 8px;background:#f8f9fa;border:1px solid #e0e0e0;border-radius:4px;margin-bottom:6px}' +
    '.gg .broken{color:#d93025;margin-bottom:6px}' +
    '.gg .bar{margin-bottom:4px}' +
    '.gg .bar .lin{margin-left:12px}' +
    '.gg .gc{margin-left:12px;color:#b06000}' +
    '.gg .status{min-height:18px;color:#188038;margin-bottom:6px}' +
    '.gg .help{color:#888;margin-bottom:4px}' +
    '.gg table{border-collapse:collapse;width:100%}' +
    '.gg td{padding:1px 2px;vertical-align:top}' +
    '.gg .row{cursor:pointer}' +
    '.gg .row:hover{background:#f1f3f4}' +
    '.gg .row.sel{background:#d2e3fc}' +
    '.gg .row.sel:hover{background:#d2e3fc}' +
    '.gg .g{font-family:monospace;white-space:pre;color:#444}' +
    '.gg .hash{font-family:monospace;color:#1a73e8}' +
    '.gg .at{color:#188038;font-weight:bold}' +
    '.gg .chip{background:#e8f0fe;color:#1a73e8;border-radius:3px;padding:0 4px;margin:0 1px}' +
    '.gg .stash{color:#b06000}' +
    '.gg .brk{color:#d93025;font-weight:bold}' +
    '.gg .author{color:#188038}' +
    '.gg .time{color:#aaa}' +
    '.gg .warn{color:#b06000}' +
    '.gg .panel{margin-top:14px;border-top:2px solid #e0e0e0;padding-top:8px}' +
    '.gg .ph{font-weight:bold;margin-bottom:6px}' +
    '.gg .selinfo{font-weight:normal;color:#555;margin-left:6px}' +
    '.gg .pr{margin-bottom:8px}' +
    '.gg .lbl{color:#555;margin-right:4px}' +
    '.gg .bmlist{margin-left:8px}' +
    '.gg .diffout{border:1px solid #ddd;padding:8px;min-height:60px;max-height:240px;white-space:pre-wrap;font-family:monospace;overflow:auto;margin-top:6px}' +
    '</style>';

  var body =
    '<div id="header" class="hdr">読み込み中…</div>' +
    '<div id="broken" class="broken"></div>' +
    '<div class="bar">' +
    '<button id="bGraph">グラフ</button> ' +
    '<button id="bFlat">フラット</button>' +
    '<label class="lin"><input type="checkbox" id="linear"> 直線表示（選択地点→ルートだけ）</label>' +
    '<button id="bGc" class="gc" style="display:none"></button>' +
    '</div>' +
    '<div id="status" class="status"></div>' +
    '<div class="help">' +
    '行をクリックするとそのコミットを<b>選択</b>します（下の操作と「直線表示」の対象になります）。' +
    'スタッシュ行は選択対象外です（下の一覧で「戻す(pop)」/「破棄」）。' +
    'コミットは @ を移しても消えません（匿名ヘッドとして残る）。不要な枝は葉の「破棄」で削除、' +
    '復元できない壊れたコミットは非表示で「掃除」で削除できます。' +
    '<code>&lt;name&gt;</code>=ブックマーク, <code>@</code>=現在地, <code>[stash]</code>=スタッシュ。</div>' +
    '<div id="list" class="list">読み込み中…</div>' +
    '<div id="stashes"></div>' +
    '<div class="panel">' +
    '<div class="ph">操作 <span id="selInfo" class="selinfo"></span></div>' +
    '<div class="pr">' +
    '<button id="opGoto">移動(goto)</button> ' +
    '<button id="opMerge">＠へマージ</button></div>' +
    '<div class="pr"><span class="lbl">bookmark:</span>' +
    '<input id="bmName" type="text" placeholder="main など" /> ' +
    '<button id="opBmSet">設定</button>' +
    '<span id="bmList" class="bmlist"></span></div>' +
    '<div class="pr"><span class="lbl">diff:</span>' +
    'A <input id="dFilterA" type="text" placeholder="A絞り込み（ID・メッセージ）" style="width:150px" /> <select id="dA"></select> ' +
    'B <input id="dFilterB" type="text" placeholder="B絞り込み（ID・メッセージ）" style="width:150px" /> <select id="dB"></select> ' +
    '<button id="opDiff">差分表示</button></div>' +
    '<div id="diffOut" class="diffout"></div>' +
    '</div>';

  var script =
    '<script>' +
    'var DATA=null,VIEW="graph",LINEAR=false,SEL=null;' +
    'function el(id){return document.getElementById(id);}' +
    'function setStatus(m,err){var d=el("status");d.style.color=err?"#d93025":"#188038";d.textContent=m||"";}' +
    'function onErr(e){setStatus(e.message||String(e),true);}' +
    'function fmtTime(ts){if(!ts)return "";var s=String(ts).replace("T"," ");' +
    'if(s.charAt(s.length-1)==="Z")return s.substring(0,s.length-1);' +
    'var c=s.charAt(s.length-6);' +
    'if((c==="+"||c==="-")&&s.charAt(s.length-3)===":")return s.substring(0,s.length-6);' +
    'return s;}' +
    'function nodeMap(){var m={};if(DATA&&DATA.flat){for(var i=0;i<DATA.flat.length;i++)m[DATA.flat[i].id]=DATA.flat[i];}return m;}' +
    'function chain(start){var m=nodeMap(),out=[],id=start,g=0;while(id&&m[id]&&g<100000){out.push(m[id]);id=m[id].parent;g++;}return out;}' +
    'function commitList(){var out=[];if(DATA&&DATA.flat){for(var i=0;i<DATA.flat.length;i++){if(!DATA.flat[i].isStash)out.push(DATA.flat[i]);}}return out;}' +
    'function span(cls,txt){var s=document.createElement("span");if(cls)s.className=cls;s.textContent=txt;return s;}' +
    'function txt(t){return document.createTextNode(t);}' +
    'function appendRefs(td,c){var i;if(c.refs){for(i=0;i<c.refs.length;i++){td.appendChild(txt(" "));td.appendChild(span("chip",c.refs[i]));}}' +
    'if(c.isWorking){td.appendChild(txt(" "));td.appendChild(span("at","@"));}' +
    'if(c.isStash){td.appendChild(txt(" "));td.appendChild(span("stash","[stash]"));}' +
    'if(c.isBroken){td.appendChild(txt(" "));td.appendChild(span("brk","[壊れ]"));}}' +
    'function fillCell(td,c){td.appendChild(span("hash",c.id));appendRefs(td,c);' +
    'td.appendChild(txt("  "+(c.message||"")+"  "));' +
    'td.appendChild(span("author",c.author||""));td.appendChild(txt("  "));' +
    'td.appendChild(span("time",fmtTime(c.timestamp)));' +
    'if(c.isHead&&!c.isWorking&&!c.isStash){td.appendChild(txt(" "));' +
    'var b=document.createElement("button");b.className="warn";b.textContent="破棄";b.title="この葉コミットの枝を破棄";' +
    'b.setAttribute("data-act","abandon");b.setAttribute("data-id",c.id);b.setAttribute("data-hasstash",c.hasStash?"1":"0");' +
    'td.appendChild(b);}}' +
    'function makeRow(c,graph){var tr=document.createElement("tr");' +
    'if(graph!=null){var g=document.createElement("td");g.className="g";g.textContent=graph;tr.appendChild(g);}' +
    'if(c){if(!c.isStash){tr.className="row"+(c.id===SEL?" sel":"");tr.setAttribute("data-id",c.id);}' +
    'var td=document.createElement("td");fillCell(td,c);tr.appendChild(td);}' +
    'else{tr.appendChild(document.createElement("td"));}return tr;}' +
    'function helpDiv(t){var d=document.createElement("div");d.className="help";d.textContent=t;return d;}' +
    'function renderList(){var host=el("list");host.innerHTML="";if(!DATA){host.textContent="読み込み中…";return;}' +
    'var table=document.createElement("table"),i;' +
    'if(LINEAR){var start=SEL||DATA.working;' +
    'if(!start){host.appendChild(helpDiv("直線表示の起点がありません（行を選択するか、Commit で現在地 @ を作成してください）。"));return;}' +
    'var ch=chain(start);if(!ch.length){host.appendChild(helpDiv("表示できるコミットがありません。"));return;}' +
    'for(i=0;i<ch.length;i++)table.appendChild(makeRow(ch[i],null));host.appendChild(table);return;}' +
    'if(VIEW==="graph"){var rows=DATA.rows||[];if(!rows.length){host.appendChild(helpDiv("コミットがありません。"));return;}' +
    'for(i=0;i<rows.length;i++)table.appendChild(makeRow(rows[i].c,rows[i].graph));}' +
    'else{var f=DATA.flat||[];if(!f.length){host.appendChild(helpDiv("コミットがありません。"));return;}' +
    'for(i=0;i<f.length;i++)table.appendChild(makeRow(f[i],null));}' +
    'host.appendChild(table);}' +
    'function renderHeader(){var host=el("header");host.innerHTML="";if(!DATA)return;' +
    'if(!DATA.working){host.appendChild(span("help","(現在地なし — Commit でコミットを作成してください)"));return;}' +
    'host.appendChild(span("at","現在地 @ "));host.appendChild(span("hash",DATA.working));' +
    'var wn=nodeMap()[DATA.working]||null;if(wn&&wn.refs){for(var i=0;i<wn.refs.length;i++){host.appendChild(txt(" "));host.appendChild(span("chip",wn.refs[i]));}}}' +
    'function renderBookmarks(){var host=el("bmList");host.innerHTML="";' +
    'if(!DATA||!DATA.bookmarks||!DATA.bookmarks.length){host.appendChild(span("help","（ブックマークなし）"));return;}' +
    'for(var i=0;i<DATA.bookmarks.length;i++){var b=DATA.bookmarks[i];' +
    'host.appendChild(span("chip",b.name));host.appendChild(txt(" "));' +
    'host.appendChild(span("time","@"+b.commitId));host.appendChild(txt(" "));' +
    'var del=document.createElement("button");del.textContent="削除";del.setAttribute("data-act","bmdel");del.setAttribute("data-name",b.name);' +
    'host.appendChild(del);host.appendChild(txt("  "));}}' +
    'function renderStashes(){var host=el("stashes");host.innerHTML="";if(!DATA||!DATA.stashes||!DATA.stashes.length)return;' +
    'var title=document.createElement("div");title.className="ph";title.style.marginTop="14px";title.textContent="スタッシュ（仮コミット）";host.appendChild(title);' +
    'var table=document.createElement("table");' +
    'for(var i=0;i<DATA.stashes.length;i++){var o=DATA.stashes[i];var tr=document.createElement("tr");' +
    'var t1=document.createElement("td");t1.className="hash";t1.textContent=o.id;tr.appendChild(t1);' +
    'var t2=document.createElement("td");t2.textContent="  "+(o.message||"")+"  ";tr.appendChild(t2);' +
    'var t3=document.createElement("td");t3.className="time";t3.textContent=fmtTime(o.timestamp);tr.appendChild(t3);' +
    'var t4=document.createElement("td");' +
    'var pop=document.createElement("button");pop.textContent="戻す(pop)";pop.setAttribute("data-act","pop");pop.setAttribute("data-id",o.id);t4.appendChild(pop);' +
    't4.appendChild(txt(" "));' +
    'var drp=document.createElement("button");drp.textContent="破棄";drp.setAttribute("data-act","drop");drp.setAttribute("data-id",o.id);t4.appendChild(drp);' +
    'tr.appendChild(t4);table.appendChild(tr);}host.appendChild(table);}' +
    'function diffFilterText(id){var f=el(id);return f?(f.value||"").trim().toLowerCase():"";}' +
    'function diffMatch(c,q){if(!q)return true;return ((c.id||"").toLowerCase().indexOf(q)>=0)||((c.message||"").toLowerCase().indexOf(q)>=0);}' +
    'function fillSelect(sel,chosen,filterId){var q=diffFilterText(filterId);sel.innerHTML="";var list=commitList();for(var i=0;i<list.length;i++){var c=list[i];' +
    'if(!diffMatch(c,q))continue;' +
    'var op=document.createElement("option");op.value=c.id;op.textContent=c.id+" — "+(c.message||"");if(c.id===chosen)op.selected=true;sel.appendChild(op);}}' +
    'function refillDiffA(){fillSelect(el("dA"),el("dA").value,"dFilterA");}' +
    'function refillDiffB(){fillSelect(el("dB"),el("dB").value,"dFilterB");}' +
    'function selParent(){var n=SEL?nodeMap()[SEL]:null;return n?n.parent:null;}' +
    'function diffDefB(){return SEL||(DATA&&DATA.working)||(commitList()[0]&&commitList()[0].id)||"";}' +
    'function diffDefA(){return selParent()||diffDefB();}' +
    'function renderDiffSelectors(){fillSelect(el("dA"),diffDefA(),"dFilterA");fillSelect(el("dB"),diffDefB(),"dFilterB");}' +
    'function renderPanelSel(){el("selInfo").textContent=SEL?("選択: "+SEL):"（行をクリックして選択）";' +
    'if(el("dA"))el("dA").value=diffDefA();if(el("dB"))el("dB").value=diffDefB();' +
    'var has=!!SEL;el("opGoto").disabled=!has;el("opMerge").disabled=!has;el("opBmSet").disabled=!has;}' +
    'function renderToolbar(){var dc=(DATA&&DATA.disconnected)||{total:0,orphans:0,broken:0};var gb=el("bGc");' +
    'if(dc.total>0){gb.style.display="";gb.textContent="掃除 ("+dc.total+")";gb.title="繋がりのなくなったコミット "+dc.total+" 件（孤立 "+dc.orphans+" / 壊れ "+dc.broken+"）を削除";}else{gb.style.display="none";}' +
    'el("broken").textContent=(DATA&&DATA.workingBroken)?"現在地 @ の内容を復元できません（壊れています）。メニューの「修復」で立て直してください。":"";' +
    'el("bGraph").disabled=(VIEW==="graph")||LINEAR;el("bFlat").disabled=(VIEW==="flat")||LINEAR;el("linear").checked=LINEAR;}' +
    'function renderAll(){renderHeader();renderToolbar();renderBookmarks();renderStashes();renderDiffSelectors();renderList();renderPanelSel();}' +
    'function refresh(){google.script.run.withSuccessHandler(function(d){DATA=d;if(SEL&&!nodeMap()[SEL])SEL=null;renderAll();}).withFailureHandler(onErr).Ggit_uiGraphData();}' +
    'function selectCommit(id){SEL=(SEL===id)?null:id;renderList();renderPanelSel();}' +
    'function setView(v){if(LINEAR)return;VIEW=v;renderToolbar();renderList();}' +
    'function toggleLinear(){LINEAR=el("linear").checked;renderToolbar();renderList();}' +
    'function goTo(){if(!SEL){setStatus("行をクリックしてコミットを選択してください",true);return;}' +
    'if(!confirm("現在地 @ を "+SEL+" へ移動します。\\n現在の未コミット内容はスタッシュに退避されます。よろしいですか？"))return;' +
    'setStatus("移動中…");google.script.run.withSuccessHandler(function(r){setStatus("移動しました: "+r.commitId+(r.stashed?"（未コミット内容をスタッシュに退避）":""));refresh();}).withFailureHandler(onErr).Ggit_goto(SEL);}' +
    'function mergeInto(){if(!SEL){setStatus("行をクリックしてマージ元を選択してください",true);return;}' +
    'if(!confirm("選択コミット "+SEL+" を現在地 @ へ 3-way マージします。よろしいですか？"))return;' +
    'setStatus("マージ中…");google.script.run.withSuccessHandler(function(r){var m;' +
    'if(r.upToDate){m="既に取り込み済みです（変更なし）。";}' +
    'else if(r.fastForward){m="早送り（fast-forward）で取り込みました。"+(r.stashed?"（未コミット内容をスタッシュに退避）":"");}' +
    'else if(r.conflict){m="競合が発生しました。本文に <<<<<<< / ======= / >>>>>>> マーカーを書き戻しました。手動で解決後、commit してください。";}' +
    'else{m="クリーンにマージしました。マージコミット: "+r.commitId;}setStatus(m);refresh();}).withFailureHandler(onErr).Ggit_merge(SEL);}' +
    'function bmSet(){var n=el("bmName").value.trim();if(!n){setStatus("ブックマーク名を入力してください",true);return;}if(!SEL){setStatus("対象コミットを行から選択してください",true);return;}' +
    'google.script.run.withSuccessHandler(function(r){setStatus("ブックマーク「"+r.name+"」を "+r.commitId+" に設定しました。");el("bmName").value="";refresh();}).withFailureHandler(onErr).Ggit_bookmarkSet(n,SEL);}' +
    'function bmDelete(n){if(!confirm("ブックマーク「"+n+"」を削除します。よろしいですか？"))return;' +
    'google.script.run.withSuccessHandler(function(r){setStatus("ブックマーク「"+r.name+"」を削除しました。");refresh();}).withFailureHandler(onErr).Ggit_bookmarkDelete(n);}' +
    'function runDiff(){var a=el("dA").value,b=el("dB").value;if(!a||!b){setStatus("差分対象を選んでください",true);return;}' +
    'var o=el("diffOut");o.textContent="計算中…";google.script.run.withSuccessHandler(function(h){o.innerHTML=h;}).withFailureHandler(function(e){o.textContent=e.message;}).Ggit_diffCommitsHtml(a,b);}' +
    'function popStash(id){if(!confirm("スタッシュ "+id+" の内容を現在のタブに戻し、このスタッシュを消します。よろしいですか？"))return;' +
    'setStatus("適用中…");google.script.run.withSuccessHandler(function(r){setStatus("スタッシュを戻して消しました"+(r.stashed?"（直前の内容を退避）":""));refresh();}).withFailureHandler(onErr).Ggit_popStash(id);}' +
    'function dropStash(id){if(!confirm("スタッシュ "+id+" を破棄します。元に戻せません。よろしいですか？"))return;' +
    'google.script.run.withSuccessHandler(function(){setStatus("スタッシュを破棄しました");refresh();}).withFailureHandler(onErr).Ggit_dropStash(id);}' +
    'function abandon(id,hasStash){var m=hasStash?("コミット "+id+" には未コミット内容のスタッシュが付いています。\\n枝を破棄すると、その付随スタッシュも一緒に破棄されます（元に戻せません）。よろしいですか？"):("コミット "+id+" の枝を破棄します（葉から分岐元まで遡って削除）。\\n現在地 @ ・ブックマーク先・他の枝が乗る地点は残します。元に戻せません。よろしいですか？");if(!confirm(m))return;' +
    'setStatus("破棄中…");google.script.run.withSuccessHandler(function(r){setStatus("破棄しました: "+r.removed+" 件削除"+(r.droppedStashes?("（スタッシュ "+r.droppedStashes+" 件も破棄）"):""));refresh();}).withFailureHandler(onErr).Ggit_abandonCommit(id);}' +
    'function gc(){var dc=(DATA&&DATA.disconnected)||{total:0,orphans:0,broken:0};if(!dc.total)return;' +
    'if(!confirm("繋がりのなくなったコミット "+dc.total+" 件（孤立 "+dc.orphans+" / 壊れ "+dc.broken+"）を削除します。\\n現在地 @ は残します。元に戻せません。よろしいですか？"))return;' +
    'setStatus("掃除中…");google.script.run.withSuccessHandler(function(r){setStatus("掃除しました: "+r.removed+" 件削除（孤立 "+r.orphans+" / 壊れ "+r.broken+"）"+(r.workingBroken?" ※現在地 @ が壊れています。修復してください。":""));refresh();}).withFailureHandler(onErr).Ggit_gcDisconnected();}' +
    'el("bGraph").addEventListener("click",function(){setView("graph");});' +
    'el("bFlat").addEventListener("click",function(){setView("flat");});' +
    'el("linear").addEventListener("change",toggleLinear);' +
    'el("bGc").addEventListener("click",gc);' +
    'el("opGoto").addEventListener("click",goTo);' +
    'el("opMerge").addEventListener("click",mergeInto);' +
    'el("opBmSet").addEventListener("click",bmSet);' +
    'el("opDiff").addEventListener("click",runDiff);' +
    'el("dFilterA").addEventListener("input",refillDiffA);' +
    'el("dFilterB").addEventListener("input",refillDiffB);' +
    'el("list").addEventListener("click",function(e){var b=e.target.closest("button[data-act]");' +
    'if(b){if(b.getAttribute("data-act")==="abandon")abandon(b.getAttribute("data-id"),b.getAttribute("data-hasstash")==="1");return;}' +
    'var row=e.target.closest("tr[data-id]");if(row)selectCommit(row.getAttribute("data-id"));});' +
    'el("stashes").addEventListener("click",function(e){var b=e.target.closest("button[data-act]");if(!b)return;' +
    'var a=b.getAttribute("data-act");if(a==="pop")popStash(b.getAttribute("data-id"));else if(a==="drop")dropStash(b.getAttribute("data-id"));});' +
    'el("bmList").addEventListener("click",function(e){var b=e.target.closest("button[data-act]");if(b&&b.getAttribute("data-act")==="bmdel")bmDelete(b.getAttribute("data-name"));});' +
    'refresh();' +
    '</script>';

  Ggit_showModal('<div class="gg">' + style + body + script + '</div>', 'ggit log（操作ハブ）', 780, 680);
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
    '1枚の作業タブの中で commit / log（グラフ）/ diff / bookmark / goto / merge を提供します。' +
    '<b>diff・bookmark・merge・移動(goto) は Log（グラフ）画面に統合</b>され、行を選択してその場で実行できます。<br><br>' +
    '<b>Jujutsu 流モデル</b>: 現在地 <code>@</code> はコミットID（匿名ヘッド）。commit は <code>@</code> を' +
    '前進させますが、<b>ブックマークは手動で set/move したときだけ動きます</b>。Log はブランチ（分岐）を' +
    '意識した ASCII レーングラフで表示し、フラット表示・直線表示（選択地点→ルート）にも切替できます。<br><br>' +
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
  Ggit_showModal(html, 'About ggit', 520, 340);
}
