const STORAGE_KEY = "blackjuice.posts.v1";
const ANALYTICS_KEY = "blackjuice.analytics.v1";
const DRAFT_KEY = "blackjuice.creatorDraft.v1";
const CREATOR_SESSION_KEY = "blackjuice.creatorSession.v1";
const CREATOR_PASSWORD_HASH = "e92674ce3b32871686eec4b520726b13e56a149cbd8af0d78f4737f486ea2487";
const CREATOR_SESSION_DURATION = 12 * 60 * 60 * 1000;
const COVER_MAX_EDGE = 1600;
const COVER_MAX_DATA_URL_LENGTH = 2_400_000;
const STORAGE_DATABASE = "blackjuice.creator.v1";
const STORAGE_OBJECT_STORE = "values";
const volatileStorage = new Map();
let storageDatabasePromise = null;

const demoPostIds = new Set([
  "manifesto-liquido",
  "citta-sintetiche",
  "manuale-notturno",
  "interfacce-calme",
]);

let appState = {
  posts: [],
  analytics: { events: [] },
  draft: null,
  currentPostId: null,
  routeStartedAt: Date.now(),
};

async function loadPosts() {
  const stored = await readPersistentJson(STORAGE_KEY);
  if (Array.isArray(stored)) {
    const posts = stored.filter((post) => !demoPostIds.has(post.id));
    if (posts.length !== stored.length) writeJson(STORAGE_KEY, posts);
    return posts;
  }
  writeJson(STORAGE_KEY, []);
  return [];
}

async function loadAnalytics() {
  const stored = await readPersistentJson(ANALYTICS_KEY);
  if (stored && Array.isArray(stored.events)) {
    const events = stored.events.filter((event) => !demoPostIds.has(event.postId));
    if (events.length !== stored.events.length) writeJson(ANALYTICS_KEY, { events });
    return { events };
  }
  const analytics = { events: [] };
  writeJson(ANALYTICS_KEY, analytics);
  return analytics;
}

function readJson(key) {
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) return JSON.parse(stored);
  } catch (error) {
    // Fall through to session-only data when browser storage is unavailable.
  }
  return volatileStorage.get(key) ?? null;
}

async function readPersistentJson(key) {
  const indexedValue = await readIndexedJson(key);
  return indexedValue ?? readJson(key);
}

function writeJson(key, value) {
  volatileStorage.set(key, value);
  if (key === DRAFT_KEY) appState.draft = value;

  let storedLocally = false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    volatileStorage.delete(key);
    storedLocally = true;
  } catch (error) {
    // IndexedDB handles larger creator payloads, including cover images.
  }

  void writeIndexedJson(key, value);
  return storedLocally || supportsIndexedDb();
}

function removeJson(key) {
  volatileStorage.delete(key);
  if (key === DRAFT_KEY) appState.draft = null;
  try {
    localStorage.removeItem(key);
  } catch (error) {
    // The in-memory copy is already removed.
  }
  void removeIndexedJson(key);
}

function supportsIndexedDb() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openStorageDatabase() {
  if (!supportsIndexedDb()) return Promise.resolve(null);
  if (storageDatabasePromise) return storageDatabasePromise;

  storageDatabasePromise = new Promise((resolve) => {
    const request = window.indexedDB.open(STORAGE_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORAGE_OBJECT_STORE)) {
        request.result.createObjectStore(STORAGE_OBJECT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return storageDatabasePromise;
}

async function readIndexedJson(key) {
  const database = await openStorageDatabase();
  if (!database) return null;

  return new Promise((resolve) => {
    const request = database.transaction(STORAGE_OBJECT_STORE, "readonly").objectStore(STORAGE_OBJECT_STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
  });
}

async function writeIndexedJson(key, value) {
  const database = await openStorageDatabase();
  if (!database) return false;

  return new Promise((resolve) => {
    const transaction = database.transaction(STORAGE_OBJECT_STORE, "readwrite");
    transaction.objectStore(STORAGE_OBJECT_STORE).put(value, key);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);
  });
}

async function removeIndexedJson(key) {
  const database = await openStorageDatabase();
  if (!database) return false;

  return new Promise((resolve) => {
    const transaction = database.transaction(STORAGE_OBJECT_STORE, "readwrite");
    transaction.objectStore(STORAGE_OBJECT_STORE).delete(key);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);
  });
}

function persistPosts() {
  return writeJson(STORAGE_KEY, appState.posts);
}

function persistAnalytics() {
  return writeJson(ANALYTICS_KEY, appState.analytics);
}

function publishedPosts() {
  return appState.posts
    .filter((post) => post.status === "published")
    .sort((a, b) => new Date(`${b.date}T${b.time || "00:00"}`) - new Date(`${a.date}T${a.time || "00:00"}`));
}

function collectionGroups(posts) {
  const groups = new Map();

  posts.forEach((post) => {
    const name = String(post.collection || "").trim();
    const id = slugify(name);
    if (!id) return;

    const group = groups.get(id) || { id, name, posts: [] };
    group.posts.push(post);
    groups.set(id, group);
  });

  return [...groups.values()].sort((a, b) => b.posts.length - a.posts.length || a.name.localeCompare(b.name, "it"));
}

function formatDate(value, withYear = true) {
  if (!value) return "";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    year: withYear ? "numeric" : undefined,
  }).format(new Date(`${value}T12:00:00`));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
}

