import { tableText, peopleText, db, auth, ref, onValue, update, serverTimestamp, serverNow, signOut, needLogin, $, esc, hhmm, toast, orderAlarm, enableSound, soundOn, configured, setupWarning, ordersArray, menuArray, unitFor, hiddenFromKitchen, watchConnection, keepAwake, RULES_OLD_WARNING } from "./common.js?v=7";

const app = $("#app");
if (!configured) { setupWarning(app); throw new Error("firebase-config.js 미설정"); }

const st = { orders: [], loaded: false, tab: "cook", err: "", rulesOld: false, fresh: {}, units: {}, cats: {}, menuLoaded: false };
// 소개팅 같은 분류는 주방 주문서에 올리지 않아요. 주문에 남은 메뉴가 없으면 주문서 자체를 만들지 않아요.
const kitchenItems = (o) => o.items.filter((x) => !hiddenFromKitchen(st.cats[x.id]));
const FRESH_MS = 8000; // 새 주문서를 이 시간 동안 깜빡여요(소리를 못 들었을 때를 대비)

function ticket(o) {
  const mins = Math.max(0, Math.floor((serverNow() - (o.paidAt || o.createdAt)) / 60000));
  const late = o.status === "cooking" && mins >= 15;
  return `<article class="ticket${late ? " late" : ""}${st.fresh[o.id] && Date.now() - st.fresh[o.id] < FRESH_MS ? " fresh" : ""}">
    <div class="ttable">${esc(tableText(o.table))}${peopleText(o.people) ? `<span class="tppl">${esc(peopleText(o.people))}</span>` : ""}</div>
    <div class="tmeta"><span class="tno">주문 ${esc(o.seq ?? "-")}번</span><span class="where">${esc(o.nick)}</span></div>
    <ul>${kitchenItems(o).map((x) => `<li><span class="nm">${esc(x.name)}</span><b>${esc(x.qty)}${esc(st.units[x.id] || "개")}</b></li>`).join("")}</ul>
    <div class="el">${hhmm(o.paidAt || o.createdAt)} 접수 · ${mins}분 경과</div>
    ${o.status === "cooking"
      ? `<button class="btn ok" data-act="st" data-id="${esc(o.id)}" data-to="done">조리 완료</button>`
      : `<button class="btn ghost" data-act="st" data-id="${esc(o.id)}" data-to="cooking">되돌리기</button>`}
  </article>`;
}

function render() {
  const ready = st.loaded && st.menuLoaded; // 메뉴 분류를 알기 전에는 주문서를 그리지 않아요(소개팅 메뉴가 잠깐 보이는 것을 막아요)
  const cook = (ready ? st.orders : []).filter((o) => o.status === "cooking" && kitchenItems(o).length).sort((a, b) => (a.paidAt || a.createdAt) - (b.paidAt || b.createdAt));
  const done = (ready ? st.orders : []).filter((o) => o.status === "done" && kitchenItems(o).length).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 30);
  let h = `<nav class="tabs" aria-label="주방 메뉴"><button data-act="tab" data-to="cook"${st.tab === "cook" ? ' aria-current="true"' : ""}>주방 주문서${cook.length ? " (" + cook.length + ")" : ""}</button><button data-act="tab" data-to="done"${st.tab === "done" ? ' aria-current="true"' : ""}>완료</button><span class="sp"></span><button data-act="logout">로그아웃</button></nav>
  <div class="pills"><span class="pill${cook.length ? " hot" : ""}">조리할 주문 ${cook.length}</span>${soundOn() ? '<span class="pill">소리 켜짐</span><button class="btn ghost sm" data-act="sound">소리 테스트</button>' : ""}</div>
  ${soundOn() ? "" : '<button class="btn snd" data-act="sound">소리 꺼짐 · 여기를 눌러 새 주문 알림음 켜기</button>'}`;
  if (st.rulesOld) h += RULES_OLD_WARNING;
  if (st.err) h += `<p class="warn">주문을 불러오지 못했어요 (${esc(st.err)}). 새로고침하거나 다시 로그인해 주세요.</p>`;
  if (st.tab === "done") h += `<section class="sec"><h3>최근 완료 <em>최근 30건 · 잘못 눌렀으면 "되돌리기"</em></h3>${done.length ? `<div class="tickets">${done.map(ticket).join("")}</div>` : '<p class="note">아직 없어요.</p>'}</section>`;
  else h += cook.length ? `<div class="slide" id="slide" tabindex="0" aria-label="조리할 주문서. 옆으로 밀어서 넘겨요">${cook.map(ticket).join("")}</div>
  <div class="pager" id="pager" hidden><button class="btn alt" data-act="slide" data-dir="-1" id="pg-prev">◀ 앞 주문</button><span id="pg-txt"></span><button class="btn alt" data-act="slide" data-dir="1" id="pg-next">다음 주문 ▶</button></div>` : `<p class="note" style="margin-top:30px">${ready ? "조리할 주문이 없어요. 카운터에서 입금 확인을 누르면 여기에 주문서가 떠요." : "불러오는 중…"}</p>`;
  h += '<p class="foot">새 주문이 들어오면 큰 소리가 나요. 위의 "소리 켜기"를 한 번 눌러야 하고, 새로고침·화면 꺼짐 뒤에는 다시 눌러야 할 수 있어요. 기기 볼륨도 키워 두세요.</p>';
  // 화면이 다시 그려져도(새 주문, 시간 갱신) 옆으로 넘겨 둔 위치는 그대로 두어요.
  const prev = document.getElementById("slide"), sx = prev ? prev.scrollLeft : 0;
  const y = window.scrollY; app.innerHTML = h; window.scrollTo(0, y);
  const sl = document.getElementById("slide"); if (sl && sx) sl.scrollLeft = sx;
  updatePager();
}

