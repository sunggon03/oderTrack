import { TABLE_PENDING, tableText, peopleText, db, ref, onValue, push, set, goOffline, goOnline, serverTimestamp, serverNow, $, esc, won, toast, copyText, configured, setupWarning, menuArray, categories, sumItems, cleanItems, watchConnection } from "./common.js?v=8";

const app = $("#app");
if (!configured) { setupWarning(app); throw new Error("firebase-config.js 미설정"); }

const ORDER_KEEP_MS = 12 * 60 * 60 * 1000; // 이보다 오래된 "내 주문" 기록은 버려요
const SLOW_MS = 8000;                      // 주문 전송이 이보다 오래 걸리면 안내를 보여줘요
const MAX_TOTAL = 500000;                  // 보안 규칙의 한도와 같아야 해요

// 링크를 새로 열면 항상 빈 화면으로 시작해요: 이름·주문 기록은 이 탭에서만 기억하고(새로고침은 유지), 예전에 남은 기록은 지워요.
try { localStorage.removeItem("pub_nick"); localStorage.removeItem("pub_order"); } catch {}
const ls = {
  get(k) { try { return sessionStorage.getItem("pub_" + k) || ""; } catch { return ""; } },
  set(k, v) { try { sessionStorage.setItem("pub_" + k, v); } catch {} },
};
const st = {
  menu: [], cfg: { pub: "경영상회", tables: 12 }, cart: {},
  nick: ls.get("nick"), people: "",
  order: null, stat: null, sending: false, slow: false, notice: "", loaded: false, cfgLoaded: false,
};
try {
  const o = JSON.parse(ls.get("order") || "null");
  if (o && typeof o.id === "string" && Number.isFinite(o.total) && Number.isFinite(o.createdAt)) st.order = { ...o, items: cleanItems(o.items) };
} catch {}
let unsubStatus = null;

const accepted = () => { const s = st.stat && st.stat.s; return s === "cooking" || s === "done"; };

// 송금 링크는 직원이 카운터에 붙여 넣은 값이에요. 토스·카카오페이 주소만 허용하고, 그 밖의 주소나 scheme은 버려요.
function payLink(raw, hosts, amount) {
  try {
    const u = new URL(String(raw || "").trim());
    if (u.protocol !== "https:" || !hosts.includes(u.hostname)) return "";
    // toss.me/아이디 처럼 금액이 없는 토스 링크에는 금액을 이어 붙여요.
    if (u.hostname === "toss.me" && amount > 0) { const seg = u.pathname.split("/").filter(Boolean); if (seg.length === 1) u.pathname = "/" + seg[0] + "/" + amount; }
    return u.href;
  } catch { return ""; }
}

function watchStatus() {
  if (unsubStatus) { unsubStatus(); unsubStatus = null; }
  st.stat = null;
  if (!st.order) return;
  unsubStatus = onValue(ref(db, "status/" + st.order.id), (s) => { st.stat = s.val(); render(); });
}
function dropOrder() { st.order = null; ls.set("order", ""); watchStatus(); }
// 지난 영업일의 주문이나, 카운터에서 "주문 모두 지우기"를 한 뒤에 남은 주문 기록은 버려요.
// (안 버리면 지워진 주문의 송금 안내가 계속 보여서 손님이 없는 주문에 돈을 보낼 수 있어요.)
function dropStaleOrder() {
  const o = st.order; if (!o) return;
  const wiped = Number(st.cfg.wipedAt) || 0;
  if (serverNow() - o.createdAt > ORDER_KEEP_MS || (wiped && o.createdAt < wiped)) dropOrder();
}

// 동시 접속 수 아끼기: 무료 요금제는 동시에 100대까지만 붙을 수 있어요.
// 화면을 안 보고 있거나(다른 앱으로 넘어감) 이미 "주방 접수"까지 끝난 손님은 연결을 끊어 둬요.
let online = true;
function syncConn() {
  const want = st.sending || (document.visibilityState !== "hidden" && !(st.order && st.cfgLoaded && accepted()));
  if (want === online) return;
  online = want;
  if (want) goOnline(db); else goOffline(db);
}
document.addEventListener("visibilitychange", syncConn);

onValue(ref(db, "settings"), (s) => {
  st.cfg = { pub: "경영상회", tables: 12, ...(s.val() || {}) }; st.cfgLoaded = true;
  dropStaleOrder(); render();
});
onValue(ref(db, "menu"), (s) => { st.menu = menuArray(s.val()); st.loaded = true; render(); },
  () => { st.loaded = true; render(); });
watchStatus();
watchConnection({ paused: () => !online });

const lines = () => st.menu.filter((m) => !m.soldout && st.cart[m.id] > 0).map((m) => ({ id: m.id, name: m.name, price: m.price, qty: st.cart[m.id] }));