function initials(value) {
  return value
    .split(/\s+/)
    .map((chunk) => chunk[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function coverMarkup(post, size = "regular") {
  if (post.image) {
    return `<img class="cover-image" src="${post.image}" alt="">`;
  }

  return `
    <div class="cover-art cover-${post.coverTone || "ink"} cover-${size}" style="--accent:${post.accent || "#111111"}">
      <span>${escapeHtml(post.category || "Note")}</span>
      <strong>${escapeHtml(initials(post.title || "BJ"))}</strong>
    </div>
  `;
}

function metaLine(post) {
  return `
    <div class="meta-line">
      <span>${escapeHtml(formatDate(post.date))}</span>
      <span>${escapeHtml(post.category)}</span>
      <span>${escapeHtml(post.readingMinutes || estimateReadMinutes(post.body))} min</span>
    </div>
  `;
}

function estimateReadMinutes(text = "") {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 210));
}

function route() {
  const hash = window.location.hash || "#home";
  if (hash.startsWith("#post/")) {
    renderPost(hash.replace("#post/", ""));
    return;
  }

  if (hash.startsWith("#collection/")) {
    renderHome("archive", slugify(hash.replace("#collection/", "")));
    return;
  }

  if (hash === "#creator") {
    if (isCreatorAuthorized()) {
      renderCreator();
    } else {
      renderCreatorAccess();
    }
    return;
  }

  if (hash === "#archive") {
    renderHome("archive");
    return;
  }

  if (hash === "#newsletter") {
    renderHome("newsletter");
    return;
  }

  renderHome();
}

function mount(shell) {
  document.getElementById("app").innerHTML = shell;
  bindGlobalNav();
  setupMotion();
}

function headerMarkup(active = "home") {
  return `
    <header class="site-header">
      <nav class="top-nav" aria-label="Navigazione principale">
        <a class="${active === "home" ? "is-active" : ""}" href="#home">Home</a>
        <a href="#archive">Archivio</a>
        <a class="${active === "creator" ? "is-active" : ""}" href="#creator">Creator</a>
      </nav>
      <a class="brand-lockup" href="#home" aria-label="BlackJuice home">BlackJuice.net</a>
      <a class="header-action" href="#newsletter">Iscriviti</a>
    </header>
  `;
}

function footerMarkup() {
  return `
    <footer class="site-footer">
      <a class="brand-lockup footer-brand" href="#home">BlackJuice.net</a>
      <nav aria-label="Footer">
        <a href="#home">Home</a>
        <a href="#archive">Archivio</a>
        <a href="#creator">Creator</a>
      </nav>
    </footer>
  `;
}

function renderHome(scrollTarget, selectedCollectionId = "") {
  trackRouteLeave();
  appState.currentPostId = null;
  const allPosts = publishedPosts();
  const collections = collectionGroups(allPosts);
  const activeCollection = collections.find((collection) => collection.id === selectedCollectionId) || null;
  const posts = activeCollection ? activeCollection.posts : allPosts;
  const [lead, second, third] = posts;

  mount(`
    ${headerMarkup("home")}
    <main class="public-home">
      <section class="home-heading">
        <p>BLACKJUICE.NET</p>
        <h1>BlackJuice</h1>
      </section>

      <section class="front-grid" data-scroll-widget aria-label="Pubblicazioni in evidenza">
        ${lead ? frontArticleCard(lead, "primary") : emptyState("Nessuna pubblicazione", "front-empty")}
        ${
          lead
            ? `<div class="front-side">
                ${second ? frontArticleCard(second, "secondary") : ""}
                ${third ? frontArticleCard(third, "secondary") : ""}
              </div>`
            : ""
        }
      </section>

      <section class="collections-section" id="collections" data-reveal>
        <div class="section-label">
          <h2>Raccolte</h2>
          <span>${collections.length}</span>
        </div>
        <div class="collection-grid">
          ${collections.length ? collections.map((collection) => collectionCard(collection, activeCollection?.id)).join("") : emptyState("Nessuna raccolta", "collection-empty")}
        </div>
      </section>

      <section class="feed-section" id="archive" data-reveal>
        <div class="section-label">
          <h2>${escapeHtml(activeCollection?.name || "Pubblicazioni")}</h2>
          <div class="section-tools">
            <span>${posts.length}</span>
            ${activeCollection ? '<a class="collection-clear" href="#home">Tutte</a>' : ""}
          </div>
        </div>
        <div class="article-feed">
          ${posts.length ? posts.slice(0, 9).map(articleCard).join("") : emptyState("Archivio vuoto", "feed-empty")}
        </div>
      </section>

      <section class="newsletter-band" id="newsletter" data-reveal>
        <p>Newsletter</p>
        <form class="subscribe-inline" id="footerSubscribe">
          <input type="email" placeholder="email@example.com" aria-label="Email" required>
          <button class="pill-button light" type="submit">Iscriviti</button>
        </form>
      </section>
    </main>
    ${footerMarkup()}
  `);

  document.querySelectorAll(".subscribe-inline").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      toast("Iscrizione salvata per la preview.");
      form.reset();
    });
  });

  if (scrollTarget) {
    requestAnimationFrame(() => document.getElementById(scrollTarget)?.scrollIntoView({ behavior: "smooth" }));
  }
}

