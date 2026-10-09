import { tableText, peopleText, db, auth, ref, onValue, update, serverTimestamp, serverNow, signOut, needLogin, $, esc, hhmm, toast, orderAlarm, enableSound, soundOn, configured, setupWarning, ordersArray, menuArray, unitFor, watchConnection, keepAwake, RULES_OLD_WARNING } from "./common.js?v=7";

const app = $("#app");
if (!configured) { setupWarning(app); throw new Error("firebase-config.js 미설정"); }

const st = { orders: [], loaded: false, showDone: false, err: "", rulesOld: false, fresh: {}, units: {} };
const FRESH_MS = 8000; // 새 주문서를 이 시간 동안 깜빡여요(소리를 못 들었을 때를 대비)

function ticket(o) {
  const mins = Math.max(0, Math.floor((serverNow() - (o.paidAt || o.createdAt)) / 60000));
  const late = o.status === "cooking" && mins >= 15;
  return `<article class="ticket${late ? " late" : ""}${st.fresh[o.id] && Date.now() - st.fresh[o.id] < FRESH_MS ? " fresh" : ""}">
    <div class="ttable">${esc(tableText(o.table))}${peopleText(o.people) ? `<span class="tppl">${esc(peopleText(o.people))}</span>` : ""}</div>
    <div class="tmeta"><span class="tno">주문 ${esc(o.seq ?? "-")}번</span><span class="where">${esc(o.nick)}</span></div>
    <ul>${o.items.map((x) => `<li><span class="nm">${esc(x.name)}</span><b>${esc(x.qty)}${esc(st.units[x.id] || "개")}</b></li>`).join("")}</ul>
    <div class="el">${hhmm(o.paidAt || o.createdAt)} 접수 · ${mins}분 경과</div>
    ${o.status === "cooking"
      ? `<button class="btn ok" data-act="st" data-id="${esc(o.id)}" data-to="done">조리 완료</button>`
      : `<button class="btn ghost" data-act="st" data-id="${esc(o.id)}" data-to="cooking">되돌리기</button>`}
  </article>`;
}

function render() {
  const cook = st.orders.filter((o) => o.status === "cooking").sort((a, b) => (a.paidAt || a.createdAt) - (b.paidAt || b.createdAt));
  const done = st.orders.filter((o) => o.status === "done").sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 12);
  let h = `<nav class="tabs"><button aria-current="true">주방 주문서</button><span class="sp"></span><button data-act="toggleDone">완료 ${st.showDone ? "숨기기" : "보기"}</button><button data-act="logout">로그아웃</button></nav>
  <div class="pills"><span class="pill${cook.length ? " hot" : ""}">조리할 주문 ${cook.length}</span>${soundOn() ? '<span class="pill">소리 켜짐</span><button class="btn ghost sm" data-act="sound">소리 테스트</button>' : ""}</div>
  ${soundOn() ? "" : '<button class="btn snd" data-act="sound">소리 꺼짐 · 여기를 눌러 새 주문 알림음 켜기</button>'}`;
  if (st.rulesOld) h += RULES_OLD_WARNING;
  if (st.err) h += `<p class="warn">주문을 불러오지 못했어요 (${esc(st.err)}). 새로고침하거나 다시 로그인해 주세요.</p>`;
  h += cook.length ? `<div class="tickets">${cook.map(ticket).join("")}</div>` : `<p class="note" style="margin-top:30px">${st.loaded ? "조리할 주문이 없어요. 카운터에서 입금 확인을 누르면 여기에 주문서가 떠요." : "불러오는 중…"}</p>`;
  if (st.showDone) h += `<section class="sec"><h3>최근 완료 <em>12건</em></h3>${done.length ? `<div class="tickets">${done.map(ticket).join("")}</div>` : '<p class="note">아직 없어요.</p>'}</section>`;
  h += '<p class="foot">새 주문이 들어오면 큰 소리가 나요. 위의 "소리 켜기"를 한 번 눌러야 하고, 새로고침·화면 꺼짐 뒤에는 다시 눌러야 할 수 있어요. 기기 볼륨도 키워 두세요.</p>';
  const y = window.scrollY; app.innerHTML = h; window.scrollTo(0, y);
}

app.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act;
  if (a === "sound") { await enableSound(); render(); }
  else if (a === "toggleDone") { st.showDone = !st.showDone; render(); }
  else if (a === "logout") signOut(auth);
  else if (a === "st") {
    const id = b.dataset.id, to = b.dataset.to, o = st.orders.find((x) => x.id === id); if (!o) return;
    const up = { [`orders/${id}/status`]: to };
    // 조리 완료는 주방 안에서만 쓰고, 손님이 보는 status에는 올리지 않아요.
    if (to === "done") up[`orders/${id}/doneAt`] = serverTimestamp();
    else up[`status/${id}`] = { s: to, seq: o.seq ?? null };
    try { await update(ref(db), up); } catch { toast("바꾸지 못했어요. 다시 눌러 주세요"); }
  }
});

needLogin(app, (user, info) => {
  st.rulesOld = !!(info && info.rulesOld);
  let first = true;
  onValue(ref(db, "orders"), (snap) => {
    const next = ordersArray(snap.val());
    if (!first) {
      const had = new Set(st.orders.filter((o) => o.status === "cooking").map((o) => o.id));
      const added = next.filter((o) => o.status === "cooking" && !had.has(o.id));
      if (added.length) { added.forEach((o) => { st.fresh[o.id] = Date.now(); }); orderAlarm(); setTimeout(render, FRESH_MS + 100); }
    }
    first = false; st.orders = next; st.loaded = true; st.err = ""; render();
  }, (err) => { st.err = err.code || "error"; st.loaded = true; render(); });
  onValue(ref(db, "menu"), (s) => { st.units = Object.fromEntries(menuArray(s.val()).map((m) => [m.id, unitFor(m.cat)])); render(); }, () => {});
  setInterval(render, 30000);
  // 소리 상태(켜짐/꺼짐)가 바뀌면 안내를 바로 갱신해요. 화면이 꺼졌다 켜지면 브라우저가 소리를 다시 막을 수 있어요.
  let wasOn = soundOn();
  setInterval(() => { const now = soundOn(); if (now !== wasOn) { wasOn = now; render(); } }, 1500);
  watchConnection({ staff: true, role: "kitchen", sound: true });
  keepAwake();
  render();
});