function menuView() {
  const l = lines(), n = l.reduce((a, x) => a + x.qty, 0);
  let h = `<header class="hero"><span class="sticker">QR 주문</span><h1>${esc(st.cfg.pub)}</h1><p>메뉴를 담고 주문하면 송금 안내가 나와요. 송금하면 직원이 확인하고 주방으로 넘겨요.</p></header>
  <div class="who"><label class="fld"><span>입금자명 (송금할 때 쓰는 이름)</span><input id="f-nick" data-f="nick" value="${esc(st.nick)}" maxlength="12" placeholder="예: 김성곤" autocomplete="off"></label>
  <label class="fld"><span>인원수</span><input id="f-people" data-f="people" type="number" inputmode="numeric" min="1" max="99" step="1" value="${esc(st.people)}" placeholder="예: 4" autocomplete="off"></label></div></div>`;
  if (st.notice) h += `<p class="warn" role="alert" style="margin-top:12px">${esc(st.notice)}</p>`;
  if (!st.loaded) h += '<p class="note" style="margin-top:20px">메뉴를 불러오는 중이에요…</p>';
  else if (!st.menu.length) h += '<p class="warn" style="margin-top:20px">아직 등록된 메뉴가 없어요.</p>';
  h += categories(st.menu).map((c) => `<section class="cat"><h2>${esc(c)}</h2><ul class="items">` +
    st.menu.filter((m) => (m.cat || "기타") === c).map((m) => {
      const q = st.cart[m.id] || 0;
      return `<li class="item${m.soldout ? " sold" : ""}"><div class="nm"><b>${esc(m.name)}</b><span class="pr">${won(m.price)}</span></div>` +
        (m.soldout ? '<span class="tag">품절</span>' :
          `<div class="step"><button data-act="dec" data-id="${esc(m.id)}" aria-label="${esc(m.name)} 하나 빼기"${q ? "" : " disabled"}>−</button><output>${q}</output><button data-act="inc" data-id="${esc(m.id)}" aria-label="${esc(m.name)} 하나 더"${q >= 99 ? " disabled" : ""}>+</button></div>`) + "</li>";
    }).join("") + "</ul></section>").join("");
  const hint = st.slow ? "인터넷이 느려요. 연결되면 자동으로 보내져요" : n ? n + "개 담음" : "메뉴를 담아 주세요";
  h += `<div class="bar"><div><div class="tot"><small>${hint}</small><b>${won(sumItems(l))}</b></div><button class="btn" data-act="order"${n && !st.sending ? "" : " disabled"}>${st.sending ? "보내는 중…" : "주문하기"}</button></div></div>`;
  return h;
}

function orderView() {
  const o = st.order, s = st.stat && st.stat.s;
  // 조리 완료는 손님에게 알리지 않아요. 입금이 확인되면 "주방 접수"까지만 보여줘요.
  const ok = accepted();
  const stage = ok ? 2 : 0;
  const names = ["입금 확인", "주방 접수"];
  const track = s === "cancelled" ? "" : `<div class="track" aria-label="진행 상황">${names.map((t, i) => `<span class="${i < stage ? "past" : i === stage ? "on" : ""}">${t}</span>`).join("")}</div>`;
  const seq = Number(st.stat && st.stat.seq) || 0;
  const msg = ok ? `입금이 확인되어 주방에 접수됐어요.${seq ? " 주문번호 " + seq + "번" : ""}` :
    s === "cancelled" ? "주문이 취소됐어요. 카운터에 문의해 주세요." :
    "송금하면 직원이 입금을 확인해요. 확인되면 이 화면이 바뀌어요.";
  const c = st.cfg, hasAcct = c.bank && c.account;
  const tossMe = payLink(c.tossLink, ["toss.me"], o.total), kakao = payLink(c.kakaoLink, ["qr.kakaopay.com"], 0);
  const toss = `supertoss://send?bank=${encodeURIComponent(c.bank || "")}&accountNo=${encodeURIComponent(String(c.account || "").replace(/[^0-9]/g, ""))}&origin=qr&amount=${o.total}`;
  let h = `<header class="hero"><span class="sticker">내 주문</span><h1>${esc(st.cfg.pub)}</h1></header>
  <div class="card slip">${o.table && o.table !== TABLE_PENDING ? `<div class="kv"><span>테이블</span><span>${esc(tableText(o.table))}</span></div>` : ""}${peopleText(o.people) ? `<div class="kv"><span>인원</span><span>${esc(peopleText(o.people))}</span></div>` : ""}<div class="kv"><span>입금자명</span><span>${esc(o.nick)}</span></div>
  <ul class="lines">${o.items.map((x) => `<li><span>${esc(x.name)} × ${esc(x.qty)}</span><span>${won(x.price * x.qty)}</span></li>`).join("")}</ul>
  <div class="kv"><span>합계</span><span class="total">${won(o.total)}</span></div></div>
  <div class="card" style="margin-top:12px">${track}<p>${esc(msg)}</p></div>`;
  if (!s) {
    h += `<ol class="steps card" style="margin-top:12px"><li><div><b>아래 계좌로 ${won(o.total)} 송금</b>` +
      (hasAcct ? `<div class="kv"><span>${esc(c.bank)}</span><span style="font-family:var(--f-mono)">${esc(c.account)}</span></div><div class="kv"><span>예금주</span><span>${esc(c.holder || "")}</span></div>
      <div class="row"><button class="btn sm" data-act="copy" data-t="${esc(c.account)}" data-l="계좌번호 복사">계좌번호 복사</button><button class="btn sm alt" data-act="copy" data-t="${esc(o.total)}" data-l="금액 복사">금액 복사</button>${tossMe ? `<a class="btn sm alt" href="${esc(tossMe)}" target="_blank" rel="noopener">토스로 송금</a>` : `<a class="btn sm alt" href="${esc(toss)}">토스로 열기</a>`}${kakao ? `<a class="btn sm alt" href="${esc(kakao)}" target="_blank" rel="noopener">카카오페이로 송금</a>` : ""}</div>
      <p class="note">송금 앱 버튼은 폰에 앱이 있어야 열리고, 금액이 자동으로 안 들어갈 수도 있어요. 안 열리거나 금액이 다르면 계좌번호와 금액을 복사해서 직접 보내 주세요. 보낼 때 입금자명이 위에 적은 이름과 같아야 확인돼요.</p>` :
        `<p class="warn">${st.cfgLoaded ? "계좌 정보가 아직 등록되지 않았어요. 직원에게 문의해 주세요." : "계좌 정보를 불러오는 중이에요…"}</p>`) + "</div></li>" +
      '<li><div><b>기다리기</b><p class="note">직원이 입금을 확인하면 주방으로 넘어가요. 이 화면을 닫지 않아도, 다시 열면 내 주문이 그대로 있어요.</p></div></li></ol>';
  }
  h += `<div class="row" style="margin-top:12px"><button class="btn alt" data-act="newOrder">${s === "cancelled" ? "새 주문 하기" : "추가 주문 하기"}</button></div>`;
  return h;
}

