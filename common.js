import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, onValue, push, set, update, remove, get, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

export const configured = !String(firebaseConfig.apiKey).startsWith("여기");
const fbApp = initializeApp(configured ? firebaseConfig : { apiKey: "x", databaseURL: "https://x-default-rtdb.firebaseio.com", projectId: "x", appId: "x" });
export const db = getDatabase(fbApp);
export const auth = getAuth(fbApp);
export { ref, onValue, push, set, update, remove, get, runTransaction, signOut };

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const won = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";
export const hhmm = (t) => new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
export const clone = (o) => JSON.parse(JSON.stringify(o));

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
export const sumItems = (items) => (items || []).reduce((a, x) => a + x.price * x.qty, 0);

export function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2400);
}
export function copyText(txt, label) {
  navigator.clipboard.writeText(String(txt)).then(() => toast((label || "복사") + " 완료"), () => toast("길게 눌러서 직접 복사해 주세요"));
}

let actx = null;
document.addEventListener("click", () => {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch {}
});
export function beep() {
  try {
    if (!actx) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + 0.25);
  } catch {}
}

export function setupWarning(root) {
  root.innerHTML = '<div class="card warn"><b>Firebase 설정이 아직 안 됐어요.</b><p>firebase-config.js 파일의 값을 Firebase 콘솔에서 복사한 값으로 바꿔 주세요. 자세한 순서는 README.md에 있어요.</p></div>';
}

// 직원 페이지 로그인. 로그인된 상태에서만 onReady를 부르고, 로그아웃되면 다시 로그인 화면을 보여줘요.
export function needLogin(root, onReady) {
  let started = false;
  onAuthStateChanged(auth, (u) => {
    if (u) {
      if (!started) { started = true; root.innerHTML = ""; onReady(u); }
    } else {
      if (started) { location.reload(); return; }
      root.innerHTML = `<form class="card login" id="lf"><h2>직원 로그인</h2>
        <label class="fld"><span>이메일</span><input id="lf-email" type="email" autocomplete="username" required></label>
        <label class="fld"><span>비밀번호</span><input id="lf-pw" type="password" autocomplete="current-password" required></label>
        <button class="btn" type="submit">로그인</button></form>`;
      $("#lf").addEventListener("submit", async (e) => {
        e.preventDefault();
        try { await signInWithEmailAndPassword(auth, $("#lf-email").value.trim(), $("#lf-pw").value); }
        catch { toast("이메일이나 비밀번호가 맞지 않아요"); }
      });
    }
  });
}
