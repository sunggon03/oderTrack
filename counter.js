import { TABLE_PENDING, tableText, peopleText, db, auth, ref, onValue, update, runTransaction, serverTimestamp, serverNow, signOut, needLogin, $, esc, won, hhmm, toast, beep, clone, configured, setupWarning, menuArray, sumItems, ordersArray, watchConnection, keepAwake, DEFAULT_MENU, RULES_OLD_WARNING } from "./common.js?v=6";

const app = $("#app");
if (!configured) { setupWarning(app); throw new Error("firebase-config.js 미설정"); }

const UNPAID_WARN_MIN = 5; // 입금 대기가 이 시간(분)을 넘으면 빨갛게 경고해요. 숫자만 바꾸면 돼요.

const st = { orders: [], menu: [], cfg: { pub: "경영상회", tables: 12, bank: "", account: "", holder: "" }, tab: "pay", draft: null, qrBase: "", confirmWipe: false, loaded: false, menuLoaded: false, cfgLoaded: false, err: "", rulesOld: false };
// 주소가 .../counter 로 열려도(.html 없이) 손님 페이지 주소가 맞게 나오도록 해요.
st.qrBase = new URL("index.html", location.href).href.split(/[?#]/)[0];

// 입금 확인 전에 직원이 입력 중인 테이블 번호(주문 id별). 화면이 다시 그려져도 지워지지 않게 따로 보관해요.
const tblInput = {};
const tableValue = (o) => (tblInput[o.id] ?? (o.table && o.table !== TABLE_PENDING ? o.table : "")).trim();
const minsWaiting = (o) => Math.max(0, Math.floor((serverNow() - o.createdAt) / 60000));
const isLate = (o) => o.status === "unpaid" && minsWaiting(o) >= UNPAID_WARN_MIN;

// 손님이 보낸 가격이 아니라 지금 메뉴 가격으로 받을 금액을 다시 계산해요.
function trusted(o) {
  const byId = Object.fromEntries(st.menu.map((m) => [m.id, m]));
  let t = 0, known = true;
  o.items.forEach((x) => { const m = byId[x.id]; if (m) t += m.price * x.qty; else { known = false; t += x.price * x.qty; } });
  return { amount: t, known, mismatch: t !== sumItems(o.items) || t !== o.total };
}
function itemsHtml(items) { return `<ul class="lines">${items.map((x) => `<li><span>${esc(x.name)} × ${esc(x.qty)}</span><span>${won(x.price * x.qty)}</span></li>`).join("")}</ul>`; }

function payCard(o) {
  const t = trusted(o), mins = minsWaiting(o), late = mins >= UNPAID_WARN_MIN;
  return `<article class="card ord unpaid${late ? " late" : ""}"><div class="hd"><span class="who2">입금자명 <b>${esc(o.nick)}</b>${peopleText(o.people) ? " · " + esc(peopleText(o.people)) : ""}</span><span class="meta">${hhmm(o.createdAt)} · ${mins}분 전</span></div>
  <div class="amount">${won(t.amount)}</div>${itemsHtml(o.items)}
  ${late ? `<p class="warn"><b>${mins}분째 입금 확인이 안 됐어요.</b> 은행 알림을 다시 보고, 입금이 없으면 테이블에 확인한 뒤 취소하세요.</p>` : ""}
  ${t.mismatch ? '<p class="warn">손님 화면의 금액과 현재 메뉴 가격이 달라요. 위 금액(현재 메뉴 가격)으로 확인하세요.</p>' : ""}
  <label class="fld tblf"><span>테이블 번호 <em>(입금 확인할 때 꼭 입력)</em></span><input id="tb-${esc(o.id)}" data-f="tbl" data-id="${esc(o.id)}" value="${esc(tableValue(o))}" maxlength="10" autocomplete="off" enterkeyhint="done" placeholder="예: 3, 포장"></label>
  <div class="row"><button class="btn ok" data-act="confirm" data-id="${esc(o.id)}">입금 확인 → 주방으로</button><button class="btn ghost sm" data-act="cancel" data-id="${esc(o.id)}">취소</button></div></article>`;
}
function otherCard(o) {
  const lab = { cooking: "조리중", done: "완료", cancelled: "취소" }[o.status] || o.status;
  const back = o.status === "cancelled" ? '<button class="btn ghost sm" data-act="restore" data-id="' + esc(o.id) + '">복구</button>' :
    '<button class="btn ghost sm" data-act="unpay" data-id="' + esc(o.id) + '">입금 대기로 되돌리기</button>';
  return `<article class="card ord ${esc(o.status)}"><div class="hd"><span class="no">${esc(o.seq ?? "-")}</span><span class="who2">${esc(tableText(o.table))} · ${esc(o.nick)}${peopleText(o.people) ? " · " + esc(peopleText(o.people)) : ""}</span><span class="meta">${esc(lab)} · ${hhmm(o.createdAt)}</span></div>${itemsHtml(o.items)}<div class="kv"><span>합계</span><span>${won(trusted(o).amount)}</span></div><div class="row">${back}</div></article>`;
}

function payTab() {
  const un = st.orders.filter((o) => o.status === "unpaid").sort((a, b) => a.createdAt - b.createdAt);
  const cook = st.orders.filter((o) => o.status === "cooking").length;
  const late = un.filter(isLate).length;
  return `<div class="pills"><span class="pill${un.length ? " hot" : ""}">입금 대기 ${un.length}</span>${late ? `<span class="pill bad">${UNPAID_WARN_MIN}분 넘음 ${late}</span>` : ""}<span class="pill">조리중 ${cook}</span></div>
  <section class="sec"><h3>입금 대기 <em>은행 알림의 입금자명·금액과 맞는지 확인 후 눌러 주세요</em></h3>
  ${un.length ? `<div class="grid">${un.map(payCard).join("")}</div>` : `<p class="note">${st.loaded ? "대기 중인 주문이 없어요." : "불러오는 중…"}</p>`}</section>
  <p class="note" style="margin-top:18px">새 주문 알림음은 이 화면을 한 번 터치하면 켜져요. 같은 입금자명·금액의 주문이 여러 개면 시간 순서대로 확인하세요.</p>`;
}
function allTab() {
  const rest = st.orders.filter((o) => o.status !== "unpaid").sort((a, b) => b.createdAt - a.createdAt).slice(0, 60);
  return `<section class="sec"><h3>입금 확인된 주문과 취소 <em>최근 60건</em></h3>${rest.length ? `<div class="grid">${rest.map(otherCard).join("")}</div>` : '<p class="note">아직 없어요.</p>'}</section>`;
}
function menuTab() {
  // 불러오기 전에 편집 화면을 열면 빈 값으로 저장돼 계좌·메뉴가 지워질 수 있어서 기다려요.
  if (!st.menuLoaded || !st.cfgLoaded) return '<p class="note" style="margin-top:20px">메뉴와 가게 정보를 불러오는 중이에요…</p>';
  const d = st.draft || (st.draft = { cfg: clone(st.cfg), menu: clone(st.menu) });
  let h = `<div class="card"><b>가게 정보</b><div class="who"><label class="fld"><span>주점 이름</span><input id="s-pub" data-f="s:pub" value="${esc(d.cfg.pub)}" maxlength="20"></label></div>
  <div class="who"><label class="fld"><span>은행</span><input id="s-bank" data-f="s:bank" value="${esc(d.cfg.bank)}" placeholder="예: 카카오뱅크" maxlength="20"></label><label class="fld"><span>계좌번호</span><input id="s-acct" data-f="s:account" value="${esc(d.cfg.account)}" inputmode="numeric" maxlength="30"></label></div>
  <label class="fld"><span>예금주</span><input id="s-holder" data-f="s:holder" value="${esc(d.cfg.holder)}" maxlength="20"></label><p class="note">입력한 계좌는 손님 화면에 그대로 보여요.</p>
  <b style="margin-top:6px">송금 앱 링크 <span class="note">(선택)</span></b>
  <label class="fld"><span>토스 송금 링크</span><input id="s-toss" data-f="s:tossLink" value="${esc(d.cfg.tossLink)}" placeholder="https://toss.me/내토스아이디" maxlength="120" inputmode="url" autocapitalize="off"></label>
  <label class="fld"><span>카카오페이 송금 링크</span><input id="s-kakao" data-f="s:kakaoLink" value="${esc(d.cfg.kakaoLink)}" placeholder="https://qr.kakaopay.com/..." maxlength="120" inputmode="url" autocapitalize="off"></label>
  <p class="note">비워 두면 버튼이 안 나오고 계좌 복사만 쓰여요. 링크는 계좌 주인이 토스·카카오페이 앱에서 만든 본인의 송금 링크만 넣으세요. 저장 전에 폰에서 직접 눌러 열리는지 꼭 확인해 주세요.</p></div>
  <section class="sec"><h3>메뉴 <em>품절 체크는 바로 반영되고, 나머지는 저장을 눌러야 반영돼요</em></h3>`;
  if (!d.menu.length) h += '<button class="btn alt" data-act="seed">예시 메뉴 넣기</button>';
  h += d.menu.map((m, i) => `<div class="card"><div class="mrow"><label class="fld"><span>분류</span><input id="m-cat-${i}" data-f="m:cat" data-i="${i}" value="${esc(m.cat)}" maxlength="20"></label><label class="fld nmf"><span>메뉴 이름</span><input id="m-name-${i}" data-f="m:name" data-i="${i}" value="${esc(m.name)}" maxlength="40"></label><label class="fld"><span>가격(원)</span><input id="m-price-${i}" type="number" min="0" max="500000" step="500" data-f="m:price" data-i="${i}" value="${esc(m.price)}"></label>
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
  let h = `<div class="card"><b>손님 주문 QR</b><label class="fld"><span>손님 주문 페이지 주소</span><input id="q-url" data-f="qrurl" value="${esc(st.qrBase)}"></label><p class="note">GitHub Pages 주소가 자동으로 들어 있어요. 틀리면 고쳐 주세요. QR은 모든 테이블이 같은 것 하나를 써요. 손님은 테이블을 고르지 않고, 직원이 입금 확인할 때 테이블 번호를 입력해요. 화면을 인쇄하면 QR만 나와요.</p><button class="btn sm alt noprint" style="align-self:flex-start" data-act="print">인쇄</button></div>`;
  if (!ok) return h + '<p class="warn" style="margin-top:12px">QR 도구를 불러오지 못했어요. 인터넷을 확인해 주세요.</p>';
  const u = st.qrBase.trim().split("?")[0];
  if (!/^https?:\/\//.test(u)) return h;
  return h + `<div class="sec"><div class="qrs one"><div class="qr"><div class="box">${qrSvg(u)}</div>손님 주문 QR</div></div></div>`;
}
function sumTab() {
  const paid = st.orders.filter((o) => o.status === "cooking" || o.status === "done");
  const rev = paid.reduce((a, o) => a + trusted(o).amount, 0), per = {};
  paid.forEach((o) => o.items.forEach((x) => { per[x.name] = (per[x.name] || 0) + x.qty; }));
  const keys = Object.keys(per).sort((a, b) => per[b] - per[a]);
  return `<div class="card"><b>정산 <span class="note">(입금 확인된 주문 기준)</span></b><div class="kv"><span>매출 합계</span><span class="total">${won(rev)}</span></div><div class="kv"><span>주문 수</span><span>${paid.length}건</span></div>
  ${keys.length ? `<ul class="lines">${keys.map((k) => `<li><span>${esc(k)}</span><span>${per[k]}개</span></li>`).join("")}</ul>` : ""}</div>
  <div class="card" style="margin-top:14px"><b>새 영업일 시작</b><p class="note">모든 주문과 주문번호를 지우고 1번부터 다시 시작해요. 정산을 끝낸 뒤에만 누르세요. 되돌릴 수 없어요. 손님 폰에 남아 있던 "내 주문" 화면도 함께 초기화돼요.</p>
  ${st.confirmWipe ? `<div class="row"><button class="btn danger" data-act="wipe">정말 ${st.orders.length}건 모두 지우기</button><button class="btn ghost" data-act="wipeNo">그만두기</button></div>` : '<button class="btn ghost" style="align-self:flex-start" data-act="wipeAsk">주문 모두 지우기</button>'}</div>`;
}

function render() {
  const tabs = [["pay", "입금 확인"], ["all", "전체 주문"], ["menu", "메뉴·계좌"], ["qr", "QR"], ["sum", "정산"]];
  const un = st.orders.filter((o) => o.status === "unpaid").length;
  let h = `<nav class="tabs" aria-label="카운터 메뉴">${tabs.map((t) => `<button data-act="tab" data-to="${t[0]}"${st.tab === t[0] ? ' aria-current="true"' : ""}>${t[1]}${t[0] === "pay" && un ? " (" + un + ")" : ""}</button>`).join("")}<span class="sp"></span><button data-act="logout">로그아웃</button></nav>`;
  if (st.rulesOld) h += RULES_OLD_WARNING;
  if (st.err) h += `<p class="warn">데이터를 불러오지 못했어요 (${esc(st.err)}). 새로고침하거나 다시 로그인해 주세요.</p>`;
  h += { pay: payTab, all: allTab, menu: menuTab, qr: qrTab, sum: sumTab }[st.tab]();
  // 테이블 번호를 입력하는 도중에 새 주문이 들어와 화면이 다시 그려져도 입력 칸이 풀리지 않게 해요.
  const ae = document.activeElement, fid = ae && ae.tagName === "INPUT" && app.contains(ae) ? ae.id : "", pos = fid ? ae.selectionStart : 0;
  const y = window.scrollY; app.innerHTML = h; window.scrollTo(0, y);
  const el = fid && document.getElementById(fid);
  if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(pos, pos); } catch {} }
}

// 같은 주문의 "입금 확인"을 두 번 누르면 주문번호가 두 개 나가서, 처리 중에는 다시 받지 않아요.
const busy = new Set();
async function confirmPay(id) {
  const o = st.orders.find((x) => x.id === id);
  if (!o || o.status !== "unpaid" || busy.has(id)) return;
  const table = tableValue(o);
  if (!table) { toast("테이블 번호를 먼저 입력해 주세요"); const el = document.getElementById("tb-" + id); if (el) el.focus(); return; }
  busy.add(id);
  try {
    const r = await runTransaction(ref(db, "meta/seq"), (v) => (Number(v) || 0) + 1);
    const seq = r.snapshot.val();
    await update(ref(db), { [`orders/${id}/status`]: "cooking", [`orders/${id}/table`]: table, [`orders/${id}/paidAt`]: serverTimestamp(), [`orders/${id}/seq`]: seq, [`status/${id}`]: { s: "cooking", seq } });
    delete tblInput[id];
    toast(seq + "번 주문을 주방으로 보냈어요 (" + tableText(table) + ")");
  } catch { toast("처리하지 못했어요. 다시 눌러 주세요"); }
  busy.delete(id);
}
async function setStatus(id, s, extra = {}) {
  const o = st.orders.find((x) => x.id === id); if (!o) return;
  const up = { [`orders/${id}/status`]: s };
  Object.entries(extra).forEach(([k, v]) => { up[`orders/${id}/${k}`] = v; });
  up[`status/${id}`] = s === "unpaid" ? null : { s, seq: o.seq ?? null };
  try { await update(ref(db), up); } catch { toast("바꾸지 못했어요. 다시 눌러 주세요"); }
}
// 송금 링크는 https이고 토스·카카오페이 주소일 때만 저장해요. 아니면 알리고 저장을 멈춰요.
function link(raw, hosts) {
  const t = String(raw || "").trim(); if (!t) return "";
  try { const u = new URL(t); if (u.protocol === "https:" && hosts.includes(u.hostname)) return u.href; } catch {}
  throw new Error("bad-link:" + hosts[0]);
}
async function save() {
  const d = st.draft;
  const menu = d.menu.filter((m) => String(m.name).trim());
  if (!menu.length) return toast("메뉴가 하나 이상 있어야 해요");
  const obj = {};
  menu.forEach((m, i) => { obj[m.id] = { cat: String(m.cat || "").trim().slice(0, 20) || "기타", name: String(m.name).trim().slice(0, 40), price: Math.max(0, Math.min(500000, parseInt(m.price) || 0)), soldout: !!m.soldout, order: i }; });
  // wipedAt(마지막으로 주문을 모두 지운 시각)은 손님 화면 초기화에 쓰여서 저장할 때 그대로 둬요.
  let cfg;
  try {
    cfg = { pub: String(d.cfg.pub || "").trim() || "경영상회", tables: Math.max(0, Math.min(99, parseInt(d.cfg.tables) || 0)), bank: String(d.cfg.bank || "").trim(), account: String(d.cfg.account || "").trim(), holder: String(d.cfg.holder || "").trim(), tossLink: link(d.cfg.tossLink, ["toss.me"]), kakaoLink: link(d.cfg.kakaoLink, ["qr.kakaopay.com"]), wipedAt: st.cfg.wipedAt ?? null };
  } catch (e) {
    return toast(String(e.message).startsWith("bad-link:") ? ("송금 링크 주소가 올바르지 않아요. " + (e.message.endsWith("toss.me") ? "토스는 https://toss.me/ 로 시작해야 해요." : "카카오페이는 https://qr.kakaopay.com/ 로 시작해야 해요.")) : "저장하지 못했어요");
  }
  try { await update(ref(db), { menu: obj, settings: cfg }); st.draft = null; toast("저장했어요"); render(); }
  catch { toast("저장하지 못했어요. 다시 눌러 주세요"); }
}
async function wipe() {
  // 주문을 하나씩 지정해서 지워요(통째로 지우는 방식은 보안 규칙에 따라 거부될 수 있어요).
  Object.keys(tblInput).forEach((k) => delete tblInput[k]);
  const up = { meta: null, "settings/wipedAt": serverTimestamp() };
  st.orders.forEach((o) => { up["orders/" + o.id] = null; up["status/" + o.id] = null; });
  try { await update(ref(db), up); toast("모두 지웠어요"); }
  catch (e) { toast("지우지 못했어요 (" + ((e && e.code) || "오류") + ")"); }
}

app.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id, i = +b.dataset.i;
  if (a === "tab") { st.tab = b.dataset.to; if (st.tab === "menu") st.draft = null; st.confirmWipe = false; render(); }
  else if (a === "logout") signOut(auth);
  else if (a === "confirm") confirmPay(id);
  else if (a === "cancel") setStatus(id, "cancelled");
  else if (a === "restore" || a === "unpay") setStatus(id, "unpaid", { paidAt: null, seq: null, doneAt: null });
  else if (a === "seed") { st.draft.menu = DEFAULT_MENU.map((m, k) => ({ ...m, soldout: false, order: k })); render(); }
  else if (a === "madd") { st.draft.menu.push({ id: "m" + Date.now().toString(36), cat: (st.draft.menu.at(-1) || {}).cat || "안주", name: "", price: 0, soldout: false }); render(); }
  else if (a === "mdel") { st.draft.menu.splice(i, 1); render(); }
  else if (a === "mup" || a === "mdn") { const m = st.draft.menu, j = a === "mup" ? i - 1 : i + 1; if (j >= 0 && j < m.length) { [m[i], m[j]] = [m[j], m[i]]; render(); } }
  else if (a === "save") save();
  else if (a === "print") window.print();
  else if (a === "wipeAsk") { st.confirmWipe = true; render(); }
  else if (a === "wipeNo") { st.confirmWipe = false; render(); }
  else if (a === "wipe") { await wipe(); st.confirmWipe = false; render(); }
});
async function onField(e) {
  const t = e.target, f = t.dataset && t.dataset.f; if (!f) return;
  if (f === "tbl") tblInput[t.dataset.id] = t.value;
  else if (f === "qrurl") { st.qrBase = t.value; if (e.type === "change") render(); }
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

needLogin(app, (user, info) => {
  st.rulesOld = !!(info && info.rulesOld);
  let first = true;
  const warned = new Set(); // 이미 "N분 넘음" 경고음을 낸 주문
  onValue(ref(db, "orders"), (snap) => {
    const next = ordersArray(snap.val());
    if (!first) {
      const had = new Set(st.orders.filter((o) => o.status === "unpaid").map((o) => o.id));
      if (next.some((o) => o.status === "unpaid" && !had.has(o.id))) beep();
    }
    first = false; st.orders = next; st.loaded = true; st.err = "";
    if (st.tab === "pay" || st.tab === "all" || st.tab === "sum") render();
  }, (err) => { st.err = err.code || "error"; render(); });
  onValue(ref(db, "menu"), (s) => { st.menu = menuArray(s.val()); const was = st.menuLoaded; st.menuLoaded = true; if (st.tab === "pay" || st.tab === "sum" || (st.tab === "menu" && !was)) render(); });
  onValue(ref(db, "settings"), (s) => { st.cfg = { ...st.cfg, ...(s.val() || {}) }; const was = st.cfgLoaded; st.cfgLoaded = true; if (st.tab === "qr" || (st.tab === "menu" && !was)) render(); });
  // 경과 시간 표시를 갱신하고, 입금 대기가 오래된 주문이 생기면 한 번 알려요.
  setInterval(() => {
    const fresh = st.orders.filter((o) => isLate(o) && !warned.has(o.id));
    fresh.forEach((o) => warned.add(o.id));
    if (fresh.length) beep(330, 2);
    if (st.tab === "pay") render();
  }, 20000);
  watchConnection({ staff: true, role: "counter" });
  keepAwake();
  render();
});
