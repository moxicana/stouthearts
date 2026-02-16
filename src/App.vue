<script setup>
import { computed, onMounted, ref, watch, watchEffect } from "vue";
import { useRoute, useRouter } from "vue-router";

const THEME_KEY = "bookclub.theme.v1";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
const route = useRoute();
const router = useRouter();

const loading = ref(true);
const submittingAuth = ref(false);
const busyBookId = ref("");
const uploadingReadingList = ref(false);
const clearingSeason = ref(false);
const backfillingCovers = ref(false);
const errorMessage = ref("");
const adminMessage = ref("");
const adminMessageTone = ref("success");

const isDark = ref(loadTheme());
const user = ref(null);
const authMode = ref("login");
const activeView = ref("season");

const authForm = ref({
  name: "",
  email: "",
  password: ""
});

const currentSeason = ref(2);
const pastSeason = ref(1);
const seasons = ref([]);
const selectedSeason = ref(null);
const showSeasonMenu = ref(false);
const commentDrafts = ref({});
const uploadHistory = ref([]);
const uploadMode = ref("append");
const uploadSeasonPreset = ref("current");
const uploadSeason = ref(2);
const readingListFile = ref(null);

const selectedSeasonBooks = computed(() => {
  const seasonGroup = seasons.value.find((group) => group.season === selectedSeason.value);
  return seasonGroup?.books || [];
});
const selectedSeasonLabel = computed(() => {
  if (selectedSeason.value !== null) return selectedSeason.value;
  return seasons.value[0]?.season ?? null;
});
const routeBookId = computed(() => {
  const match = route.path.match(/^\/books\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
});
const selectedBook = computed(() => {
  if (!routeBookId.value) return null;
  for (const seasonGroup of seasons.value) {
    const found = seasonGroup.books.find((book) => book.id === routeBookId.value);
    if (found) return { ...found, season: seasonGroup.season };
  }
  return null;
});
const viewingBookDetails = computed(() => Boolean(routeBookId.value));
const featuredBook = computed(
  () => selectedSeasonBooks.value.find((book) => book.isFeatured) || selectedSeasonBooks.value[0]
);
const isAdmin = computed(() => user.value?.role === "admin");

watch(isDark, (value) => {
  localStorage.setItem(THEME_KEY, value ? "dark" : "light");
});

watchEffect(() => {
  document.documentElement.classList.toggle("dark", isDark.value);
});

watch(isAdmin, (value) => {
  if (!value && activeView.value === "admin") {
    activeView.value = "season";
  }
});

watch(activeView, (value) => {
  if (value !== "season") {
    showSeasonMenu.value = false;
  }
});

watch(selectedBook, (value) => {
  if (value && selectedSeason.value !== value.season) {
    selectedSeason.value = value.season;
  }
});

onMounted(async () => {
  await bootstrap();
});

function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark") return true;
    if (saved === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function resetAuthError() {
  errorMessage.value = "";
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString();
}

function getHostname(value) {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(options.headers || {})
  };
  if (!isFormData && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...options,
      headers
    });
  } catch {
    throw new Error("Could not reach the API. Make sure both web and API servers are running.");
  }

  if (response.status === 204) return null;

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

async function bootstrap() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const me = await api("/auth/me");
    user.value = me.user;
    await loadBooks();
    if (me.user.role === "admin") {
      await loadUploadHistory();
    }
  } catch {
    user.value = null;
  } finally {
    loading.value = false;
  }
}