function frontArticleCard(post, size) {
  return `
    <article class="front-article front-article-${size}" data-reveal>
      <a href="#post/${post.id}" class="front-cover" aria-label="${escapeHtml(post.title)}">
        ${coverMarkup(post, size === "primary" ? "front" : "small")}
      </a>
      <div class="front-copy">
        ${metaLine(post)}
        <h2><a href="#post/${post.id}">${escapeHtml(post.title)}</a></h2>
        ${post.subtitle ? `<p>${escapeHtml(post.subtitle)}</p>` : ""}
        ${post.author ? `<span>${escapeHtml(post.author)}</span>` : ""}
      </div>
    </article>
  `;
}

function articleCard(post) {
  return `
    <article class="essay-card" data-reveal>
      <a href="#post/${post.id}" class="essay-cover" aria-label="${escapeHtml(post.title)}">
        ${coverMarkup(post, "regular")}
      </a>
      <div class="essay-copy">
        ${metaLine(post)}
        <h3><a href="#post/${post.id}">${escapeHtml(post.title)}</a></h3>
        ${post.subtitle ? `<p>${escapeHtml(post.subtitle)}</p>` : ""}
        ${post.author ? `<span>${escapeHtml(post.author)}</span>` : ""}
      </div>
    </article>
  `;
}

function collectionCard(collection, activeCollectionId) {
  const isActive = collection.id === activeCollectionId;
  const totalLabel = collection.posts.length === 1 ? "1 pubblicazione" : `${collection.posts.length} pubblicazioni`;

  return `
    <a class="collection-card ${isActive ? "is-active" : ""}" href="#collection/${collection.id}" ${isActive ? 'aria-current="page"' : ""}>
      <div class="collection-card-heading">
        <p>Raccolta</p>
        <span>${escapeHtml(totalLabel)}</span>
      </div>
      <h3>${escapeHtml(collection.name)}</h3>
      <div class="collection-covers" aria-hidden="true">
        ${collection.posts.slice(0, 3).map(collectionCoverThumb).join("")}
      </div>
    </a>
  `;
}

function collectionCoverThumb(post) {
  if (post.image) {
    return `<img src="${post.image}" alt="">`;
  }

  return `<span class="collection-cover-thumb tone-${escapeHtml(post.coverTone || "ink")}">${escapeHtml(initials(post.title || "BJ"))}</span>`;
}

function emptyState(title, className = "") {
  return `<div class="empty-state ${escapeHtml(className)}"><p>${escapeHtml(title)}</p></div>`;
}

