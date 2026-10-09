import { tableText, peopleText, db, auth, ref, onValue, update, serverTimestamp, serverNow, signOut, needLogin, $, esc, hhmm, toast, beep, configured, setupWarning, ordersArray, watchConnection, keepAwake, RULES_OLD_WARNING } from "./common.js?v=6";

const app = $("#app");
if (!configured) { setupWarning(app); throw new Error("firebase-config.js 미설정"); }

const st = { orders: [], loaded: false, showDone: false, err: "", rulesOld: false };

function ticket(o) {
  const mins = Math.max(0, Math.floor((serverNow() - (o.paidAt || o.createdAt)) / 60000));
  const late = o.status === "cooking" && mins >= 15;
  return `<article class="ticket${late ? " late" : ""}">
    <div class="tmeta"><span class="tno">${esc(o.seq ?? "-")}</span><span class="where">${esc(tableText(o.table))} · ${esc(o.nick)}${peopleText(o.people) ? " · " + esc(peopleText(o.people)) : ""}</span></div>
    <ul>${o.items.map((x) => `<li><b>${esc(x.qty)}</b><span>${esc(x.name)}</span></li>`).join("")}</ul>
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
  <div class="pills"><span class="pill${cook.length ? " hot" : ""}">조리할 주문 ${cook.length}</span></div>`;
  if (st.rulesOld) h += RULES_OLD_WARNING;
  if (st.err) h += `<p class="warn">주문을 불러오지 못했어요 (${esc(st.err)}). 새로고침하거나 다시 로그인해 주세요.</p>`;
  h += cook.length ? `<div class="tickets">${cook.map(ticket).join("")}</div>` : `<p class="note" style="margin-top:30px">${st.loaded ? "조리할 주문이 없어요. 카운터에서 입금 확인을 누르면 여기에 주문서가 떠요." : "불러오는 중…"}</p>`;
  if (st.showDone) h += `<section class="sec"><h3>최근 완료 <em>12건</em></h3>${done.length ? `<div class="tickets">${done.map(ticket).join("")}</div>` : '<p class="note">아직 없어요.</p>'}</section>`;
  h += '<p class="foot">새 주문 알림음은 이 화면을 한 번 터치하면 켜져요.</p>';
  const y = window.scrollY; app.innerHTML = h; window.scrollTo(0, y);
}

app.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act;
  if (a === "toggleDone") { st.showDone = !st.showDone; render(); }
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
      if (next.some((o) => o.status === "cooking" && !had.has(o.id))) beep();
    }
    first = false; st.orders = next; st.loaded = true; st.err = ""; render();
  }, (err) => { st.err = err.code || "error"; st.loaded = true; render(); });
  setInterval(render, 30000);
  watchConnection({ staff: true, role: "kitchen" });
  keepAwake();
  render();
});