async function loadBooks() {
  const payload = await api("/books");
  currentSeason.value = payload.currentSeason;
  pastSeason.value = payload.pastSeason;
  const groupedSeasons = Array.isArray(payload.seasons)
    ? payload.seasons
    : [
        { season: payload.currentSeason, books: payload.currentBooks || [] },
        ...(Array.isArray(payload.pastSeasons) ? payload.pastSeasons : [])
      ].filter((group) => group && Number.isInteger(group.season));
  seasons.value = groupedSeasons;
  if (groupedSeasons.length === 0) {
    selectedSeason.value = null;
  } else if (!groupedSeasons.some((group) => group.season === selectedSeason.value)) {
    const preferred = groupedSeasons.find((group) => group.season === payload.currentSeason);
    selectedSeason.value = preferred?.season ?? groupedSeasons[0].season;
  }
  if (!uploadSeason.value) {
    uploadSeason.value = payload.currentSeason;
  }
}

async function loadUploadHistory() {
  if (!isAdmin.value) return;
  const payload = await api("/admin/reading-list/uploads");
  uploadHistory.value = payload.uploads || [];
}

async function submitAuth() {
  resetAuthError();
  submittingAuth.value = true;

  const body = {
    email: authForm.value.email,
    password: authForm.value.password
  };

  if (authMode.value === "register") {
    body.name = authForm.value.name;
  }

  try {
    const endpoint = authMode.value === "register" ? "/auth/register" : "/auth/login";
    const payload = await api(endpoint, {
      method: "POST",
      body: JSON.stringify(body)
    });
    user.value = payload.user;
    authForm.value = { name: "", email: "", password: "" };
    await loadBooks();
    if (payload.user.role === "admin") {
      await loadUploadHistory();
    }
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    submittingAuth.value = false;
  }
}

async function logout() {
  resetAuthError();
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {
    // Client-side cleanup still runs even if API logout fails.
  } finally {
    user.value = null;
    seasons.value = [];
    selectedSeason.value = null;
    showSeasonMenu.value = false;
    uploadHistory.value = [];
    adminMessage.value = "";
    readingListFile.value = null;
    activeView.value = "season";
    await router.push("/");
  }
}

async function addComment(bookId) {
  const text = (commentDrafts.value[bookId] || "").trim();
  if (!text) return;

  busyBookId.value = bookId;
  resetAuthError();
  try {
    await api(`/books/${bookId}/comments`, {
      method: "POST",
      body: JSON.stringify({ text })
    });
    commentDrafts.value[bookId] = "";
    await loadBooks();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    busyBookId.value = "";
  }
}

function formatUploadMode(value) {
  if (value === "backfill") return "Backfill Covers";
  if (value === "clear") return "Clear Season";
  return value === "replace" ? "Replace" : "Append";
}

function setReadingListFile(event) {
  readingListFile.value = event.target.files?.[0] || null;
}

function getUploadSeason() {
  if (uploadSeasonPreset.value === "csv") return undefined;
  if (uploadSeasonPreset.value === "current") return currentSeason.value;
  if (uploadSeasonPreset.value === "past") return pastSeason.value;
  return uploadSeason.value;
}

async function uploadReadingList() {
  adminMessage.value = "";
  if (!readingListFile.value) {
    adminMessageTone.value = "error";
    adminMessage.value = "Select a CSV or JSON file first.";
    return;
  }

  const selectedSeason = getUploadSeason();
  if (
    selectedSeason !== undefined &&
    (!Number.isInteger(Number(selectedSeason)) || Number(selectedSeason) < 1 || Number(selectedSeason) > 99)
  ) {
    adminMessageTone.value = "error";
    adminMessage.value = "Select a valid season between 1 and 99.";
    return;
  }

  const formData = new FormData();
  formData.append("mode", uploadMode.value);
  if (selectedSeason !== undefined) {
    formData.append("season", String(selectedSeason));
  }
  formData.append("file", readingListFile.value);

  uploadingReadingList.value = true;
  try {
    const payload = await api("/admin/reading-list/upload", {
      method: "POST",
      body: formData
    });
    await loadBooks();
    await loadUploadHistory();
    adminMessageTone.value = "success";
    const seasonLabel =
      selectedSeason === undefined ? "seasons from CSV" : `Season ${selectedSeason}`;
    adminMessage.value = `Imported ${payload.summary.rowsReceived} row(s) for ${seasonLabel}. Inserted ${payload.summary.booksInserted}, updated ${payload.summary.booksUpdated}.`;
    readingListFile.value = null;
  } catch (error) {
    adminMessageTone.value = "error";
    adminMessage.value = error.message;
  } finally {
    uploadingReadingList.value = false;
  }
}

