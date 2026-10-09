import { db, auth, ref, onValue, update, set, remove, runTransaction, signOut, needLogin, $, esc, won, hhmm, toast, beep, clone, configured, setupWarning, menuArray, sumItems, DEFAULT_MENU } from "./common.js";

const app = $("#app");
if (!configured) { setupWarning(app); throw new Error("firebase-config.js 미설정"); }

const st = { orders: [], menu: [], cfg: { pub: "경영상회", tables: 12, bank: "", account: "", holder: "" }, tab: "pay", draft: null, qrBase: "", confirmWipe: false, loaded: false, err: "" };
st.qrBase = location.origin + location.pathname.replace(/counter\.html$/, "index.html");

// 손님이 보낸 가격이 아니라 지금 메뉴 가격으로 받을 금액을 다시 계산해요.
function trusted(o) {
  const byId = Object.fromEntries(st.menu.map((m) => [m.id, m]));
  let t = 0, known = true;
  (o.items || []).forEach((x) => { const m = byId[x.id]; if (m) t += m.price * x.qty; else { known = false; t += x.price * x.qty; } });
  return { amount: t, known, mismatch: t !== sumItems(o.items) || t !== o.total };
}
function itemsHtml(items) { return `<ul class="lines">${(items || []).map((x) => `<li><span>${esc(x.name)} × ${x.qty}</span><span>${won(x.price * x.qty)}</span></li>`).join("")}</ul>`; }

function payCard(o) {
  const t = trusted(o);
  return `<article class="card ord unpaid"><div class="hd"><span class="who2">${esc(o.table)}${o.table === "포장" ? "" : "번"} · 입금자명 <b>${esc(o.nick)}</b></span><span class="meta">${hhmm(o.createdAt)}</span></div>
  <div class="amount">${won(t.amount)}</div>${itemsHtml(o.items)}
  ${t.mismatch ? '<p class="warn">손님 화면의 금액과 현재 메뉴 가격이 달라요. 위 금액(현재 메뉴 가격)으로 확인하세요.</p>' : ""}
  <div class="row"><button class="btn ok" data-act="confirm" data-id="${esc(o.id)}">입금 확인 → 주방으로</button><button class="btn ghost sm" data-act="cancel" data-id="${esc(o.id)}">취소</button></div></article>`;
}
function otherCard(o) {
  const lab = { cooking: "조리중", done: "완료", cancelled: "취소" }[o.status] || o.status;
  const back = o.status === "cancelled" ? '<button class="btn ghost sm" data-act="restore" data-id="' + esc(o.id) + '">복구</button>' :
    '<button class="btn ghost sm" data-act="unpay" data-id="' + esc(o.id) + '">입금 대기로 되돌리기</button>';
  return `<article class="card ord ${esc(o.status)}"><div class="hd"><span class="no">${esc(o.seq ?? "-")}</span><span class="who2">${esc(o.table)}${o.table === "포장" ? "" : "번"} · ${esc(o.nick)}</span><span class="meta">${lab} · ${hhmm(o.createdAt)}</span></div>${itemsHtml(o.items)}<div class="kv"><span>합계</span><span>${won(trusted(o).amount)}</span></div><div class="row">${back}</div></article>`;
}