function render() {
  syncConn();
  // 이름을 적는 도중에 화면이 다시 그려져도(품절 반영 등) 입력 칸이 풀리지 않게 해요.
  const ae = document.activeElement, fid = ae && ae.tagName === "INPUT" && app.contains(ae) ? ae.id : "", pos = fid ? ae.selectionStart : 0;
  const y = window.scrollY;
  app.innerHTML = st.order ? orderView() : menuView();
  window.scrollTo(0, y);
  const el = fid && document.getElementById(fid);
  if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(pos, pos); } catch {} }
}

app.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id;
  if (a === "inc" || a === "dec") { st.cart[id] = Math.max(0, Math.min(99, (st.cart[id] || 0) + (a === "inc" ? 1 : -1))); render(); }
  else if (a === "copy") copyText(b.dataset.t, b.dataset.l);
  else if (a === "newOrder") { st.cart = {}; st.notice = ""; dropOrder(); render(); }
  else if (a === "order") {
    const l = lines();
    if (!l.length || st.sending) return;
    const nick = st.nick.trim();
    if (!nick) return toast("입금자명을 적어 주세요");
    const people = Number(st.people);
    if (!Number.isInteger(people) || people < 1 || people > 99) return toast("인원수를 1~99 사이 숫자로 입력해 주세요");
    const total = sumItems(l);
    if (total > MAX_TOTAL) return toast("한 번에 " + won(MAX_TOTAL) + "까지 주문할 수 있어요. 나눠서 주문해 주세요");
    if (l.length > 30) return toast("한 번에 30가지까지 주문할 수 있어요. 나눠서 주문해 주세요");
    st.sending = true; st.slow = false; st.notice = ""; render();
    const slowTimer = setTimeout(() => { st.slow = true; render(); }, SLOW_MS);
    const r = push(ref(db, "orders"));
    const o = { table: TABLE_PENDING, nick, people, items: l, total, status: "unpaid" };
    try {
      // 주문 시각은 손님 폰 시계가 아니라 서버 시계로 찍어요.
      await set(r, { ...o, createdAt: serverTimestamp() });
      st.order = { id: r.key, ...o, createdAt: serverNow() }; ls.set("order", JSON.stringify(st.order)); st.cart = {};
      watchStatus();
      window.scrollTo(0, 0);
    } catch (err) {
      const denied = /permission/i.test(String((err && (err.code || err.message)) || ""));
      st.notice = !denied ? "주문을 보내지 못했어요. 인터넷을 확인하고 다시 눌러 주세요."
        : st.slow ? "연결이 불안정해서 주문이 전송됐는지 확실하지 않아요. 다시 주문하기 전에 카운터에서 확인해 주세요."
        : "주문이 접수되지 않았어요. 메뉴가 방금 바뀌었거나 품절됐을 수 있어요. 메뉴를 확인하고 다시 주문해 주세요.";
      window.scrollTo(0, 0);
    }
    clearTimeout(slowTimer); st.sending = false; st.slow = false; render();
  }
});
function onField(e) {
  const f = e.target.dataset && e.target.dataset.f; if (!f) return;
  if (f === "people") st.people = e.target.value;
  if (f === "nick") { st.nick = e.target.value; ls.set("nick", st.nick); }
}
app.addEventListener("input", onField);
app.addEventListener("change", onField);
render();