function archiveRow(post) {
  return `
    <a class="archive-row" href="#post/${post.id}">
      <span>${escapeHtml(formatDate(post.date, false))}</span>
      <strong>${escapeHtml(post.title)}</strong>
      <em>${escapeHtml(post.category)}</em>
    </a>
  `;
}

function renderPost(postId) {
  trackRouteLeave();
  const post = appState.posts.find((item) => item.id === postId);
  if (!post || post.status !== "published") {
    renderHome();
    toast("Pubblicazione non trovata.");
    return;
  }

  appState.currentPostId = post.id;
  appState.routeStartedAt = Date.now();
  appState.analytics.events.push({
    postId: post.id,
    type: "view",
    ts: Date.now(),
    readSeconds: 0,
    staySeconds: 0,
    completed: false,
  });
  persistAnalytics();

  const paragraphs = post.body
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");

  mount(`
    ${headerMarkup("home")}
    <main class="article-page">
      <article>
        <header class="article-hero">
          <div>
            <a class="back-link" href="#home">Archivio</a>
            <p class="eyebrow">${escapeHtml(post.category)}</p>
            <h1>${escapeHtml(post.title)}</h1>
            <p>${escapeHtml(post.subtitle)}</p>
            <div class="article-meta-panel">
              <span>${escapeHtml(formatDate(post.date))}</span>
              <span>${escapeHtml(post.time || "")}</span>
              <span>${escapeHtml(post.place || "")}</span>
              <span>${escapeHtml(post.readingMinutes || estimateReadMinutes(post.body))} min read</span>
            </div>
          </div>
          <div class="article-cover">
            ${coverMarkup(post, "large")}
          </div>
        </header>

        <div class="article-body">
          ${paragraphs}
        </div>

        ${
          post.links?.length
            ? `<aside class="related-links"><h2>Link correlati</h2>${post.links
                .map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`)
                .join("")}</aside>`
            : ""
        }
      </article>
    </main>
    ${footerMarkup()}
  `);
}

function renderCreator() {
  trackRouteLeave();
  appState.currentPostId = null;
  const draft = appState.draft || readJson(DRAFT_KEY) || createEmptyDraft();
  const metrics = computeMetrics(30);

  mount(`
    ${headerMarkup("creator")}
    <main class="creator-shell">
      <section class="creator-rail">
        <div>
          <p class="eyebrow">Creator studio</p>
          <h1>Creator</h1>
        </div>
        <nav class="creator-tabs" aria-label="Creator sections">
          <a href="#creator" data-creator-target="composer">Composer</a>
          <a href="#creator" data-creator-target="analytics">Analytics</a>
          <a href="#creator" data-creator-target="library">Library</a>
        </nav>
      </section>

      <section class="creator-grid">
        <form class="composer-panel" id="composer" data-reveal>
          <div class="panel-heading">
            <div>
              <p class="eyebrow">New publication</p>
              <h2>Scrivi e pubblica</h2>
            </div>
            <div class="button-row">
              <button class="icon-button" type="button" id="resetDraft" aria-label="Nuova bozza" title="Nuova bozza">+</button>
              <button class="pill-button ghost" type="button" id="saveDraft">Salva bozza</button>
              <button class="pill-button dark" type="button" id="publishPost">Pubblica</button>
            </div>
          </div>

          <input type="hidden" name="id" value="${escapeHtml(draft.id || "")}">
          <div class="field-grid">
            ${field("title", "Titolo", draft.title, "text", "Titolo della pubblicazione")}
            ${field("subtitle", "Sottotitolo", draft.subtitle)}
            ${field("category", "Categoria", draft.category)}
            ${field("collection", "Raccolta", draft.collection)}
            ${field("author", "Autore", draft.author)}
            ${field("date", "Data", draft.date, "date")}
            ${field("time", "Ora", draft.time, "time")}
            ${field("place", "Luogo", draft.place)}
            ${field("readingMinutes", "Minuti", draft.readingMinutes, "number")}
          </div>

          <label class="field full">
            <span>Immagine di copertina</span>
            <input name="image" type="file" accept="image/*">
          </label>

          <label class="field full">
            <span>Link correlati</span>
            <textarea name="links" rows="3" placeholder="Etichetta | https://...">${escapeHtml(formatLinksForTextarea(draft.links))}</textarea>
          </label>

          <label class="field full">
            <span>Testo</span>
            <textarea name="body" rows="12" placeholder="Inizia a scrivere...">${escapeHtml(draft.body)}</textarea>
          </label>

          <div class="preview-panel" id="livePreview">
            ${creatorPreview(draft)}
          </div>
        </form>

        <aside class="analytics-panel" id="analytics" data-reveal>
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Analytics</p>
              <h2>Segnali principali</h2>
            </div>
            <select id="analyticsSpan" aria-label="Intervallo analytics">
              <option value="7">7 giorni</option>
              <option value="30" selected>30 giorni</option>
              <option value="90">90 giorni</option>
              <option value="all">Sempre</option>
            </select>
          </div>
          <div id="metricsRoot">
            ${metricsMarkup(metrics)}
          </div>
        </aside>
      </section>

      <section class="library-panel" id="library" data-reveal>
        <div class="section-heading">
          <p class="eyebrow">Library</p>
          <h2>Pubblicazioni e bozze</h2>
        </div>
        <div class="library-list">
          ${appState.posts.length ? appState.posts.map(libraryRow).join("") : emptyState("Nessuna pubblicazione", "library-empty")}
        </div>
      </section>
    </main>
  `);

  bindCreator();
}

function renderCreatorAccess() {
  trackRouteLeave();
  appState.currentPostId = null;

  mount(`
    ${headerMarkup("creator")}
    <main class="creator-access-shell">
      <section class="creator-access-panel" data-reveal>
        <p class="eyebrow">Creator</p>
        <h1>Accesso riservato</h1>
        <form id="creatorAccessForm">
          <label class="field">
            <span>Password</span>
            <input id="creatorPassword" name="password" type="password" autocomplete="current-password" required autofocus>
          </label>
          <button class="pill-button light" type="submit">Accedi</button>
          <p class="access-feedback" id="creatorAccessFeedback" aria-live="polite"></p>
        </form>
      </section>
    </main>
  `);

  document.getElementById("creatorAccessForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = document.getElementById("creatorPassword").value;
    const feedback = document.getElementById("creatorAccessFeedback");

    if (await passwordMatches(password)) {
      sessionStorage.setItem(CREATOR_SESSION_KEY, String(Date.now() + CREATOR_SESSION_DURATION));
      feedback.textContent = "Accesso effettuato.";
      renderCreator();
      return;
    }

    feedback.textContent = "Password non corretta.";
    document.getElementById("creatorPassword").select();
  });
}

function isCreatorAuthorized() {
  const expiresAt = Number(sessionStorage.getItem(CREATOR_SESSION_KEY));
  if (expiresAt > Date.now()) return true;
  sessionStorage.removeItem(CREATOR_SESSION_KEY);
  return false;
}

async function passwordMatches(password) {
  if (!window.crypto?.subtle) return false;
  const bytes = new TextEncoder().encode(password);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  const actualHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return actualHash === CREATOR_PASSWORD_HASH;
}

function field(name, label, value, type = "text", placeholder = "") {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value ?? "")}" placeholder="${escapeHtml(placeholder)}">
    </label>
  `;
}

function createEmptyDraft() {
  return {
    id: "",
    title: "",
    subtitle: "",
    category: "",
    collection: "",
    author: "",
    date: new Date().toISOString().slice(0, 10),
    time: "09:00",
    place: "",
    readingMinutes: "",
    accent: "#111111",
    coverTone: "ink",
    image: "",
    links: [],
    body: "",
  };
}

function getFormDraft(form) {
  const data = new FormData(form);
  const title = String(data.get("title") || "").trim();
  const existingId = String(data.get("id") || "").trim();
  const body = normalizeArticleText(String(data.get("body") || "")).trim();
  const readingMinutes = Number(data.get("readingMinutes")) || estimateReadMinutes(body);
  const category = String(data.get("category") || "").trim();
  const collection = String(data.get("collection") || "").trim();

  return {
    id: existingId || slugify(title || `pubblicazione-${Date.now()}`),
    status: "draft",
    title,
    subtitle: String(data.get("subtitle") || "").trim(),
    category,
    collection,
    author: String(data.get("author") || "").trim(),
    date: String(data.get("date") || new Date().toISOString().slice(0, 10)),
    time: String(data.get("time") || "09:00"),
    place: String(data.get("place") || "").trim(),
    readingMinutes,
    accent: categoryAccent(category),
    coverTone: toneFromCategory(category),
    image: form.dataset.coverImage || "",
    links: parseLinks(String(data.get("links") || "")),
    body,
  };
}

function normalizeArticleText(value = "") {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

async function createCoverDataUrl(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Scegli un file immagine per la copertina.");
  }

  if (file.type === "image/gif" || file.type === "image/svg+xml" || !("createImageBitmap" in window)) {
    const dataUrl = await readFileAsDataUrl(file);
    if (dataUrl.length > COVER_MAX_DATA_URL_LENGTH) {
      throw new Error("L'immagine e troppo grande per essere salvata nel browser. Usa una copertina piu leggera.");
    }
    return dataUrl;
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, COVER_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const dataUrl = canvas.toDataURL("image/webp", 0.82);
  if (dataUrl.length > COVER_MAX_DATA_URL_LENGTH) {
    throw new Error("L'immagine e troppo grande per essere salvata nel browser. Usa una copertina piu leggera.");
  }
  return dataUrl;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Impossibile leggere l'immagine selezionata."));
    };
    reader.onerror = () => reject(new Error("Impossibile leggere l'immagine selezionata."));
    reader.readAsDataURL(file);
  });
}