async function clearSeasonBooks() {
  adminMessage.value = "";
  const selectedSeason = getUploadSeason();
  if (
    selectedSeason === undefined ||
    !Number.isInteger(Number(selectedSeason)) ||
    Number(selectedSeason) < 1 ||
    Number(selectedSeason) > 99
  ) {
    adminMessageTone.value = "error";
    adminMessage.value = "Select Current, Past, or Custom season to clear.";
    return;
  }

  const season = Number(selectedSeason);
  const confirmed = window.confirm(
    `This will permanently delete all books and comments in Season ${season} for every user. Continue?`
  );
  if (!confirmed) return;

  clearingSeason.value = true;
  try {
    const payload = await api("/admin/reading-list/clear-season", {
      method: "POST",
      body: JSON.stringify({ season })
    });
    await loadBooks();
    await loadUploadHistory();
    adminMessageTone.value = "success";
    adminMessage.value = `Cleared Season ${season}. Deleted ${payload.summary.booksDeleted} book(s) across ${payload.summary.usersAffected} user(s).`;
  } catch (error) {
    adminMessageTone.value = "error";
    adminMessage.value = error.message;
  } finally {
    clearingSeason.value = false;
  }
}

async function backfillCoverImages() {
  adminMessage.value = "";
  backfillingCovers.value = true;
  try {
    const payload = await api("/admin/reading-list/backfill-covers", {
      method: "POST"
    });
    await loadBooks();
    await loadUploadHistory();
    adminMessageTone.value = "success";
    adminMessage.value = `Backfill complete. Updated ${payload.summary.booksUpdated} book cover(s) from ${payload.summary.isbnResolved} resolved ISBN(s).`;
  } catch (error) {
    adminMessageTone.value = "error";
    adminMessage.value = error.message;
  } finally {
    backfillingCovers.value = false;
  }
}

function toggleSeasonMenu() {
  activeView.value = "season";
  if (seasons.value.length === 0) {
    showSeasonMenu.value = false;
    return;
  }
  showSeasonMenu.value = !showSeasonMenu.value;
}

function openSeason(season) {
  selectedSeason.value = season;
  activeView.value = "season";
  showSeasonMenu.value = false;
  router.push("/");
}

function openBookDetails(bookId) {
  showSeasonMenu.value = false;
  router.push(`/books/${encodeURIComponent(bookId)}`);
}

function closeBookDetails() {
  router.push("/");
}
</script>

