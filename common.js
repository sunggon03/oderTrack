import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, onValue, push, set, update, remove, get, runTransaction, goOffline, goOnline, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { initializeAuth, browserSessionPersistence, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

export const configured = !String(firebaseConfig.apiKey).startsWith("여기");
const fbApp = initializeApp(configured ? firebaseConfig : { apiKey: "x", databaseURL: "https://x-default-rtdb.firebaseio.com", projectId: "x", appId: "x" });
export const db = getDatabase(fbApp);
// 로그인 정보를 "이 탭"에만 보관해요(탭·브라우저를 닫으면 로그아웃). 예전처럼 기기에 계속 남겨 두면, 직원이 아닌 사람이 같은 기기에서 링크를 열 때 로그인된 채로 보일 수 있어요.
// 손님 페이지(index.html)는 로그인을 쓰지 않으므로 같은 기기에 직원 로그인이 남아 있어도 항상 비로그인 손님으로 동작해요.
export const auth = initializeAuth(fbApp, { persistence: browserSessionPersistence });
export { ref, onValue, push, set, update, remove, get, runTransaction, signOut, goOffline, goOnline, serverTimestamp };

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const won = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";
export const hhmm = (t) => new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
// 테이블 표기. 손님은 테이블을 고르지 않아서 주문이 들어올 때는 "미정"이고, 직원이 입금 확인할 때 번호를 정해요.
export const TABLE_PENDING = "미정";
export const tableText = (t) => { t = String(t ?? "").trim(); return !t || t === TABLE_PENDING ? "테이블 미정" : /^[0-9]+$/.test(t) ? t + "번" : t; };
export const peopleText = (n) => (Number.isFinite(n) && n >= 1 ? n + "명" : "");
export const clone = (o) => JSON.parse(JSON.stringify(o));

// 기기 시계가 틀려도 경과 시간이 맞도록 서버 시계를 기준으로 계산해요.
let timeOffset = 0;
if (configured) onValue(ref(db, ".info/serverTimeOffset"), (s) => { timeOffset = Number(s.val()) || 0; });
export const serverNow = () => Date.now() + timeOffset;

export const DEFAULT_MENU = [
  { id: "m1", cat: "안주", name: "김치전", price: 8000 },
  { id: "m2", cat: "안주", name: "어묵탕", price: 10000 },
  { id: "m3", cat: "안주", name: "치즈 떡볶이", price: 9000 },
  { id: "m4", cat: "안주", name: "소떡소떡", price: 6000 },
  { id: "m5", cat: "음료", name: "사이다", price: 2000 },
  { id: "m6", cat: "음료", name: "콜라", price: 2000 },
  { id: "m7", cat: "음료", name: "청포도 에이드", price: 4000 },
];

// Firebase 객체 {id: {...}} 를 order 순서의 배열로 바꿔요.
export function menuArray(obj) {
  return Object.entries(obj || {}).map(([id, m]) => ({ id, ...m })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
export function categories(menu) {
  const c = [];
  menu.forEach((m) => { const k = m.cat || "기타"; if (!c.includes(k)) c.push(k); });
  return c;
}
// 단위는 메뉴의 "분류"로 정해져요(고정). 주류 → 병, 메인·사이드·안주 → 인분, 그 밖(음료 등) → 개.
// 분류 이름에 아래 낱말이 들어 있으면 해당 단위가 돼요. 바꾸려면 이 표만 고치면 돼요.
const UNIT_RULES = [[/주류|술|맥주|소주|와인/, "병"], [/메인|사이드|안주|식사|요리/, "인분"]];
export const unitFor = (cat) => { const c = String(cat || ""); const r = UNIT_RULES.find(([re]) => re.test(c)); return r ? r[1] : "개"; };
export const sumItems = (items) => (items || []).reduce((a, x) => a + x.price * x.qty, 0);

// 주문은 손님 기기에서 온 데이터라서 믿지 않아요. 화면에 넣기 전에 글자·숫자 모양을 강제로 맞춰요.
// (수량 자리에 HTML을 넣거나 항목을 엉뚱한 모양으로 보내 직원 화면을 망가뜨리는 것을 막아요.)
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
const STATUSES = ["unpaid", "cooking", "done", "cancelled"];
export function cleanItems(items) {
  const arr = Array.isArray(items) ? items : items && typeof items === "object" ? Object.values(items) : [];
  return arr.filter((x) => x && typeof x === "object").slice(0, 40).map((x) => ({
    id: String(x.id ?? ""), name: String(x.name ?? "?").slice(0, 60), price: num(x.price), qty: Math.floor(num(x.qty)),
  }));
}
export function cleanOrder(id, o) {
  o = o && typeof o === "object" ? o : {};
  return {
    id: String(id), table: String(o.table ?? "?").slice(0, 10), nick: String(o.nick ?? "?").slice(0, 20),
    items: cleanItems(o.items), total: num(o.total),
    status: STATUSES.includes(o.status) ? o.status : "unpaid",
    createdAt: num(o.createdAt), paidAt: o.paidAt == null ? null : num(o.paidAt), doneAt: o.doneAt == null ? null : num(o.doneAt),
    seq: o.seq == null ? null : num(o.seq),
    people: o.people == null ? null : Math.min(99, Math.floor(num(o.people))),
  };
}
export const ordersArray = (val) => Object.entries(val && typeof val === "object" ? val : {}).map(([id, o]) => cleanOrder(id, o));

export function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2400);
}
export function copyText(txt, label) {
  navigator.clipboard.writeText(String(txt)).then(() => toast((label || "복사") + " 완료"), () => toast("길게 눌러서 직접 복사해 주세요"));
}

// ---- 소리 (주방 화면에서만 써요) ----
// 브라우저는 사용자가 화면을 터치하기 전에는 소리를 막아요. 그래서 주방 화면에 "소리 켜기" 버튼을 두고, soundOn()으로 켜졌는지 확인해요.
let actx = null;
const AC = window.AudioContext || window.webkitAudioContext;
const ctx = () => { try { actx = actx || new AC(); return actx; } catch { return null; } };
document.addEventListener("click", () => { const c = ctx(); if (c && c.state !== "running") c.resume().catch(() => {}); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && actx && actx.state !== "running") actx.resume().catch(() => {}); });
export const soundOn = () => !!actx && actx.state === "running";
export async function enableSound() {
  const c = ctx(); if (!c) return false;
  try { await c.resume(); } catch {}
  if (c.state === "running") tone(1047, 0, 0.18, 0.6); // 켜졌는지 바로 들려줘요
  return c.state === "running";
}
// 짧은 소리 하나. 시작·끝에 볼륨을 부드럽게 올리고 내려서 "틱" 소리가 안 나게 해요.
function tone(freq, delay, dur, vol, type = "square") {
  const c = actx; if (!c) return;
  const o = c.createOscillator(), g = c.createGain(), at = c.currentTime + delay;
  o.type = type; o.frequency.value = freq; o.connect(g); g.connect(c.destination);
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.01); g.gain.setValueAtTime(vol, at + dur - 0.03); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.start(at); o.stop(at + dur + 0.02);
}
// 새 주문: "띵-동" 3번(약 2초). 시끄러운 주점에서도 들리게 사각파·높은 볼륨이에요. 기기 볼륨도 키워 두세요.
export function orderAlarm() {
  try {
    if (!soundOn()) return;
    for (let i = 0; i < 3; i++) { tone(1175, i * 0.75, 0.3, 0.85); tone(1568, i * 0.75 + 0.33, 0.38, 0.85); }
  } catch {}
}
// 경고(연결 끊김): 낮은 소리 여러 번.
export function beep(freq = 880, times = 1) {
  try {
    if (!soundOn()) return;
    for (let i = 0; i < times; i++) tone(freq, i * 0.45, 0.3, 0.6);
  } catch {}
}