function storageWarning() {
  return "Spazio browser insufficiente: la modifica resta attiva solo in questa sessione.";
}

function categoryAccent(category = "") {
  const key = category.toLowerCase();
  if (key.includes("metodo")) return "#2f6f64";
  if (key.includes("design")) return "#5f5b91";
  if (key.includes("taccuino")) return "#111111";
  return "#c44521";
}

function toneFromCategory(category = "") {
  const key = category.toLowerCase();
  if (key.includes("metodo")) return "green";
  if (key.includes("design")) return "violet";
  if (key.includes("taccuino")) return "ink";
  return "signal";
}

function parseLinks(value) {
  return value
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [label, url] = row.split("|").map((part) => part.trim());
      return {
        label: label || url,
        url: url || label,
      };
    })
    .filter((link) => link.url);
}

function formatLinksForTextarea(links = []) {
  return links.map((link) => `${link.label} | ${link.url}`).join("\n");
}

function creatorPreview(post) {
  const previewPost = {
    ...post,
    title: post.title || "Anteprima",
    subtitle: post.subtitle || "",
    category: post.category || "",
    author: post.author || "",
    date: post.date || new Date().toISOString().slice(0, 10),
  };

  return `
    <article class="mini-preview">
      ${coverMarkup(previewPost, "small")}
      <div>
        ${metaLine(previewPost)}
        <h3>${escapeHtml(previewPost.title)}</h3>
        <p>${escapeHtml(previewPost.subtitle)}</p>
      </div>
    </article>
  `;
}

