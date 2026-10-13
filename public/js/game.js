import { ApiError, get, post } from "./api.js";
import { $, activeScreen, alertError, h, isDialogOpen, showDialog, toggle } from "./dom.js";

let match = null;
let carouselIndex = 0;
let pending = false;
let onExit = () => {};

const teamName = (t) => (t === 1 ? match.team1 : t === 2 ? match.team2 : "");

function revealText(item) {
  if (item.secret_text) return item.secret_text;
  if (item.rating != null) return `Rating: ${item.rating}`;
  return "";
}

function roundStatusText(round) {
  if (round.status !== "finished") return "";
  if (round.winner_team) return `${teamName(round.loser_team)} hit the target — ${teamName(round.winner_team)} wins the round`;
  return "Only the target is left — nobody fell for it. Tie!";
}

// ---------- rendering ----------

function renderHeader() {
  const { round } = match;
  const finished = round.status === "finished";
  $("team1Name").textContent = match.team1;
  $("team2Name").textContent = match.team2;
  $("team1Score").textContent = String(match.score1);
  $("team2Score").textContent = String(match.score2);
  $("team1Box").classList.toggle("active", !finished && round.current_team === 1);
  $("team2Box").classList.toggle("active", !finished && round.current_team === 2);

  $("roundCounter").textContent = `Round ${match.round_index + 1} of ${match.total_rounds} · ${round.name}`;
  $("prompt").textContent = round.prompt;
  const status = $("roundStatus");
  status.textContent = roundStatusText(round);
  status.classList.toggle("win", !!round.winner_team);
  status.classList.toggle("tie", finished && !round.winner_team);
  toggle(status, finished);

  toggle($("roundImageFrame"), !!round.image_url);
  if (round.image_url) $("roundImage").src = round.image_url;
  else $("roundImage").removeAttribute("src");

  toggle($("gameNext"), match.has_next && match.status === "active");
  toggle($("showAllBtn"), round.kind === "carousel");
}

function renderList() {
  const { round } = match;
  const finished = round.status === "finished";
  $("itemsList").replaceChildren(
    ...round.items.map((item) => {
      const clickable = !finished && !item.eliminated && match.status === "active";
      const cls = ["item", clickable ? "clickable" : "", item.eliminated ? "isEliminated" : "", item.is_target ? "losingPick" : ""];
      return h(
        "li",
        {
          class: cls.filter(Boolean).join(" "),
          tabindex: clickable ? "0" : null,
          role: clickable ? "button" : null,
          onclick: () => onItem(item),
          onkeydown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onItem(item);
            }
          },
        },
        h(
          "div",
          { class: "itemMain" },
          h("div", { class: "itemTitle" }, item.title),
          revealText(item) ? h("div", { class: "itemMeta" }, revealText(item)) : null,
        ),
        h(
          "div",
          { class: "itemRight" },
          item.eliminated && item.eliminated_by_team ? h("span", { class: "itemBy" }, teamName(item.eliminated_by_team)) : null,
          item.image_url
            ? h(
                "button",
                {
                  class: "btn small glass",
                  type: "button",
                  title: "Show image",
                  onclick: (e) => {
                    e.stopPropagation();
                    reveal(item);
                  },
                },
                "Image",
              )
            : null,
        ),
      );
    }),
  );
}

function renderCarousel() {
  const { round } = match;
  const finished = round.status === "finished";
  if (finished) {
    const idx = round.items.findIndex((x) => x.is_target);
    if (idx >= 0) carouselIndex = idx;
  }
  $("carouselTrack").replaceChildren(
    ...round.items.map((item) =>
      h(
        "div",
        {
          class: ["carouselItem", item.eliminated ? "isEliminated" : "", item.is_target ? "losingPick" : ""].filter(Boolean).join(" "),
          role: "button",
          tabindex: "0",
          dataset: { itemId: item.id },
          onclick: () => onItem(item),
          onkeydown: (e) => {
            if (e.key === "Enter") onItem(item);
          },
        },
        item.image_url ? h("img", { src: item.image_url, alt: item.title, loading: "lazy", draggable: "false" }) : null,
        h("div", { class: "carouselCaption" }, item.title),
        revealText(item) ? h("div", { class: "carouselSecret" }, revealText(item)) : null,
      ),
    ),
  );
  updateCarouselTransform();
}

function visibleCount() {
  const v = parseFloat(getComputedStyle($("carouselFrame")).getPropertyValue("--visible"));
  return Number.isFinite(v) && v > 0 ? v : 5;
}

function updateCarouselTransform() {
  if (!match || match.round.kind !== "carousel") return;
  const track = $("carouselTrack");
  const maxIndex = Math.max(0, match.round.items.length - visibleCount());
  if (carouselIndex > maxIndex) carouselIndex = carouselIndex === maxIndex + 1 ? 0 : maxIndex;
  if (carouselIndex < 0) carouselIndex = maxIndex;
  const first = track.firstElementChild;
  const gap = parseFloat(getComputedStyle(track).columnGap) || 12;
  const step = first ? first.getBoundingClientRect().width + gap : 0;
  track.style.transform = `translateX(${-carouselIndex * step}px)`;
}