export function setupWarning(root) {
  root.innerHTML = '<div class="card warn"><b>Firebase 설정이 아직 안 됐어요.</b><p>firebase-config.js 파일의 값을 Firebase 콘솔에서 복사한 값으로 바꿔 주세요. 자세한 순서는 README.md에 있어요.</p></div>';
}

// 연결 상태 배너. 서버와 끊기면 화면 맨 위에 크게 알려요.
// - paused: 일부러 연결을 끊어 둔 상태(손님 화면의 접속 절약)면 true를 돌려주는 함수. 이때는 배너를 띄우지 않아요.
// - staff: 직원 화면이면 true. 경과 시간과 아래의 "응답 확인"이 추가돼요.
// - sound: 연결이 끊길 때 경고음을 낼지(주방만 true. 카운터는 소리 없이 빨간 배너만 떠요).
// - role: 직원 화면 이름("counter"/"kitchen"). 응답 확인용 값을 쓰는 자리 이름이에요.
const GRACE_MS = 4000;        // 이 시간 안에 다시 붙으면 배너를 띄우지 않아요(순간 끊김 무시)
const FIRST_GRACE_MS = 8000;  // 페이지를 처음 열 때는 접속에 시간이 걸릴 수 있어 조금 더 기다려요
const PING_EVERY_MS = 20000;  // 직원 화면이 서버에 응답을 확인하는 간격
const PING_LATE_MS = 10000;   // 이 시간 안에 응답이 없으면 끊긴 것으로 봐요
const RETRY_EVERY_MS = 15000; // 끊겨 있는 동안 연결을 새로 시도하는 간격
export function watchConnection({ staff = false, role = "", paused = () => false, sound = false } = {}) {
  const el = document.createElement("div");
  el.className = "offline"; el.setAttribute("role", "alert"); el.hidden = true;
  document.body.prepend(el);
  let connected = false, everConnected = false, changedAt = Date.now(), stalled = false, shown = false, downAt = 0, wasPaused = false, kickedAt = 0;
  // 연결을 버리고 새로 맺어요. 보내려던 주문·입금 확인은 사라지지 않고 새 연결로 다시 전송돼요.
  const kick = () => { kickedAt = Date.now(); goOffline(db); goOnline(db); };
  const clock = (ms) => { const s = Math.floor(ms / 1000); return (s >= 60 ? Math.floor(s / 60) + "분 " : "") + (s % 60) + "초"; };

  function paint() {
    const p = paused();
    if (wasPaused && !p) changedAt = Date.now(); // 일부러 끊었다가 다시 붙는 중이면 처음부터 다시 기다려요
    wasPaused = p;
    const down = !p && (!connected || stalled);
    const show = down && (stalled || navigator.onLine === false || Date.now() - changedAt >= (everConnected ? GRACE_MS : FIRST_GRACE_MS));
    if (show) {
      if (!shown) downAt = connected ? Date.now() : changedAt;
      el.innerHTML = staff
        ? `<b>연결 끊김 · ${clock(Date.now() - downAt)}째</b><span>새 주문이 이 화면에 들어오지 않고 있어요. 와이파이·데이터를 확인하고, 계속 안 되면 종이 주문으로 받으세요.</span>`
        : "<b>인터넷 연결이 끊겼어요</b><span>연결되면 자동으로 이어져요. 급하면 카운터에서 직접 주문해 주세요.</span>";
      document.documentElement.style.setProperty("--offh", el.offsetHeight + "px");
    }
    if (show !== shown) {
      shown = show; el.hidden = !show; document.body.classList.toggle("is-offline", show);
      if (show) { kickedAt = Date.now(); document.documentElement.style.setProperty("--offh", el.offsetHeight + "px"); if (staff && sound) beep(330, 3); }
      else if (connected && !stalled) toast("다시 연결됐어요");
    }
    // 끊긴 채로 오래 있으면 브라우저가 재시도 간격을 몇 분까지 늘려요. 그래서 배너가 떠 있는 동안은 15초마다 직접 다시 시도해요.
    if (show && Date.now() - kickedAt >= RETRY_EVERY_MS) kick();
  }

  onValue(ref(db, ".info/connected"), (s) => { connected = s.val() === true; if (connected) everConnected = true; changedAt = Date.now(); paint(); });
  window.addEventListener("online", paint);
  window.addEventListener("offline", paint);
  setInterval(paint, 1000);

  // 응답 확인(직원 화면만): 공유기는 켜져 있는데 인터넷만 죽으면 브라우저가 끊긴 줄 모르고 몇 분씩 가만히 있어요.
  // 그래서 20초마다 작은 값을 써 보고, 10초 안에 서버 응답이 없으면 끊긴 것으로 표시한 뒤 연결을 새로 맺어요.
  if (staff && role) {
    let pendingAt = 0;
    const ping = () => {
      if (pendingAt) return;
      pendingAt = Date.now();
      set(ref(db, "meta/ping/" + role), serverTimestamp()).then(
        () => { pendingAt = 0; if (stalled) { stalled = false; changedAt = Date.now(); paint(); } },
        () => { pendingAt = 0; },
      );
    };
    setInterval(() => {
      if (!pendingAt || Date.now() - pendingAt < PING_LATE_MS) return;
      if (!stalled) { stalled = true; paint(); kick(); }
    }, 2000);
    setInterval(ping, PING_EVERY_MS);
    ping();
  }
}