function libraryRow(post) {
  const details = [formatDate(post.date), post.collection, post.category, post.place || "Nessun luogo"]
    .filter(Boolean)
    .map((value) => escapeHtml(value))
    .join(" · ");

  return `
    <article class="library-row" data-post-id="${escapeHtml(post.id)}">
      <div>
        <span class="status-dot ${post.status}">${escapeHtml(post.status)}</span>
        <h3>${escapeHtml(post.title || "Senza titolo")}</h3>
        <p>${details}</p>
      </div>
      <div class="button-row">
        ${post.status === "published" ? `<a class="pill-button ghost" href="#post/${post.id}">Apri</a>` : ""}
        <button class="pill-button ghost" type="button" data-edit="${escapeHtml(post.id)}">Modifica</button>
        <button class="pill-button ghost" type="button" data-toggle="${escapeHtml(post.id)}">
          ${post.status === "published" ? "Rendi bozza" : "Pubblica"}
        </button>
      </div>
    </article>
  `;
}

function metricsMarkup(metrics) {
  return `
    <div class="metric-grid">
      <article>
        <span>Visite</span>
        <strong>${metrics.views}</strong>
      </article>
      <article>
        <span>Lettura media</span>
        <strong>${metrics.avgRead}m</strong>
      </article>
      <article>
        <span>Permanenza</span>
        <strong>${metrics.avgStay}m</strong>
      </article>
      <article>
        <span>Completamento</span>
        <strong>${metrics.completion}%</strong>
      </article>
    </div>
    <div class="sparkline" aria-label="Visite nel tempo">
      ${metrics.buckets
        .map((bucket) => `<span style="height:${Math.max(8, bucket)}%"></span>`)
        .join("")}
    </div>
    <div class="top-posts">
      ${metrics.topPosts
        .map(
          (item) => `
            <div>
              <span>${escapeHtml(item.title)}</span>
              <strong>${item.views}</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function computeMetrics(span) {
  const now = Date.now();
  const spanDays = span === "all" ? Infinity : Number(span);
  const cutoff = spanDays === Infinity ? 0 : now - spanDays * 86400000;
  const events = appState.analytics.events.filter((event) => event.ts >= cutoff);
  const views = events.length;
  const avgRead = views ? Math.round(events.reduce((sum, event) => sum + (event.readSeconds || 0), 0) / views / 60) : 0;
  const avgStay = views ? Math.round(events.reduce((sum, event) => sum + (event.staySeconds || 0), 0) / views / 60) : 0;
  const completion = views ? Math.round((events.filter((event) => event.completed).length / views) * 100) : 0;
  const bucketCount = 14;
  const buckets = Array.from({ length: bucketCount }, () => 0);
  const windowMs = spanDays === Infinity ? 90 * 86400000 : spanDays * 86400000;
  events.forEach((event) => {
    const position = Math.min(bucketCount - 1, Math.floor(((now - event.ts) / windowMs) * bucketCount));
    buckets[bucketCount - 1 - position] += 1;
  });
  const maxBucket = Math.max(1, ...buckets);
  const scaledBuckets = buckets.map((bucket) => Math.round((bucket / maxBucket) * 100));

  const byPost = events.reduce((map, event) => {
    map[event.postId] = (map[event.postId] || 0) + 1;
    return map;
  }, {});
  const topPosts = Object.entries(byPost)
    .map(([postId, count]) => ({
      title: appState.posts.find((post) => post.id === postId)?.title || postId,
      views: count,
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 4);

  return {
    views,
    avgRead,
    avgStay,
    completion,
    buckets: scaledBuckets,
    topPosts,
  };
}

function bindCreator() {
  const form = document.getElementById("composer");
  const previewRoot = document.getElementById("livePreview");
  const fileInput = form.elements.image;
  const bodyInput = form.elements.body;
  const creatorShell = document.querySelector(".creator-shell");
  const savedDraft = appState.draft || readJson(DRAFT_KEY);
  if (savedDraft?.image) {
    form.dataset.coverImage = savedDraft.image;
  }

  document.querySelectorAll("[data-creator-target]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      document.getElementById(link.dataset.creatorTarget)?.scrollIntoView({ behavior: "smooth" });
    });
  });

  form.addEventListener("input", () => {
    const draft = getFormDraft(form);
    previewRoot.innerHTML = creatorPreview(draft);
    writeJson(DRAFT_KEY, draft);
  });

  bodyInput.addEventListener("paste", (event) => {
    const pastedText = event.clipboardData?.getData("text/plain");
    if (pastedText === undefined) return;

    event.preventDefault();
    const cleanedText = normalizeArticleText(pastedText);
    bodyInput.setRangeText(cleanedText, bodyInput.selectionStart, bodyInput.selectionEnd, "end");
    bodyInput.dispatchEvent(new Event("input", { bubbles: true }));
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    createCoverDataUrl(file)
      .then((image) => {
        form.dataset.coverImage = image;
        const draft = getFormDraft(form);
        previewRoot.innerHTML = creatorPreview(draft);
        if (!writeJson(DRAFT_KEY, draft)) toast(storageWarning());
      })
      .catch((error) => {
        fileInput.value = "";
        toast(error.message);
      });
  });

  creatorShell.addEventListener("click", (event) => {
    const button = event.target.closest?.("button");
    if (!button) return;

    if (button.id === "saveDraft") {
      const draft = getFormDraft(form);
      if (!draft.title) {
        toast("Aggiungi un titolo prima di salvare.");
        return;
      }
      const postPersisted = upsertPost(draft);
      const draftPersisted = writeJson(DRAFT_KEY, draft);
      renderCreator();
      toast(postPersisted && draftPersisted ? "Bozza salvata." : storageWarning());
      return;
    }

    if (button.id === "publishPost") {
      const post = { ...getFormDraft(form), status: "published" };
      if (!post.title || !post.body) {
        toast("Titolo e testo sono necessari per pubblicare.");
        return;
      }
      const postPersisted = upsertPost(post);
      removeJson(DRAFT_KEY);
      window.location.hash = `#post/${post.id}`;
      toast(postPersisted ? "Pubblicazione salvata sul dispositivo." : storageWarning());
      return;
    }

    if (button.id === "resetDraft") {
      removeJson(DRAFT_KEY);
      renderCreator();
      toast("Nuova bozza pronta.");
      return;
    }

    if (button.dataset.edit) {
      const post = appState.posts.find((item) => item.id === button.dataset.edit);
      if (!post) return;
      const draftPersisted = writeJson(DRAFT_KEY, post);
      renderCreator();
      document.getElementById("composer")?.scrollIntoView({ behavior: "smooth" });
      toast(draftPersisted ? "Bozza pronta per la modifica." : storageWarning());
      return;
    }

    if (button.dataset.toggle) {
      const post = appState.posts.find((item) => item.id === button.dataset.toggle);
      if (!post) return;
      post.status = post.status === "published" ? "draft" : "published";
      const postPersisted = persistPosts();
      renderCreator();
      toast(postPersisted ? "Stato aggiornato." : storageWarning());
    }
  });

  document.getElementById("analyticsSpan").addEventListener("change", (event) => {
    document.getElementById("metricsRoot").innerHTML = metricsMarkup(computeMetrics(event.target.value));
  });
}