function moveCarousel(delta) {
  carouselIndex += delta;
  updateCarouselTransform();
}

function render() {
  if (!match) return;
  renderHeader();
  const carousel = match.round.kind === "carousel";
  toggle($("roundMedia"), carousel);
  toggle($("itemsList"), !carousel);
  if (carousel) renderCarousel();
  else renderList();
  if (!$("showAllOverlay").classList.contains("hidden")) renderShowAll();
}

// ---------- actions ----------

function reveal(item) {
  return showDialog({
    title: item.title,
    text: revealText(item),
    image: item.image_url,
    actions: [{ label: "Close", value: true, variant: "success" }],
  });
}

async function onItem(item) {
  if (pending || !match) return;
  const active = match.round.status === "active" && match.status === "active";
  if (active && !item.eliminated) return eliminate(item.id);
  if (item.image_url || revealText(item)) return reveal(item);
}

async function eliminate(itemId) {
  pending = true;
  document.body.classList.add("busy");
  try {
    match = await post(`/api/matches/${match.id}/eliminate`, { item_id: itemId });
    render();
    const picked = match.round.items.find((i) => i.id === itemId);
    if (picked && match.round.kind !== "carousel" && picked.image_url) await reveal(picked);
    if (match.status === "finished") await showFinal();
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) await refresh();
    else await alertError(e);
  } finally {
    pending = false;
    document.body.classList.remove("busy");
  }
}

async function nextRound() {
  if (pending) return;
  pending = true;
  try {
    match = await post(`/api/matches/${match.id}/next`);
    carouselIndex = 0;
    render();
  } catch (e) {
    await alertError(e);
    await refresh();
  } finally {
    pending = false;
  }
}

async function refresh() {
  if (!match) return;
  try {
    match = await get(`/api/matches/${match.id}`);
    render();
  } catch {
    /* keep the last known state */
  }
}

async function showFinal() {
  const { score1, score2, team1, team2 } = match;
  const title = score1 === score2 ? "It’s a draw!" : `${score1 > score2 ? team1 : team2} wins the match!`;
  const body = h(
    "div",
    { class: "finalScores" },
    h("div", { class: score1 >= score2 ? "lead" : "" }, h("span", {}, team1), h("b", {}, String(score1))),
    h("div", { class: score2 >= score1 ? "lead" : "" }, h("span", {}, team2), h("b", {}, String(score2))),
  );
  const choice = await showDialog({
    title,
    body,
    actions: [
      { label: "Stay here", value: "stay", variant: "secondary" },
      { label: "Back to menu", value: "menu", variant: "success" },
    ],
  });
  if (choice === "menu") onExit();
}

function openShowAll() {
  renderShowAll();
  toggle($("showAllOverlay"), true);
  document.body.classList.add("modalOpen");
}
function closeShowAll() {
  toggle($("showAllOverlay"), false);
  document.body.classList.remove("modalOpen");
}
function renderShowAll() {
  $("showAllGrid").replaceChildren(
    ...match.round.items.map((it) =>
      h(
        "figure",
        { class: `showAllItem${it.eliminated ? " isEliminated" : ""}${it.is_target ? " losingPick" : ""}` },
        it.image_url ? h("img", { src: it.image_url, alt: it.title }) : null,
        h("figcaption", {}, it.title),
      ),
    ),
  );
}

// ---------- public ----------

export function initGame({ onMenu }) {
  onExit = onMenu;
  $("gameMenu").addEventListener("click", onMenu);
  $("gameNext").addEventListener("click", nextRound);
  $("showAllBtn").addEventListener("click", openShowAll);
  $("showAllClose").addEventListener("click", closeShowAll);
  $("carouselPrev").addEventListener("click", () => moveCarousel(-1));
  $("carouselNext").addEventListener("click", () => moveCarousel(1));
  window.addEventListener("resize", updateCarouselTransform);

  document.addEventListener("keydown", (e) => {
    if (activeScreen() !== "screenGame" || isDialogOpen()) return;
    if (e.key === "Escape" && !$("showAllOverlay").classList.contains("hidden")) closeShowAll();
    if (match?.round.kind !== "carousel" || e.target.closest?.("input,textarea,select")) return;
    if (e.key === "ArrowLeft") moveCarousel(-1);
    if (e.key === "ArrowRight") moveCarousel(1);
  });

  // Touch swipe for the carousel.
  let startX = null;
  const vp = $("carouselViewport");
  vp.addEventListener("touchstart", (e) => (startX = e.touches[0].clientX), { passive: true });
  vp.addEventListener(
    "touchend",
    (e) => {
      if (startX == null) return;
      const dx = e.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) > 40) moveCarousel(dx < 0 ? 1 : -1);
    },
    { passive: true },
  );

  // Another device may be driving the same match: resync when we come back.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && activeScreen() === "screenGame") refresh();
  });
}

export function showGame(m) {
  match = m;
  carouselIndex = 0;
  closeShowAll();
  render();
}

export const currentMatchId = () => match?.id ?? null;
