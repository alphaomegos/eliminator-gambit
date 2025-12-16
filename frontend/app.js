let round = null;

const el = (id) => document.getElementById(id);

function setActiveTeam(team) {
  el("team1").classList.toggle("active", team === 1);
  el("team2").classList.toggle("active", team === 2);
}

function openModal(title, text) {
  el("modalTitle").textContent = title;
  el("modalText").innerHTML = text;
  el("modal").classList.remove("hidden");
}

function closeModal() {
  el("modal").classList.add("hidden");
}

function escapeHtml(s) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function render() {
  if (!round) return;

  el("prompt").textContent = round.prompt;
  setActiveTeam(round.current_team);

  const list = el("itemsList");
  list.innerHTML = "";

  const isFinished = round.status === "finished";

  for (const item of round.items) {
    const li = document.createElement("li");
    li.className = "item";

    const left = document.createElement("div");
    const title = document.createElement("div");
    title.className = "itemTitle";
    title.textContent = item.title;

    const meta = document.createElement("div");
    meta.className = "itemMeta";

    if (item.rating != null) {
      const flags = [];
      if (isFinished && item.is_target) flags.push("TARGET");
      meta.textContent = `Rating: ${item.rating}${flags.length ? " • " + flags.join(", ") : ""}`;
    } else {
      meta.textContent = "Rating hidden";
    }


    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "10px";
    right.style.alignItems = "center";

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = item.eliminated ? "Eliminated" : "Active";
    right.appendChild(badge);

    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "Eliminate";
    btn.disabled = item.eliminated || isFinished;

    if (item.eliminated) {
      title.classList.add("eliminated");
      badge.classList.add("danger");
    } else {
      badge.classList.add("ok");
    }

    btn.addEventListener("click", async () => {
      await eliminate(item.id);
    });

    right.appendChild(btn);

    li.appendChild(left);
    li.appendChild(right);
    list.appendChild(li);
  }

  if (isFinished) {
    const title = round.winner_team ? `Team ${round.winner_team} wins!` : "Round finished";
    const loser = round.loser_team ? `Team ${round.loser_team} loses.` : "";
    const target = round.items.find((x) => x.is_target);
    const targetLine = target
      ? `The target was: <b>${escapeHtml(target.title)}</b> (rating ${target.rating}).`
      : "Target not found.";

    el("statusLine").textContent = "Round finished. Ratings revealed.";
    openModal(title, `${loser}<br/><br/>${targetLine}`);
  } else {
    el("statusLine").textContent = `Round active. Team ${round.current_team} to play.`;
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data && data.detail) msg = data.detail;
    } catch (_) {}
    throw new Error(msg);
  }

  return res.json();
}

async function loadCategories() {
  const data = await api("/api/categories");
  const select = el("categorySelect");
  select.innerHTML = "";

  for (const c of data.categories) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  }
}

async function newRound() {
  closeModal();
  const category = el("categorySelect").value || "movies";
  round = await api("/api/rounds", {
    method: "POST",
    body: JSON.stringify({ category }),
  });
  render();
}

async function eliminate(itemId) {
  try {
    round = await api(`/api/rounds/${round.id}/eliminate`, {
      method: "POST",
      body: JSON.stringify({ item_id: itemId }),
    });
    render();
  } catch (e) {
    openModal("Error", escapeHtml(String(e.message || e)));
  }
}

function wireUI() {
  el("newRoundBtn").addEventListener("click", newRound);
  el("modalClose").addEventListener("click", closeModal);
  el("modalNewRound").addEventListener("click", newRound);

  el("modal").addEventListener("click", (evt) => {
    if (evt.target === el("modal")) closeModal();
  });
}

(async function init() {
  wireUI();
  await loadCategories();
  await newRound();
})();