function upsertPost(post) {
  const existingIndex = appState.posts.findIndex((item) => item.id === post.id);
  if (existingIndex >= 0) {
    appState.posts[existingIndex] = post;
  } else {
    appState.posts.unshift(post);
  }
  return persistPosts();
}

function bindGlobalNav() {
  document.querySelectorAll("a[href^='#']").forEach((link) => {
    link.addEventListener("click", () => {
      document.body.classList.remove("menu-open");
    });
  });
}

let motionFrame = 0;
let revealObserver = null;

function setupMotion() {
  revealObserver?.disconnect();

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealTargets = document.querySelectorAll("[data-reveal]");

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealTargets.forEach((element) => element.classList.add("is-visible"));
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -5% 0px", threshold: 0.04 },
    );
    revealObserver = observer;
    revealTargets.forEach((element) => observer.observe(element));
  }

  updateScrollMotion();
}

function updateScrollMotion() {
  const progress = Math.min(window.scrollY / 360, 1);
  const heading = document.querySelector(".home-heading");
  const frontGrid = document.querySelector(".front-grid");

  document.body.classList.toggle("is-scrolled", window.scrollY > 24);
  document.body.style.setProperty("--header-compact", `${Math.round(progress * 10)}px`);

  if (heading) {
    heading.style.setProperty("--heading-lift", `${Math.round(progress * -12)}px`);
    heading.style.setProperty("--heading-scale", `${1 - progress * 0.02}`);
  }

  if (frontGrid) {
    frontGrid.style.setProperty("--widget-lift", `${Math.round(progress * -14)}px`);
    frontGrid.style.setProperty("--widget-scale", `${1 - progress * 0.012}`);
  }
}

