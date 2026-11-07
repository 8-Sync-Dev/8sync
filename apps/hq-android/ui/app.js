// Connect screen. Validation and navigation live in Rust (src-tauri/src/lib.rs):
// `hq_origin` checks the address and returns only its origin (what "Gần đây"
// remembers — never the path or the `?k=` login token), then `open_hq` loads HQ.
const { invoke } = window.__TAURI__.core;
const KEY = "hq.recent";
const MAX_RECENT = 5;

const form = document.getElementById("connect");
const input = document.getElementById("address");
const button = document.getElementById("open");
const error = document.getElementById("error");
const recentWrap = document.getElementById("recent-wrap");
const recentList = document.getElementById("recent");

function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter((o) => typeof o === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(list) {
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}

function showError(message) {
  error.textContent = message;
  error.hidden = !message;
  input.setAttribute("aria-invalid", message ? "true" : "false");
}

async function open(address) {
  showError("");
  button.disabled = true;
  button.textContent = "Đang mở…";
  try {
    const origin = await invoke("hq_origin", { address });
    saveRecent([origin, ...loadRecent().filter((o) => o !== origin)]);
    await invoke("open_hq", { address });
  } catch (e) {
    showError(String(e));
    button.disabled = false;
    button.textContent = "Mở HQ";
  }
}

function renderRecent() {
  const list = loadRecent();
  recentList.replaceChildren(
    ...list.map((origin) => {
      const li = document.createElement("li");
      const go = document.createElement("button");
      go.type = "button";
      go.className = "go";
      go.textContent = origin.replace(/^https:\/\//, "");
      go.addEventListener("click", () => open(origin));
      const forget = document.createElement("button");
      forget.type = "button";
      forget.className = "forget";
      forget.textContent = "×";
      forget.setAttribute("aria-label", `Quên ${origin}`);
      forget.addEventListener("click", () => {
        saveRecent(loadRecent().filter((o) => o !== origin));
        renderRecent();
      });
      li.append(go, forget);
      return li;
    }),
  );
  recentWrap.hidden = list.length === 0;
  if (!input.value && list[0]) input.value = list[0];
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  open(input.value);
});
input.addEventListener("input", () => showError(""));

// Back from HQ restores this page from the bfcache: re-enable the button.
window.addEventListener("pageshow", () => {
  button.disabled = false;
  button.textContent = "Mở HQ";
});

renderRecent();