// 한 화면에 보이는 주문서 수는 CSS(--per)가 정해요: 아이패드 가로 5장, 세로 3장, 작은 화면 2장. 그보다 많으면 옆으로 넘겨요.
function slideInfo() {
  const sl = document.getElementById("slide"); if (!sl) return null;
  const t = sl.querySelectorAll(".ticket"); if (!t.length) return null;
  const per = Math.max(1, parseInt(getComputedStyle(sl).getPropertyValue("--per")) || 1);
  const pitch = t.length > 1 ? t[1].offsetLeft - t[0].offsetLeft : t[0].offsetWidth;
  const first = Math.min(t.length - 1, Math.max(0, Math.round(sl.scrollLeft / pitch)));
  const freshIdx = [...t].findIndex((x, i) => i >= first + per && x.classList.contains("fresh"));
  return { sl, per, pitch, first, total: t.length, hiddenFresh: freshIdx >= 0 };
}
function updatePager() {
  const pg = document.getElementById("pager"), i = slideInfo(); if (!pg || !i) return;
  const last = Math.min(i.first + i.per, i.total), rest = i.total - last;
  pg.hidden = i.total <= i.per;
  pg.classList.toggle("new", i.hiddenFresh);
  document.getElementById("pg-txt").textContent = `${i.first + 1}–${last}번째 / 총 ${i.total}건` + (rest > 0 ? ` · 뒤에 ${rest}건 더` : "");
  document.getElementById("pg-prev").disabled = i.first <= 0;
  document.getElementById("pg-next").disabled = rest <= 0;
}
app.addEventListener("scroll", (e) => { if (e.target && e.target.id === "slide") updatePager(); }, true);
window.addEventListener("resize", updatePager);

app.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act;
  if (a === "sound") { await enableSound(); render(); }
  else if (a === "slide") { const i = slideInfo(); if (i) i.sl.scrollBy({ left: Number(b.dataset.dir) * i.pitch * i.per, behavior: "smooth" }); }
  else if (a === "tab") { st.tab = b.dataset.to; window.scrollTo(0, 0); render(); }
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
      const added = next.filter((o) => o.status === "cooking" && !had.has(o.id) && kitchenItems(o).length);
      if (added.length) { added.forEach((o) => { st.fresh[o.id] = Date.now(); }); orderAlarm(); setTimeout(render, FRESH_MS + 100); }
    }
    first = false; st.orders = next; st.loaded = true; st.err = ""; render();
  }, (err) => { st.err = err.code || "error"; st.loaded = true; render(); });
  onValue(ref(db, "menu"), (s) => { const mm = menuArray(s.val()); st.units = Object.fromEntries(mm.map((m) => [m.id, unitFor(m.cat)])); st.cats = Object.fromEntries(mm.map((m) => [m.id, m.cat])); st.menuLoaded = true; render(); }, () => { st.menuLoaded = true; render(); });
  setInterval(render, 30000);
  // 소리 상태(켜짐/꺼짐)가 바뀌면 안내를 바로 갱신해요. 화면이 꺼졌다 켜지면 브라우저가 소리를 다시 막을 수 있어요.
  let wasOn = soundOn();
  setInterval(() => { const now = soundOn(); if (now !== wasOn) { wasOn = now; render(); } }, 1500);
  watchConnection({ staff: true, role: "kitchen", sound: true });
  keepAwake();
  render();
});
