import { db, ref, onValue, push, set, $, esc, won, toast, copyText, configured, setupWarning, menuArray, categories, sumItems } from "./common.js";

const app = $("#app");
if (!configured) { setupWarning(app); throw new Error("firebase-config.js 미설정"); }

const ls = {
  get(k) { try { return localStorage.getItem("pub_" + k) || ""; } catch { return ""; } },
  set(k, v) { try { localStorage.setItem("pub_" + k, v); } catch {} },
};
const P = new URLSearchParams(location.search);
const st = {
  menu: [], cfg: { pub: "경영상회", tables: 12 }, cart: {},
  table: P.get("t") || ls.get("table"), nick: ls.get("nick"),
  order: null, stat: null, sending: false, loaded: false,
};
try { st.order = JSON.parse(ls.get("order") || "null"); } catch {}
let unsubStatus = null;

function watchStatus() {
  if (unsubStatus) { unsubStatus(); unsubStatus = null; }
  st.stat = null;
  if (!st.order) return;
  unsubStatus = onValue(ref(db, "status/" + st.order.id), (s) => { st.stat = s.val(); render(); });
}

onValue(ref(db, "settings"), (s) => { st.cfg = { pub: "경영상회", tables: 12, ...(s.val() || {}) }; render(); });
onValue(ref(db, "menu"), (s) => { st.menu = menuArray(s.val()); st.loaded = true; render(); },
  () => { st.loaded = true; render(); });
watchStatus();

const lines = () => st.menu.filter((m) => !m.soldout && st.cart[m.id] > 0).map((m) => ({ id: m.id, name: m.name, price: m.price, qty: st.cart[m.id] }));

function tableOptions() {
  let o = '<option value="">선택</option>';
  for (let i = 1; i <= (st.cfg.tables || 0); i++) o += `<option value="${i}"${String(st.table) === String(i) ? " selected" : ""}>${i}번 테이블</option>`;
  return o + `<option value="포장"${st.table === "포장" ? " selected" : ""}>포장</option>`;
}

function menuView() {
  const l = lines(), n = l.reduce((a, x) => a + x.qty, 0);
  let h = `<header class="hero"><span class="sticker">QR 주문</span><h1>${esc(st.cfg.pub)}</h1><p>메뉴를 담고 주문하면 송금 안내가 나와요. 송금하면 직원이 확인하고 주방으로 넘겨요.</p></header>
  <div class="who"><label class="fld"><span>테이블</span><select id="f-table" data-f="table">${tableOptions()}</select></label>
  <label class="fld"><span>입금자명 (송금할 때 쓰는 이름)</span><input id="f-nick" data-f="nick" value="${esc(st.nick)}" maxlength="12" placeholder="예: 김성곤" autocomplete="off"></label></div>`;
  if (!st.loaded) h += '<p class="note" style="margin-top:20px">메뉴를 불러오는 중이에요…</p>';
  else if (!st.menu.length) h += '<p class="warn" style="margin-top:20px">아직 등록된 메뉴가 없어요.</p>';
  h += categories(st.menu).map((c) => `<section class="cat"><h2>${esc(c)}</h2><ul class="items">` +
    st.menu.filter((m) => (m.cat || "기타") === c).map((m) => {
      const q = st.cart[m.id] || 0;
      return `<li class="item${m.soldout ? " sold" : ""}"><div class="nm"><b>${esc(m.name)}</b><span class="pr">${won(m.price)}</span></div>` +
        (m.soldout ? '<span class="tag">품절</span>' :
          `<div class="step"><button data-act="dec" data-id="${esc(m.id)}" aria-label="${esc(m.name)} 하나 빼기"${q ? "" : " disabled"}>−</button><output>${q}</output><button data-act="inc" data-id="${esc(m.id)}" aria-label="${esc(m.name)} 하나 더">+</button></div>`) + "</li>";
    }).join("") + "</ul></section>").join("");
  h += `<div class="bar"><div><div class="tot"><small>${n ? n + "개 담음" : "메뉴를 담아 주세요"}</small><b>${won(sumItems(l))}</b></div><button class="btn" data-act="order"${n && !st.sending ? "" : " disabled"}>${st.sending ? "보내는 중…" : "주문하기"}</button></div></div>`;
  return h;
}