// 화면이 꺼지지 않게 해요(지원하는 브라우저만). 태블릿의 자동 잠금 설정도 함께 꺼 두는 게 안전해요.
export function keepAwake() {
  let lock = null;
  const ask = async () => {
    try {
      if (!("wakeLock" in navigator) || document.visibilityState !== "visible" || (lock && !lock.released)) return;
      lock = await navigator.wakeLock.request("screen");
    } catch {}
  };
  document.addEventListener("visibilitychange", ask);
  document.addEventListener("click", ask);
  ask();
}

const LOGIN_ERRORS = {
  "auth/invalid-credential": "이메일이나 비밀번호가 맞지 않아요.",
  "auth/wrong-password": "이메일이나 비밀번호가 맞지 않아요.",
  "auth/user-not-found": "이메일이나 비밀번호가 맞지 않아요.",
  "auth/invalid-email": "이메일 주소 모양이 올바르지 않아요.",
  "auth/user-disabled": "사용이 중지된 계정이에요. Firebase 콘솔의 Authentication에서 확인해 주세요.",
  "auth/too-many-requests": "시도가 너무 많아 잠시 막혔어요. 몇 분 뒤에 다시 해 주세요.",
  "auth/network-request-failed": "인터넷에 연결되지 않았어요. 연결을 확인해 주세요.",
  "auth/operation-not-allowed": "이메일/비밀번호 로그인이 꺼져 있어요. Firebase 콘솔 > Authentication > 로그인 방법에서 켜 주세요.",
  "auth/unauthorized-domain": "이 주소가 승인되지 않았어요. Firebase 콘솔 > Authentication > 설정 > 승인된 도메인에 이 사이트 주소를 추가해 주세요.",
};

