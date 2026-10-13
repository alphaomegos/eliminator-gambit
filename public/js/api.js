// HTTP client + session storage.

const TOKEN_KEY = "eg.token";
const SET_KEY = "eg.gameSet";

function safeGet(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
function safeSet(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private mode etc. */
  }
}

export const session = {
  token: safeGet(TOKEN_KEY),
  gameSet: safeGet(SET_KEY),
  set(token, gameSet) {
    this.token = token || "";
    this.gameSet = gameSet || "";
    safeSet(TOKEN_KEY, this.token);
    safeSet(SET_KEY, this.gameSet);
  },
  clear() {
    this.set("", "");
  },
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Called when the server says the session is gone (set by main.js). */
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

export async function api(path, { method = "GET", body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (session.token) h.authorization = `Bearer ${session.token}`;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) {
    payload = JSON.stringify(body);
    h["content-type"] = "application/json";
  }

  let res;
  try {
    res = await fetch(path, { method, headers: h, body: payload });
  } catch {
    throw new ApiError(0, "Network error — check your connection.");
  }

  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && session.token && !path.startsWith("/api/auth/")) onUnauthorized();
    throw new ApiError(res.status, data?.detail || `${res.status} ${res.statusText}`);
  }
  return data;
}

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: "POST", body });
export const put = (path, body) => api(path, { method: "PUT", body });
export const del = (path) => api(path, { method: "DELETE" });