function payTab() {
  const un = st.orders.filter((o) => o.status === "unpaid").sort((a, b) => a.createdAt - b.createdAt);
  const cook = st.orders.filter((o) => o.status === "cooking").length;
  return `<div class="pills"><span class="pill${un.length ? " hot" : ""}">입금 대기 ${un.length}</span><span class="pill">조리중 ${cook}</span></div>
  <section class="sec"><h3>입금 대기 <em>은행 알림의 입금자명·금액과 맞는지 확인 후 눌러 주세요</em></h3>
  ${un.length ? `<div class="grid">${un.map(payCard).join("")}</div>` : `<p class="note">${st.loaded ? "대기 중인 주문이 없어요." : "불러오는 중…"}</p>`}</section>
  <p class="note" style="margin-top:18px">새 주문 알림음은 이 화면을 한 번 터치하면 켜져요. 같은 입금자명·금액의 주문이 여러 개면 시간 순서대로 확인하세요.</p>`;
}
function allTab() {
  const rest = st.orders.filter((o) => o.status !== "unpaid").sort((a, b) => b.createdAt - a.createdAt).slice(0, 60);
  return `<section class="sec"><h3>입금 확인된 주문과 취소 <em>최근 60건</em></h3>${rest.length ? `<div class="grid">${rest.map(otherCard).join("")}</div>` : '<p class="note">아직 없어요.</p>'}</section>`;
}
function menuTab() {
  const d = st.draft || (st.draft = { cfg: clone(st.cfg), menu: clone(st.menu) });
  let h = `<div class="card"><b>가게 정보</b><div class="who"><label class="fld"><span>주점 이름</span><input id="s-pub" data-f="s:pub" value="${esc(d.cfg.pub)}"></label><label class="fld"><span>테이블 수</span><input id="s-tables" type="number" min="0" max="99" data-f="s:tables" value="${esc(d.cfg.tables)}"></label></div>
  <div class="who"><label class="fld"><span>은행</span><input id="s-bank" data-f="s:bank" value="${esc(d.cfg.bank)}" placeholder="예: 카카오뱅크"></label><label class="fld"><span>계좌번호</span><input id="s-acct" data-f="s:account" value="${esc(d.cfg.account)}" inputmode="numeric"></label></div>
  <label class="fld"><span>예금주</span><input id="s-holder" data-f="s:holder" value="${esc(d.cfg.holder)}"></label><p class="note">입력한 계좌는 손님 화면에 그대로 보여요.</p></div>
  <section class="sec"><h3>메뉴 <em>품절 체크는 바로 반영되고, 나머지는 저장을 눌러야 반영돼요</em></h3>`;
  if (!d.menu.length) h += '<button class="btn alt" data-act="seed">예시 메뉴 넣기</button>';
  h += d.menu.map((m, i) => `<div class="card"><div class="mrow"><label class="fld"><span>분류</span><input id="m-cat-${i}" data-f="m:cat" data-i="${i}" value="${esc(m.cat)}"></label><label class="fld nmf"><span>메뉴 이름</span><input id="m-name-${i}" data-f="m:name" data-i="${i}" value="${esc(m.name)}"></label><label class="fld"><span>가격(원)</span><input id="m-price-${i}" type="number" min="0" step="500" data-f="m:price" data-i="${i}" value="${esc(m.price)}"></label>
    <div class="acts"><label class="chk"><input id="m-sold-${i}" type="checkbox" data-f="m:soldout" data-i="${i}"${m.soldout ? " checked" : ""}> 품절</label><button class="btn ghost sm" data-act="mup" data-i="${i}" aria-label="위로">↑</button><button class="btn ghost sm" data-act="mdn" data-i="${i}" aria-label="아래로">↓</button><button class="btn ghost sm" data-act="mdel" data-i="${i}" style="color:var(--bad)">삭제</button></div></div></div>`).join("");
  h += `<div class="row"><button class="btn alt" data-act="madd">+ 메뉴 추가</button></div></section>
  <div class="bar"><div><div class="tot"><small>저장하면 손님 화면이 바로 바뀌어요</small></div><button class="btn" data-act="save">저장</button></div></div>`;
  return h;
}
function qrSvg(url) {
  try { const q = qrcode(0, "M"); q.addData(url); q.make(); return q.createSvgTag(4, 0); } catch { return ""; }
}
function qrTab() {
  const ok = typeof qrcode === "function";
  let h = `<div class="card"><b>테이블별 QR</b><label class="fld"><span>손님 주문 페이지 주소</span><input id="q-url" data-f="qrurl" value="${esc(st.qrBase)}"></label><p class="note">GitHub Pages 주소가 자동으로 들어 있어요. 틀리면 고쳐 주세요. 화면을 인쇄하면 QR만 나와요.</p><button class="btn sm alt noprint" style="align-self:flex-start" data-act="print">인쇄</button></div>`;
  if (!ok) return h + '<p class="warn" style="margin-top:12px">QR 도구를 불러오지 못했어요. 인터넷을 확인해 주세요.</p>';
  const u = st.qrBase.trim().split("?")[0];
  if (!/^https?:\/\//.test(u)) return h;
  h += `<div class="sec"><div class="qrs"><div class="qr"><div class="box">${qrSvg(u)}</div>공통</div>`;
  for (let i = 1; i <= (st.cfg.tables || 0); i++) h += `<div class="qr"><div class="box">${qrSvg(u + "?t=" + i)}</div>${i}번 테이블</div>`;
  return h + "</div></div>";
}
function sumTab() {
  const paid = st.orders.filter((o) => o.status === "cooking" || o.status === "done");
  const rev = paid.reduce((a, o) => a + trusted(o).amount, 0), per = {};
  paid.forEach((o) => (o.items || []).forEach((x) => { per[x.name] = (per[x.name] || 0) + x.qty; }));
  const keys = Object.keys(per).sort((a, b) => per[b] - per[a]);
  return `<div class="card"><b>정산 <span class="note">(입금 확인된 주문 기준)</span></b><div class="kv"><span>매출 합계</span><span class="total">${won(rev)}</span></div><div class="kv"><span>주문 수</span><span>${paid.length}건</span></div>
  ${keys.length ? `<ul class="lines">${keys.map((k) => `<li><span>${esc(k)}</span><span>${per[k]}개</span></li>`).join("")}</ul>` : ""}</div>
  <div class="card" style="margin-top:14px"><b>새 영업일 시작</b><p class="note">모든 주문과 주문번호를 지우고 1번부터 다시 시작해요. 정산을 끝낸 뒤에만 누르세요. 되돌릴 수 없어요.</p>
  ${st.confirmWipe ? '<div class="row"><button class="btn danger" data-act="wipe">정말 모두 지우기</button><button class="btn ghost" data-act="wipeNo">그만두기</button></div>' : '<button class="btn ghost" style="align-self:flex-start" data-act="wipeAsk">주문 모두 지우기</button>'}</div>`;
}

function render() {
  const tabs = [["pay", "입금 확인"], ["all", "전체 주문"], ["menu", "메뉴·계좌"], ["qr", "QR"], ["sum", "정산"]];
  const un = st.orders.filter((o) => o.status === "unpaid").length;
  let h = `<nav class="tabs" aria-label="카운터 메뉴">${tabs.map((t) => `<button data-act="tab" data-to="${t[0]}"${st.tab === t[0] ? ' aria-current="true"' : ""}>${t[1]}${t[0] === "pay" && un ? " (" + un + ")" : ""}</button>`).join("")}<span class="sp"></span><button data-act="logout">로그아웃</button></nav>`;
  if (st.err) h += `<p class="warn">데이터를 불러오지 못했어요 (${esc(st.err)}). 새로고침하거나 다시 로그인해 주세요.</p>`;
  h += { pay: payTab, all: allTab, menu: menuTab, qr: qrTab, sum: sumTab }[st.tab]();
  const y = window.scrollY; app.innerHTML = h; window.scrollTo(0, y);
}

async function confirmPay(id) {
  try {
    const r = await runTransaction(ref(db, "meta/seq"), (v) => (v || 0) + 1);
    const seq = r.snapshot.val();
    await update(ref(db), { [`orders/${id}/status`]: "cooking", [`orders/${id}/paidAt`]: Date.now(), [`orders/${id}/seq`]: seq, [`status/${id}`]: { s: "cooking", seq } });
    toast(seq + "번 주문을 주방으로 보냈어요");
  } catch { toast("처리하지 못했어요. 다시 눌러 주세요"); }
}
async function setStatus(id, s, extra = {}) {
  const o = st.orders.find((x) => x.id === id); if (!o) return;
  const up = { [`orders/${id}/status`]: s };
  Object.entries(extra).forEach(([k, v]) => { up[`orders/${id}/${k}`] = v; });
  up[`status/${id}`] = s === "unpaid" ? null : { s, seq: o.seq ?? null };
  try { await update(ref(db), up); } catch { toast("바꾸지 못했어요. 다시 눌러 주세요"); }
}
async function save() {
  const d = st.draft;
  const menu = d.menu.filter((m) => String(m.name).trim());
  if (!menu.length) return toast("메뉴가 하나 이상 있어야 해요");
  const obj = {};
  menu.forEach((m, i) => { obj[m.id] = { cat: String(m.cat || "").trim() || "기타", name: String(m.name).trim(), price: Math.max(0, parseInt(m.price) || 0), soldout: !!m.soldout, order: i }; });
  const cfg = { pub: String(d.cfg.pub || "").trim() || "경영상회", tables: Math.max(0, Math.min(99, parseInt(d.cfg.tables) || 0)), bank: String(d.cfg.bank || "").trim(), account: String(d.cfg.account || "").trim(), holder: String(d.cfg.holder || "").trim() };
  try { await update(ref(db), { menu: obj, settings: cfg }); st.draft = null; toast("저장했어요"); render(); }
  catch { toast("저장하지 못했어요. 다시 눌러 주세요"); }
}

app.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id, i = +b.dataset.i;
  if (a === "tab") { st.tab = b.dataset.to; if (st.tab === "menu") st.draft = null; st.confirmWipe = false; render(); }
  else if (a === "logout") signOut(auth);
  else if (a === "confirm") confirmPay(id);
  else if (a === "cancel") setStatus(id, "cancelled");
  else if (a === "restore" || a === "unpay") setStatus(id, "unpaid", { paidAt: null, seq: null });
  else if (a === "seed") { st.draft.menu = DEFAULT_MENU.map((m, k) => ({ ...m, soldout: false, order: k })); render(); }
  else if (a === "madd") { st.draft.menu.push({ id: "m" + Date.now().toString(36), cat: (st.draft.menu.at(-1) || {}).cat || "안주", name: "", price: 0, soldout: false }); render(); }
  else if (a === "mdel") { st.draft.menu.splice(i, 1); render(); }
  else if (a === "mup" || a === "mdn") { const m = st.draft.menu, j = a === "mup" ? i - 1 : i + 1; if (j >= 0 && j < m.length) { [m[i], m[j]] = [m[j], m[i]]; render(); } }
  else if (a === "save") save();
  else if (a === "print") window.print();
  else if (a === "wipeAsk") { st.confirmWipe = true; render(); }
  else if (a === "wipeNo") { st.confirmWipe = false; render(); }
  else if (a === "wipe") {
    try { await update(ref(db), { orders: null, status: null, meta: null }); toast("모두 지웠어요"); } catch { toast("지우지 못했어요"); }
    st.confirmWipe = false; render();
  }
});
async function onField(e) {
  const t = e.target, f = t.dataset && t.dataset.f; if (!f) return;
  if (f === "qrurl") { st.qrBase = t.value; if (e.type === "change") render(); }
  else if (f.startsWith("s:")) st.draft.cfg[f.slice(2)] = t.value;
  else if (f.startsWith("m:")) {
    const k = f.slice(2), m = st.draft.menu[+t.dataset.i];
    m[k] = k === "price" ? Math.max(0, parseInt(t.value) || 0) : k === "soldout" ? t.checked : t.value;
    // 품절은 바로 반영해요. 아직 저장 전인 새 메뉴는 저장할 때 같이 반영돼요.
    if (k === "soldout" && st.menu.some((x) => x.id === m.id)) {
      try { await update(ref(db, "menu/" + m.id), { soldout: m.soldout }); } catch { toast("품절 표시를 바꾸지 못했어요"); }
    }
  }
}
app.addEventListener("input", onField);
app.addEventListener("change", onField);

needLogin(app, () => {
  let first = true;
  onValue(ref(db, "orders"), (snap) => {
    const next = Object.entries(snap.val() || {}).map(([id, o]) => ({ id, ...o }));
    if (!first) {
      const had = new Set(st.orders.filter((o) => o.status === "unpaid").map((o) => o.id));
      if (next.some((o) => o.status === "unpaid" && !had.has(o.id))) beep();
    }
    first = false; st.orders = next; st.loaded = true; st.err = "";
    if (st.tab === "pay" || st.tab === "all" || st.tab === "sum") render();
  }, (err) => { st.err = err.code || "error"; render(); });
  onValue(ref(db, "menu"), (s) => { st.menu = menuArray(s.val()); if (st.tab === "pay" || st.tab === "sum") render(); });
  onValue(ref(db, "settings"), (s) => { st.cfg = { ...st.cfg, ...(s.val() || {}) }; });
  render();
});