<template>
  <main class="min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
    <div class="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header class="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 class="text-4xl font-bold tracking-tight">Stout Hearts</h1>
          <p class="mt-1 text-zinc-600 dark:text-zinc-400">Book club tracker</p>
        </div>
        <button class="btn-secondary" @click="isDark = !isDark">
          {{ isDark ? "Light Mode" : "Dark Mode" }}
        </button>
      </header>

      <section v-if="loading" class="panel">
        <p>Loading...</p>
      </section>

      <section v-else-if="!user" class="mx-auto max-w-md">
        <article class="panel">
          <h2 class="text-2xl font-semibold">
            {{ authMode === "login" ? "Sign in" : "Create account" }}
          </h2>
          <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Secure auth with hashed passwords and HTTP-only session cookies.
          </p>

          <form class="mt-5 space-y-3" @submit.prevent="submitAuth">
            <label v-if="authMode === 'register'" class="field-label">
              Name
              <input v-model="authForm.name" class="input" type="text" required autocomplete="name" />
            </label>
            <label class="field-label">
              Email
              <input
                v-model="authForm.email"
                class="input"
                type="email"
                required
                autocomplete="email"
              />
            </label>
            <label class="field-label">
              Password
              <input
                v-model="authForm.password"
                class="input"
                type="password"
                required
                minlength="8"
                :autocomplete="authMode === 'register' ? 'new-password' : 'current-password'"
              />
            </label>
            <p v-if="authMode === 'register'" class="text-xs text-zinc-500 dark:text-zinc-400">
              Use at least 8 characters with letters and numbers.
            </p>
            <p v-if="errorMessage" class="text-sm text-rose-600 dark:text-rose-300">
              {{ errorMessage }}
            </p>
            <button class="btn-primary w-full" :disabled="submittingAuth">
              {{ submittingAuth ? "Please wait..." : authMode === "login" ? "Sign in" : "Create account" }}
            </button>
          </form>

          <button
            class="mt-4 text-sm text-zinc-700 underline dark:text-zinc-300"
            @click="authMode = authMode === 'login' ? 'register' : 'login'"
          >
            {{
              authMode === "login"
                ? "Need an account? Create one"
                : "Already have an account? Sign in"
            }}
          </button>
        </article>
      </section>

      <section v-else class="space-y-4">
        <nav class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap gap-2">
            <div class="relative">
              <button
                class="btn-tab"
                :class="{ 'btn-tab-active': activeView === 'season' }"
                @click="toggleSeasonMenu"
              >
                Season
                <span v-if="selectedSeasonLabel !== null"> {{ selectedSeasonLabel }}</span>
              </button>
              <div
                v-if="showSeasonMenu"
                class="absolute left-0 z-20 mt-2 min-w-56 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
              >
                <button
                  v-for="seasonGroup in seasons"
                  :key="seasonGroup.season"
                  class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  @click="openSeason(seasonGroup.season)"
                >
                  <span>Season {{ seasonGroup.season }}</span>
                  <span class="text-xs text-zinc-500 dark:text-zinc-400">{{ seasonGroup.books.length }}</span>
                </button>
                <p v-if="seasons.length === 0" class="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                  No seasons yet.
                </p>
              </div>
            </div>
            <button
              v-if="isAdmin"
              class="btn-tab"
              :class="{ 'btn-tab-active': activeView === 'admin' }"
              @click="
                activeView = 'admin';
                showSeasonMenu = false;
                router.push('/');
              "
            >
              Admin
            </button>
          </div>
          <div class="flex items-center gap-3 text-sm">
            <span class="text-zinc-600 dark:text-zinc-400">{{ user.name }} ({{ user.role }})</span>
            <button class="btn-secondary" @click="logout">Sign out</button>
          </div>
        </nav>

        <p v-if="errorMessage" class="text-sm text-rose-600 dark:text-rose-300">
          {{ errorMessage }}
        </p>

        <section v-if="activeView === 'season' && viewingBookDetails" class="space-y-4">
          <section v-if="selectedBook" class="panel space-y-4">
            <div class="flex items-center justify-between gap-3">
              <button class="btn-secondary" @click="closeBookDetails">Back to Season</button>
              <p class="text-sm text-zinc-600 dark:text-zinc-400">Season {{ selectedBook.season }}</p>
            </div>

            <div class="grid gap-4 sm:grid-cols-[140px,1fr]">
              <div class="h-52 w-36 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
                <img
                  v-if="selectedBook.thumbnailUrl"
                  :src="selectedBook.thumbnailUrl"
                  :alt="`Cover of ${selectedBook.title}`"
                  class="h-full w-full object-cover"
                />
                <div v-else class="flex h-full w-full items-center justify-center text-center text-xs text-zinc-500 dark:text-zinc-400">
                  No cover image
                </div>
              </div>
              <div>
                <h2 class="text-3xl font-semibold">{{ selectedBook.title }}</h2>
                <p class="mt-1 text-zinc-700 dark:text-zinc-300">by {{ selectedBook.author }}</p>
                <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {{ selectedBook.month }} {{ selectedBook.year }}
                </p>
                <p v-if="selectedBook.isbn" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  ISBN: {{ selectedBook.isbn }}
                </p>
              </div>
            </div>

            <div class="space-y-2">
              <h3 class="text-lg font-semibold">Resources</h3>
              <p v-if="selectedBook.resources.length === 0" class="text-sm text-zinc-600 dark:text-zinc-400">
                No resource links yet.
              </p>
              <ul v-else class="space-y-2">
                <li v-for="resource in selectedBook.resources" :key="`${resource.label}-${resource.url}`" class="comment-row">
                  <span>{{ resource.label }}</span>
                  <a
                    class="text-sm font-medium text-emerald-700 underline dark:text-emerald-300"
                    :href="resource.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ getHostname(resource.url) || "Open link" }}
                  </a>
                </li>
              </ul>
            </div>

            <div class="space-y-2">
              <h3 class="text-lg font-semibold">Comments</h3>
              <p v-if="selectedBook.comments.length === 0" class="text-sm text-zinc-600 dark:text-zinc-400">
                No comments yet.
              </p>
              <ul v-else class="space-y-2">
                <li v-for="comment in selectedBook.comments" :key="comment.id" class="comment-row">
                  <span>{{ comment.text }}</span>
                  <small class="text-xs text-zinc-500 dark:text-zinc-400">
                    {{ formatDate(comment.createdAt) }}
                  </small>
                </li>
              </ul>
              <div class="flex gap-2">
                <input
                  v-model="commentDrafts[selectedBook.id]"
                  class="input"
                  placeholder="Add comment..."
                  @keyup.enter="addComment(selectedBook.id)"
                />
                <button
                  class="btn-primary"
                  :disabled="busyBookId === selectedBook.id"
                  @click="addComment(selectedBook.id)"
                >
                  Add
                </button>
              </div>
            </div>
          </section>

          <section v-else class="panel space-y-3">
            <h2 class="text-2xl font-semibold">Book not found</h2>
            <p class="text-sm text-zinc-600 dark:text-zinc-400">
              This book may have been removed or is not available in your current data.
            </p>
            <button class="btn-secondary" @click="closeBookDetails">Back to Season</button>
          </section>
        </section>

        <section v-else-if="activeView === 'season'" class="space-y-4">
          <article v-if="featuredBook" class="panel border-emerald-300/70 bg-emerald-50 dark:bg-emerald-950/40">
            <p class="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              Featured Book
            </p>
            <h2 class="mt-2 text-2xl font-semibold">{{ featuredBook.title }}</h2>
            <p class="text-zinc-700 dark:text-zinc-300">by {{ featuredBook.author }}</p>
            <p class="mt-1 text-sm font-medium text-amber-700 dark:text-amber-300">
              {{ featuredBook.month }} {{ featuredBook.year }} | Season {{ selectedSeasonLabel ?? currentSeason }}
            </p>
          </article>

          <section class="panel">
            <h3 class="text-xl font-semibold">Books from Season {{ selectedSeasonLabel ?? currentSeason }}</h3>
            <p v-if="selectedSeasonBooks.length === 0" class="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              No books in this season yet.
            </p>
            <div class="mt-3 grid gap-3 lg:grid-cols-2">
              <button
                v-for="book in selectedSeasonBooks"
                :key="book.id"
                class="card text-left transition hover:-translate-y-0.5 hover:border-emerald-300 dark:hover:border-emerald-600"
                @click="openBookDetails(book.id)"
              >
                <div class="flex gap-3">
                  <div class="h-28 w-20 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
                    <img
                      v-if="book.thumbnailUrl"
                      :src="book.thumbnailUrl"
                      :alt="`Cover of ${book.title}`"
                      class="h-full w-full object-cover"
                    />
                    <div v-else class="flex h-full w-full items-center justify-center text-center text-[10px] text-zinc-500 dark:text-zinc-400">
                      No cover
                    </div>
                  </div>
                  <div class="min-w-0">
                    <h4 class="text-lg font-semibold">{{ book.title }}</h4>
                    <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                      {{ book.author }} | {{ book.month }} {{ book.year }}
                    </p>
                    <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {{ book.resources.length }} resource link{{ book.resources.length === 1 ? "" : "s" }}
                    </p>
                    <p class="mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">Open details</p>
                  </div>
                </div>
              </button>
            </div>
          </section>
        </section>

        <section v-else-if="activeView === 'admin' && isAdmin" class="panel space-y-3">
          <h3 class="text-xl font-semibold">Admin: Import Reading List</h3>
          <p class="text-sm text-zinc-600 dark:text-zinc-400">
            Upload a CSV or JSON file for a selected season. If your file includes a `season`
            column, it takes priority over the selected season. You can also include `year`,
            `isbn`, `thumbnailUrl`, and bookseller resource link columns.
          </p>
          <div class="grid gap-3 lg:grid-cols-4 lg:items-end">
            <label class="field-label">
              List
              <select v-model="uploadSeasonPreset" class="input">
                <option value="current">Current Books Season {{ currentSeason }}</option>
                <option value="past">Past Books Season {{ pastSeason }}</option>
                <option value="custom">Custom Season</option>
                <option value="csv">Use season column from CSV</option>
              </select>
            </label>
            <label class="field-label">
              Season
              <input
                v-model.number="uploadSeason"
                class="input"
                type="number"
                min="1"
                max="99"
                step="1"
                :disabled="uploadSeasonPreset !== 'custom'"
              />
            </label>
            <label class="field-label">
              Mode
              <select v-model="uploadMode" class="input">
                <option value="append">Append</option>
                <option value="replace">Replace</option>
              </select>
            </label>
            <label class="field-label">
              File (.csv or .json)
              <input class="input" type="file" accept=".csv,.json" @change="setReadingListFile" />
            </label>
            <button
              class="btn-primary"
              :disabled="uploadingReadingList || clearingSeason || backfillingCovers"
              @click="uploadReadingList"
            >
              {{ uploadingReadingList ? "Uploading..." : "Import" }}
            </button>
            <button
              class="btn-danger"
              :disabled="uploadingReadingList || clearingSeason || backfillingCovers"
              @click="clearSeasonBooks"
            >
              {{ clearingSeason ? "Clearing..." : "Clear Season" }}
            </button>
            <button
              class="btn-secondary"
              :disabled="uploadingReadingList || clearingSeason || backfillingCovers"
              @click="backfillCoverImages"
            >
              {{ backfillingCovers ? "Backfilling..." : "Backfill Covers" }}
            </button>
          </div>
          <p
            v-if="adminMessage"
            class="text-sm"
            :class="
              adminMessageTone === 'error'
                ? 'text-rose-600 dark:text-rose-300'
                : 'text-emerald-700 dark:text-emerald-300'
            "
          >
            {{ adminMessage }}
          </p>

          <div class="space-y-2">
            <h4 class="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
              Recent Uploads
            </h4>
            <p v-if="uploadHistory.length === 0" class="text-sm text-zinc-600 dark:text-zinc-400">
              No uploads yet.
            </p>
            <ul v-else class="space-y-2">
              <li v-for="upload in uploadHistory" :key="upload.id" class="comment-row">
                <span>{{ upload.filename }} ({{ formatUploadMode(upload.mode) }}, {{ upload.rowsImported }} {{ upload.mode === "clear" ? "deleted" : upload.mode === "backfill" ? "updated" : "rows" }})</span>
                <small class="text-xs text-zinc-500 dark:text-zinc-400">
                  {{ formatDate(upload.createdAt) }}
                </small>
              </li>
            </ul>
          </div>
        </section>
      </section>
    </div>
  </main>
</template>