// 직원 페이지 로그인. 로그인된 상태에서만 onReady를 부르고, 로그아웃되면 다시 로그인 화면을 보여줘요.
export function needLogin(root, onReady) {
  let started = false;
  onAuthStateChanged(auth, (u) => {
    if (u) {
      if (!started) { started = true; root.innerHTML = ""; staffGate(root, u, onReady); }
    } else {
      if (started) { location.reload(); return; }
      root.innerHTML = `<form class="card login" id="lf"><h2>직원 로그인</h2>
        <label class="fld"><span>이메일</span><input id="lf-email" type="email" autocomplete="username" required></label>
        <label class="fld"><span>비밀번호</span><input id="lf-pw" type="password" autocomplete="current-password" required></label>
        <p class="warn" id="lf-err" role="alert" hidden></p>
        <button class="btn" type="submit" id="lf-go">로그인</button></form>`;
      $("#lf").addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = $("#lf-err"), go = $("#lf-go");
        err.hidden = true; go.disabled = true;
        try { await signInWithEmailAndPassword(auth, $("#lf-email").value.trim(), $("#lf-pw").value); }
        catch (x) {
          const code = (x && x.code) || "unknown";
          // 원인을 알 수 있게 오류 코드를 같이 보여줘요.
          err.textContent = (LOGIN_ERRORS[code] || "로그인하지 못했어요.") + " (" + code + ")";
          err.hidden = false; go.disabled = false;
        }
      });
    }
  });
}