function requestScrollMotionUpdate() {
  if (motionFrame) return;
  motionFrame = window.requestAnimationFrame(() => {
    motionFrame = 0;
    updateScrollMotion();
  });
}

function trackRouteLeave() {
  if (!appState.currentPostId) return;
  const lastEvent = [...appState.analytics.events].reverse().find((event) => event.postId === appState.currentPostId);
  if (!lastEvent) return;
  const seconds = Math.max(12, Math.round((Date.now() - appState.routeStartedAt) / 1000));
  lastEvent.staySeconds = seconds;
  lastEvent.readSeconds = Math.min(seconds, seconds * 0.72);
  lastEvent.completed = seconds > 45 || window.scrollY > document.body.scrollHeight * 0.45;
  persistAnalytics();
}

function toast(message) {
  const existing = document.querySelector(".toast");
  existing?.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", trackRouteLeave);
window.addEventListener("scroll", requestScrollMotionUpdate, { passive: true });
window.addEventListener("resize", requestScrollMotionUpdate);

async function bootstrapApp() {
  appState.posts = await loadPosts();
  appState.analytics = await loadAnalytics();
  appState.draft = await readPersistentJson(DRAFT_KEY);

  writeJson(STORAGE_KEY, appState.posts);
  writeJson(ANALYTICS_KEY, appState.analytics);
  if (appState.draft) writeJson(DRAFT_KEY, appState.draft);
  route();
}

bootstrapApp();