function orderView() {
  const o = st.order, s = st.stat && st.stat.s;
  // 조리 완료는 손님에게 알리지 않아요. 입금이 확인되면 "주방 접수"까지만 보여줘요.
  const accepted = s === "cooking" || s === "done";
  const stage = accepted ? 2 : 0;
  const names = ["입금 확인", "주방 접수"];
  const track = s === "cancelled" ? "" : `<div class="track" aria-label="진행 상황">${names.map((t, i) => `<span class="${i < stage ? "past" : i === stage ? "on" : ""}">${t}</span>`).join("")}</div>`;
  const msg = accepted ? `입금이 확인되어 주방에 접수됐어요.${st.stat.seq ? " 주문번호 " + st.stat.seq + "번" : ""}` :
    s === "cancelled" ? "주문이 취소됐어요. 카운터에 문의해 주세요." :
    "송금하면 직원이 입금을 확인해요. 확인되면 이 화면이 바뀌어요.";
  const c = st.cfg, hasAcct = c.bank && c.account;
  const toss = `supertoss://send?bank=${encodeURIComponent(c.bank || "")}&accountNo=${encodeURIComponent((c.account || "").replace(/[^0-9]/g, ""))}&origin=qr&amount=${o.total}`;
  let h = `<header class="hero"><span class="sticker">내 주문</span><h1>${esc(st.cfg.pub)}</h1></header>
  <div class="card slip"><div class="kv"><span>테이블</span><span>${esc(o.table)}${o.table === "포장" ? "" : "번"}</span></div><div class="kv"><span>입금자명</span><span>${esc(o.nick)}</span></div>
  <ul class="lines">${o.items.map((x) => `<li><span>${esc(x.name)} × ${x.qty}</span><span>${won(x.price * x.qty)}</span></li>`).join("")}</ul>
  <div class="kv"><span>합계</span><span class="total">${won(o.total)}</span></div></div>
  <div class="card" style="margin-top:12px">${track}<p>${esc(msg)}</p></div>`;
  if (!s) {
    h += `<ol class="steps card" style="margin-top:12px"><li><div><b>아래 계좌로 ${won(o.total)} 송금</b>` +
      (hasAcct ? `<div class="kv"><span>${esc(c.bank)}</span><span style="font-family:var(--f-mono)">${esc(c.account)}</span></div><div class="kv"><span>예금주</span><span>${esc(c.holder || "")}</span></div>
      <div class="row"><button class="btn sm" data-act="copy" data-t="${esc(c.account)}" data-l="계좌번호 복사">계좌번호 복사</button><button class="btn sm alt" data-act="copy" data-t="${o.total}" data-l="금액 복사">금액 복사</button><a class="btn sm alt" href="${esc(toss)}">토스로 열기</a></div>
      <p class="note">토스 버튼은 앱이 설치된 폰에서만 열려요. 안 열리면 계좌번호를 복사해서 쓰세요. 송금할 때 받는 사람 메모에 입금자명을 적어 주세요.</p>` :
        '<p class="warn">계좌 정보가 아직 등록되지 않았어요. 직원에게 문의해 주세요.</p>') + "</div></li>" +
      '<li><div><b>기다리기</b><p class="note">직원이 입금을 확인하면 주방으로 넘어가요. 이 화면을 닫지 않아도, 다시 열면 내 주문이 그대로 있어요.</p></div></li></ol>';
  }
  h += `<div class="row" style="margin-top:12px"><button class="btn alt" data-act="newOrder">${s === "cancelled" ? "새 주문 하기" : "추가 주문 하기"}</button></div>`;
  return h;
}

function render() {
  const y = window.scrollY;
  app.innerHTML = st.order ? orderView() : menuView();
  window.scrollTo(0, y);
}

app.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id;
  if (a === "inc" || a === "dec") { st.cart[id] = Math.max(0, (st.cart[id] || 0) + (a === "inc" ? 1 : -1)); render(); }
  else if (a === "copy") copyText(b.dataset.t, b.dataset.l);
  else if (a === "newOrder") { st.order = null; st.stat = null; st.cart = {}; ls.set("order", ""); watchStatus(); render(); }
  else if (a === "order") {
    const l = lines();
    if (!l.length || st.sending) return;
    if (!st.table) return toast("테이블을 선택해 주세요");
    if (!st.nick.trim()) return toast("입금자명을 적어 주세요");
    st.sending = true; render();
    const r = push(ref(db, "orders"));
    const o = { table: String(st.table), nick: st.nick.trim(), items: l, total: sumItems(l), status: "unpaid", createdAt: Date.now() };
    try {
      await set(r, o);
      st.order = { id: r.key, ...o }; ls.set("order", JSON.stringify(st.order)); st.cart = {};
      watchStatus();
      window.scrollTo(0, 0);
    } catch { toast("주문을 보내지 못했어요. 인터넷을 확인하고 다시 눌러 주세요"); }
    st.sending = false; render();
  }
});
function onField(e) {
  const f = e.target.dataset && e.target.dataset.f; if (!f) return;
  if (f === "table") { st.table = e.target.value; ls.set("table", st.table); }
  if (f === "nick") { st.nick = e.target.value; ls.set("nick", st.nick); }
}
app.addEventListener("input", onField);
app.addEventListener("change", onField);
render();