// 로그인한 계정이 직원인지 확인해요.
// Firebase는 누구나 새 계정을 만들 수 있어서, 로그인했다는 것만으로 직원 권한을 주면 안 돼요.
// 직원 여부는 보안 규칙이 정해요(규칙 안에 적어 둔 UID, 또는 데이터의 staff 목록). 화면은 직원만 읽을 수 있는 값(meta)을 읽어 보고 허락되면 직원으로 봐요.
// - 허락됨: 화면 시작
// - 거부됨: 내 UID를 보여주고 규칙에 추가하도록 안내해요. 5초마다 자동으로 다시 확인해요
// - staff 경로 읽기가 거부되면 보안 규칙이 예전 버전이에요. 화면은 열되 경고를 띄워요(info.rulesOld)
// 한 번만 읽어요(권한이 없으면 오류가 그대로 넘어와요).
const readOnce = (path) => new Promise((res, rej) => onValue(ref(db, path), (s) => res(s), (e) => rej(e), { onlyOnce: true }));
function staffGate(root, user, onReady) {
  let opened = false, timer = 0, busy = false;
  const denied = (e) => /permission/i.test(String((e && (e.code || e.message)) || ""));

  async function check() {
    if (opened || busy) return;
    busy = true;
    try {
      await readOnce("meta/seq");                // 직원만 읽을 수 있어요
      opened = true; clearInterval(timer);
      let rulesOld = false;
      try { await readOnce("staff/" + user.uid); } catch (e) { rulesOld = denied(e); }   // 새 규칙에서는 내 자리를 읽을 수 있어요
      onReady(user, { rulesOld });
    } catch (e) {
      if (denied(e)) showGuide(); else if (!document.getElementById("sg-uid")) root.innerHTML = '<p class="note" style="margin-top:30px">서버에 연결하는 중이에요…</p>';
    }
    busy = false;
  }
  function showGuide() {
    if (document.getElementById("sg-uid")) return;
    root.innerHTML = `<div class="card login" style="max-width:520px"><h2>직원으로 등록되지 않은 계정이에요</h2>
      <p>로그인은 됐지만 이 계정은 아직 직원 권한이 없어요. 다른 사람이 계정을 만들어 들어오는 것을 막기 위한 절차예요.</p>
      <ol class="guide"><li>아래 <b>UID 복사</b>를 눌러요.</li>
      <li>복사한 UID를 관리자(개발 담당)에게 보내서 보안 규칙에 추가해요. 또는 Firebase 콘솔 → Realtime Database → <b>데이터</b> 탭에서 키 <b>staff</b> 아래에 UID를 키로, 값 <b>true</b>로 추가해도 돼요.</li>
      <li>등록되면 이 화면이 5초 안에 자동으로 넘어가요.</li></ol>
      <div class="kv"><span>내 UID</span><span class="uid" id="sg-uid">${esc(user.uid)}</span></div>
      <p class="note">로그인한 이메일: ${esc(user.email || "?")}</p>
      <div class="row"><button class="btn sm" id="sg-copy">UID 복사</button><button class="btn sm alt" id="sg-again">지금 다시 확인</button><button class="btn sm ghost" id="sg-out">로그아웃</button></div></div>`;
    $("#sg-copy").addEventListener("click", () => copyText(user.uid, "UID 복사"));
    $("#sg-again").addEventListener("click", () => check());
    $("#sg-out").addEventListener("click", () => signOut(auth));
  }
  timer = setInterval(check, 5000);
  check();
}

export const RULES_OLD_WARNING = '<p class="warn"><b>보안 규칙이 예전 버전이에요.</b> 지금은 누구든 계정을 만들어 주문을 보거나 계좌번호를 바꿀 수 있는 상태예요. Firebase 콘솔 > Realtime Database > 규칙에 새 database.rules.json 내용을 붙여넣고 게시해 주세요.</p>';
