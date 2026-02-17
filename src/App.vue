<script setup>
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from "vue";
import FlatPickr from "vue-flatpickr-component";
import "flatpickr/dist/flatpickr.min.css";
import { useRoute, useRouter } from "vue-router";

const THEME_KEY = "bookclub.theme.v1";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
const route = useRoute();
const router = useRouter();

const loading = ref(true);
const submittingAuth = ref(false);
const busyBookId = ref("");
const featuringBookId = ref("");
const uploadingReadingList = ref(false);
const clearingVolume = ref(false);
const clearingUploadHistory = ref(false);
const backfillingCovers = ref(false);
const errorMessage = ref("");
const adminMessage = ref("");
const adminMessageTone = ref("success");

const isDark = ref(loadTheme());
const user = ref(null);
const authMode = ref("login");
const activeView = ref("volume");

const authForm = ref({
  name: "",
  email: "",
  password: ""
});

const currentVolume = ref(2);
const pastVolume = ref(1);
const volumes = ref([]);
const selectedVolume = ref(null);
const showVolumeMenu = ref(false);
const commentDrafts = ref({});
const uploadHistory = ref([]);
const pendingUsers = ref([]);
const approvingUserId = ref("");
const uploadMode = ref("append");
const uploadVolumePreset = ref("current");
const uploadVolume = ref(2);
const readingListFile = ref(null);
const pendingRequestCount = computed(() => pendingUsers.value.length);
const dashboardStats = ref({
  booksRead: 0,
  activeMembers: 0,
  discussions: 0,
  upcomingEvents: 0,
  currentVolumeBooks: 0
});
const members = ref([]);
const savingBookMeeting = ref(false);
const clearingBookMeeting = ref(false);
const meetingMessage = ref("");
const meetingMessageTone = ref("success");
const meetingForm = ref({
  date: "",
  time: "",
  location: ""
});
const meetingDateConfig = {
  dateFormat: "Y-m-d",
  allowInput: false,
  disableMobile: true
};

const PENDING_USERS_POLL_MS = 30_000;
let pendingUsersPollTimerId;

const selectedVolumeBooks = computed(() => {
  const volumeGroup = volumes.value.find((group) => group.volume === selectedVolume.value);
  return volumeGroup?.books || [];
});
const selectedVolumeLabel = computed(() => {
  if (selectedVolume.value !== null) return selectedVolume.value;
  return volumes.value[0]?.volume ?? null;
});
const routeBookId = computed(() => {
  const match = route.path.match(/^\/books\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
});
const selectedBook = computed(() => {
  if (!routeBookId.value) return null;
  for (const volumeGroup of volumes.value) {
    const found = volumeGroup.books.find((book) => book.id === routeBookId.value);
    if (found) return { ...found, volume: volumeGroup.volume };
  }
  return null;
});
const viewingBookDetails = computed(() => Boolean(routeBookId.value));
const featuredBook = computed(
  () => selectedVolumeBooks.value.find((book) => book.isFeatured) || selectedVolumeBooks.value[0]
);
const scheduledBooksForVolume = computed(() =>
  [...selectedVolumeBooks.value]
    .filter((book) => book.meetingStartsAt)
    .sort((a, b) => new Date(a.meetingStartsAt) - new Date(b.meetingStartsAt))
);
const isAdmin = computed(() => user.value?.role === "admin");
const firstName = computed(() => user.value?.name?.trim().split(/\s+/)[0] || "Reader");
const greetingMessage = computed(() => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
});

watch(isDark, (value) => {
  localStorage.setItem(THEME_KEY, value ? "dark" : "light");
});

watchEffect(() => {
  document.documentElement.classList.toggle("dark", isDark.value);
});

watch(isAdmin, (value) => {
  if (!value && activeView.value === "admin") {
    activeView.value = "volume";
  }
  if (value) {
    startPendingUsersPolling();
    loadPendingUsers().catch(() => {});
    return;
  }
  pendingUsers.value = [];
  stopPendingUsersPolling();
});

watch(activeView, (value) => {
  if (value !== "volume") {
    showVolumeMenu.value = false;
  }
});

watch(selectedBook, (value) => {
  if (value && selectedVolume.value !== value.volume) {
    selectedVolume.value = value.volume;
  }
  if (value) {
    resetMeetingForm(value);
    meetingMessage.value = "";
  }
});

onMounted(async () => {
  await bootstrap();
});

onUnmounted(() => {
  stopPendingUsersPolling();
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

function formatEventDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function formatEventTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function formatCommentTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function getHostname(value) {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (input) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function toDateInput(value) {
  const local = toDateTimeLocal(value);
  return local ? local.slice(0, 10) : "";
}

function toTimeInput(value) {
  const local = toDateTimeLocal(value);
  return local ? local.slice(11, 16) : "";
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
    await loadDashboard();
    if (me.user.role === "admin") {
      await loadUploadHistory();
      await loadPendingUsers();
    }
  } catch {
    user.value = null;
    dashboardStats.value = {
      booksRead: 0,
      activeMembers: 0,
      discussions: 0,
      upcomingEvents: 0,
      currentVolumeBooks: 0
    };
    members.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadBooks() {
  const payload = await api("/books");
  currentVolume.value = payload.currentVolume;
  pastVolume.value = payload.pastVolume;
  const groupedVolumes = Array.isArray(payload.volumes)
    ? payload.volumes
    : [
        { volume: payload.currentVolume, books: payload.currentBooks || [] },
        ...(Array.isArray(payload.pastVolumes) ? payload.pastVolumes : [])
      ].filter((group) => group && Number.isInteger(group.volume));
  volumes.value = groupedVolumes;
  if (groupedVolumes.length === 0) {
    selectedVolume.value = null;
  } else if (!groupedVolumes.some((group) => group.volume === selectedVolume.value)) {
    const preferred = groupedVolumes.find((group) => group.volume === payload.currentVolume);
    selectedVolume.value = preferred?.volume ?? groupedVolumes[0].volume;
  }
  if (!uploadVolume.value) {
    uploadVolume.value = payload.currentVolume;
  }
}

async function loadDashboard() {
  const payload = await api("/dashboard");
  dashboardStats.value = {
    booksRead: payload.stats?.booksRead ?? 0,
    activeMembers: payload.stats?.activeMembers ?? 0,
    discussions: payload.stats?.discussions ?? 0,
    upcomingEvents: payload.stats?.upcomingEvents ?? 0,
    currentVolumeBooks: payload.stats?.currentVolumeBooks ?? 0
  };
  members.value = payload.members || [];
}

async function loadUploadHistory() {
  if (!isAdmin.value) return;
  const payload = await api("/admin/reading-list/uploads");
  uploadHistory.value = payload.uploads || [];
}

async function loadPendingUsers() {
  if (!isAdmin.value) return;
  const payload = await api("/admin/users/pending");
  pendingUsers.value = payload.users || [];
}

function startPendingUsersPolling() {
  if (pendingUsersPollTimerId) return;
  pendingUsersPollTimerId = window.setInterval(() => {
    if (!isAdmin.value) return;
    loadPendingUsers().catch(() => {});
  }, PENDING_USERS_POLL_MS);
}

function stopPendingUsersPolling() {
  if (!pendingUsersPollTimerId) return;
  window.clearInterval(pendingUsersPollTimerId);
  pendingUsersPollTimerId = undefined;
}

function resetMeetingForm(book = selectedBook.value) {
  meetingForm.value = {
    date: toDateInput(book?.meetingStartsAt),
    time: toTimeInput(book?.meetingStartsAt),
    location: book?.meetingLocation || ""
  };
}

async function saveBookMeeting() {
  if (!isAdmin.value || !selectedBook.value) return;
  meetingMessage.value = "";
  const combined = `${meetingForm.value.date}T${meetingForm.value.time}`;
  const parsedDate = new Date(combined);
  if (Number.isNaN(parsedDate.getTime())) {
    meetingMessageTone.value = "error";
    meetingMessage.value = "Select a valid meeting date and time.";
    return;
  }
  const location = (meetingForm.value.location || "").trim();
  if (!location) {
    meetingMessageTone.value = "error";
    meetingMessage.value = "Meeting location is required.";
    return;
  }

  savingBookMeeting.value = true;
  try {
    await api(`/admin/books/${encodeURIComponent(selectedBook.value.id)}/meeting`, {
      method: "PUT",
      body: JSON.stringify({
        startsAt: parsedDate.toISOString(),
        location
      })
    });
    await loadBooks();
    await loadDashboard();
    meetingMessageTone.value = "success";
    meetingMessage.value = "Meeting details saved.";
  } catch (error) {
    meetingMessageTone.value = "error";
    meetingMessage.value = error.message;
  } finally {
    savingBookMeeting.value = false;
  }
}

async function clearBookMeeting() {
  if (!isAdmin.value || !selectedBook.value) return;
  const confirmed = window.confirm("Clear meeting details for this book?");
  if (!confirmed) return;

  clearingBookMeeting.value = true;
  meetingMessage.value = "";
  try {
    await api(`/admin/books/${encodeURIComponent(selectedBook.value.id)}/meeting`, {
      method: "DELETE"
    });
    await loadBooks();
    await loadDashboard();
    meetingMessageTone.value = "success";
    meetingMessage.value = "Meeting cleared.";
  } catch (error) {
    meetingMessageTone.value = "error";
    meetingMessage.value = error.message;
  } finally {
    clearingBookMeeting.value = false;
  }
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
    if (payload.requiresApproval) {
      authMode.value = "login";
      authForm.value = { name: "", email: authForm.value.email, password: "" };
      errorMessage.value = payload.message || "Account created. Await admin approval before signing in.";
      return;
    }
    user.value = payload.user;
    authForm.value = { name: "", email: "", password: "" };
    await loadBooks();
    await loadDashboard();
    if (payload.user.role === "admin") {
      await loadUploadHistory();
      await loadPendingUsers();
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
    volumes.value = [];
    selectedVolume.value = null;
    showVolumeMenu.value = false;
    uploadHistory.value = [];
    pendingUsers.value = [];
    adminMessage.value = "";
    readingListFile.value = null;
    dashboardStats.value = {
      booksRead: 0,
      activeMembers: 0,
      discussions: 0,
      upcomingEvents: 0,
      currentVolumeBooks: 0
    };
    members.value = [];
    meetingForm.value = { date: "", time: "", location: "" };
    meetingMessage.value = "";
    activeView.value = "volume";
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
    await loadDashboard();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    busyBookId.value = "";
  }
}

async function setFeaturedBookForVolume(bookId) {
  if (!bookId) return;
  featuringBookId.value = bookId;
  resetAuthError();
  try {
    await api(`/admin/books/${encodeURIComponent(bookId)}/feature`, {
      method: "POST"
    });
    await loadBooks();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    featuringBookId.value = "";
  }
}

function formatUploadMode(value) {
  if (value === "backfill") return "Backfill Covers";
  if (value === "clear") return "Clear Volume";
  return value === "replace" ? "Replace" : "Append";
}

function setReadingListFile(event) {
  readingListFile.value = event.target.files?.[0] || null;
}

function getUploadVolume() {
  if (uploadVolumePreset.value === "csv") return undefined;
  if (uploadVolumePreset.value === "current") return currentVolume.value;
  if (uploadVolumePreset.value === "past") return pastVolume.value;
  return uploadVolume.value;
}

async function uploadReadingList() {
  adminMessage.value = "";
  if (!readingListFile.value) {
    adminMessageTone.value = "error";
    adminMessage.value = "Select a CSV or JSON file first.";
    return;
  }

  const selectedVolume = getUploadVolume();
  if (
    selectedVolume !== undefined &&
    (!Number.isInteger(Number(selectedVolume)) || Number(selectedVolume) < 1 || Number(selectedVolume) > 99)
  ) {
    adminMessageTone.value = "error";
    adminMessage.value = "Select a valid volume between 1 and 99.";
    return;
  }

  const formData = new FormData();
  formData.append("mode", uploadMode.value);
  if (selectedVolume !== undefined) {
    formData.append("volume", String(selectedVolume));
  }
  formData.append("file", readingListFile.value);

  uploadingReadingList.value = true;
  try {
    const payload = await api("/admin/reading-list/upload", {
      method: "POST",
      body: formData
    });
    await loadBooks();
    await loadDashboard();
    await loadUploadHistory();
    adminMessageTone.value = "success";
    const volumeLabel =
      selectedVolume === undefined ? "volumes from CSV" : `Volume ${selectedVolume}`;
    adminMessage.value = `Imported ${payload.summary.rowsReceived} row(s) for ${volumeLabel}. Inserted ${payload.summary.booksInserted}, updated ${payload.summary.booksUpdated}.`;
    readingListFile.value = null;
  } catch (error) {
    adminMessageTone.value = "error";
    adminMessage.value = error.message;
  } finally {
    uploadingReadingList.value = false;
  }
}

async function clearVolumeBooks() {
  adminMessage.value = "";
  const selectedVolume = getUploadVolume();
  if (
    selectedVolume === undefined ||
    !Number.isInteger(Number(selectedVolume)) ||
    Number(selectedVolume) < 1 ||
    Number(selectedVolume) > 99
  ) {
    adminMessageTone.value = "error";
    adminMessage.value = "Select Current, Past, or Custom volume to clear.";
    return;
  }

  const volume = Number(selectedVolume);
  const confirmed = window.confirm(
    `This will permanently delete all books and comments in Volume ${volume} for every user. Continue?`
  );
  if (!confirmed) return;

  clearingVolume.value = true;
  try {
    const payload = await api("/admin/reading-list/clear-volume", {
      method: "POST",
      body: JSON.stringify({ volume })
    });
    await loadBooks();
    await loadDashboard();
    await loadUploadHistory();
    adminMessageTone.value = "success";
    adminMessage.value = `Cleared Volume ${volume}. Deleted ${payload.summary.booksDeleted} book(s) across ${payload.summary.usersAffected} user(s).`;
  } catch (error) {
    adminMessageTone.value = "error";
    adminMessage.value = error.message;
  } finally {
    clearingVolume.value = false;
  }
}

async function clearUploadHistory() {
  adminMessage.value = "";
  if (uploadHistory.value.length === 0) {
    adminMessageTone.value = "error";
    adminMessage.value = "There are no uploads to clear.";
    return;
  }

  const confirmed = window.confirm(
    "This will permanently clear the Recent Uploads history. Continue?"
  );
  if (!confirmed) return;

  clearingUploadHistory.value = true;
  try {
    const payload = await api("/admin/reading-list/uploads/clear", {
      method: "POST"
    });
    await loadUploadHistory();
    adminMessageTone.value = "success";
    adminMessage.value = `Cleared upload history. Deleted ${payload.summary.uploadsDeleted} record(s).`;
  } catch (error) {
    adminMessageTone.value = "error";
    adminMessage.value = error.message;
  } finally {
    clearingUploadHistory.value = false;
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

async function approvePendingUser(pendingUser) {
  if (!pendingUser?.id) return;
  approvingUserId.value = String(pendingUser.id);
  adminMessage.value = "";
  try {
    await api(`/admin/users/${encodeURIComponent(String(pendingUser.id))}/approve`, {
      method: "POST"
    });
    await loadPendingUsers();
    await loadDashboard();
    adminMessageTone.value = "success";
    adminMessage.value = `Approved ${pendingUser.email}.`;
  } catch (error) {
    adminMessageTone.value = "error";
    adminMessage.value = error.message;
  } finally {
    approvingUserId.value = "";
  }
}

function toggleVolumeMenu() {
  activeView.value = "volume";
  if (volumes.value.length === 0) {
    showVolumeMenu.value = false;
    return;
  }
  showVolumeMenu.value = !showVolumeMenu.value;
}

function openVolume(volume) {
  selectedVolume.value = volume;
  activeView.value = "volume";
  showVolumeMenu.value = false;
  router.push("/");
}

function openBookDetails(bookId) {
  showVolumeMenu.value = false;
  router.push(`/books/${encodeURIComponent(bookId)}`);
}

function closeBookDetails() {
  router.push("/");
}
</script>

<template>
  <main class="min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
    <div class="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header class="relative left-1/2 mb-6 w-screen -translate-x-1/2 px-4 sm:px-6 lg:px-8">
        <div class="mx-auto flex w-full max-w-screen-2xl flex-wrap items-center justify-between gap-3">
          <div class="flex min-w-0 flex-wrap items-center gap-3 sm:gap-6">
            <div>
              <h1 class="text-4xl font-bold tracking-tight">Stout Hearts</h1>
              <p class="mt-1 text-zinc-600 dark:text-zinc-400">Book club tracker</p>
            </div>
            <nav v-if="user" class="flex flex-wrap items-center gap-2">
              <div class="relative">
                <button
                  class="btn-tab"
                  :class="{ 'btn-tab-active': activeView === 'volume' }"
                  @click="toggleVolumeMenu"
                >
                  Volume
                  <span v-if="selectedVolumeLabel !== null"> {{ selectedVolumeLabel }}</span>
                </button>
                <div
                  v-if="showVolumeMenu"
                  class="absolute left-0 z-20 mt-2 min-w-56 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <button
                    v-for="volumeGroup in volumes"
                    :key="volumeGroup.volume"
                    class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    @click="openVolume(volumeGroup.volume)"
                  >
                    <span>Volume {{ volumeGroup.volume }}</span>
                    <span class="text-xs text-zinc-500 dark:text-zinc-400">{{ volumeGroup.books.length }}</span>
                  </button>
                  <p v-if="volumes.length === 0" class="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                    No volumes yet.
                  </p>
                </div>
              </div>
              <button
                v-if="isAdmin"
                class="btn-tab inline-flex items-center"
                :class="{ 'btn-tab-active': activeView === 'admin' }"
                :aria-label="
                  pendingRequestCount > 0
                    ? `Admin (${pendingRequestCount} pending approval${pendingRequestCount === 1 ? '' : 's'})`
                    : 'Admin'
                "
                @click="
                  activeView = 'admin';
                  showVolumeMenu = false;
                  router.push('/');
                "
              >
                Admin
                <span
                  v-if="pendingRequestCount > 0"
                  class="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-xs font-semibold leading-none text-white"
                >
                  {{ pendingRequestCount > 99 ? "99+" : pendingRequestCount }}
                </span>
              </button>
            </nav>
          </div>
          <div class="flex items-center gap-2 sm:gap-3">
            <span v-if="user" class="text-sm text-zinc-600 dark:text-zinc-400">
              {{ user.name }} ({{ user.role }})
            </span>
            <button v-if="user" class="btn-secondary" @click="logout">Sign out</button>
            <button
              class="btn-secondary inline-flex h-10 w-10 items-center justify-center p-0"
              :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
              :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
              @click="isDark = !isDark"
            >
              <svg
                v-if="isDark"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                class="h-5 w-5"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="4" />
                <path stroke-linecap="round" d="M12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
              </svg>
              <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="h-5 w-5"
                aria-hidden="true"
              >
                <path d="M21.4 14.7a1 1 0 0 0-1.3-.9 8 8 0 0 1-9.9-9.9 1 1 0 0 0-1.3-1.3A10 10 0 1 0 21.4 14.7Z" />
              </svg>
              <span class="sr-only">{{ isDark ? "Switch to light mode" : "Switch to dark mode" }}</span>
            </button>
          </div>
        </div>
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
            Secure auth with hashed passwords and HTTP-only session cookies. New accounts require admin approval.
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
        <p v-if="errorMessage" class="text-sm text-rose-600 dark:text-rose-300">
          {{ errorMessage }}
        </p>

        <section v-if="activeView === 'volume' && viewingBookDetails" class="space-y-4">
          <section v-if="selectedBook" class="panel space-y-4">
            <div class="flex items-center justify-between gap-3">
              <button class="btn-secondary" @click="closeBookDetails">Back to Volume</button>
              <div class="flex items-center gap-2">
                <p class="text-sm text-zinc-600 dark:text-zinc-400">Volume {{ selectedBook.volume }}</p>
                <button
                  v-if="isAdmin"
                  class="btn-secondary"
                  :disabled="selectedBook.isFeatured || featuringBookId === selectedBook.id"
                  @click="setFeaturedBookForVolume(selectedBook.id)"
                >
                  {{
                    selectedBook.isFeatured
                      ? "Featured for Volume"
                      : featuringBookId === selectedBook.id
                        ? "Saving..."
                        : "Set Featured"
                  }}
                </button>
              </div>
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
              <h3 class="text-lg font-semibold">Meeting</h3>
              <p
                v-if="selectedBook.meetingStartsAt"
                class="text-sm text-zinc-700 dark:text-zinc-300"
              >
                {{ formatEventDate(selectedBook.meetingStartsAt) }} at
                {{ formatEventTime(selectedBook.meetingStartsAt) }}
                <span v-if="selectedBook.meetingLocation">
                  | {{ selectedBook.meetingLocation }}
                </span>
              </p>
              <p v-else class="text-sm text-zinc-600 dark:text-zinc-400">
                No meeting set for this book yet.
              </p>

              <form v-if="isAdmin" class="card space-y-2" @submit.prevent="saveBookMeeting">
                <p class="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                  Admin controls
                </p>
                <label class="field-label">
                  Meeting Date
                  <FlatPickr
                    v-model="meetingForm.date"
                    :config="meetingDateConfig"
                    class="input"
                  />
                </label>
                <label class="field-label">
                  Meeting Time
                  <input
                    v-model="meetingForm.time"
                    class="input"
                    type="time"
                    required
                  />
                </label>
                <label class="field-label">
                  Meeting Location
                  <input
                    v-model="meetingForm.location"
                    class="input"
                    type="text"
                    maxlength="160"
                    required
                  />
                </label>
                <p
                  v-if="meetingMessage"
                  class="text-sm"
                  :class="
                    meetingMessageTone === 'error'
                      ? 'text-rose-600 dark:text-rose-300'
                      : 'text-emerald-700 dark:text-emerald-300'
                  "
                >
                  {{ meetingMessage }}
                </p>
                <div class="flex gap-2">
                  <button class="btn-primary" :disabled="savingBookMeeting || clearingBookMeeting">
                    {{ savingBookMeeting ? "Saving..." : "Save Meeting" }}
                  </button>
                  <button
                    type="button"
                    class="btn-secondary"
                    :disabled="savingBookMeeting || clearingBookMeeting"
                    @click="resetMeetingForm(selectedBook)"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    class="btn-danger"
                    :disabled="savingBookMeeting || clearingBookMeeting || !selectedBook.meetingStartsAt"
                    @click="clearBookMeeting"
                  >
                    {{ clearingBookMeeting ? "Clearing..." : "Clear" }}
                  </button>
                </div>
              </form>
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
                  <div class="min-w-0">
                    <p>{{ comment.text }}</p>
                    <small class="text-xs text-zinc-500 dark:text-zinc-400">
                      by {{ comment.authorName || "Unknown" }} on {{ formatDate(comment.createdAt) }} at {{ formatCommentTime(comment.createdAt) }}
                    </small>
                  </div>
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
            <button class="btn-secondary" @click="closeBookDetails">Back to Volume</button>
          </section>
        </section>

        <section v-else-if="activeView === 'volume'" class="space-y-4">
          <section class="panel">
            <h2 class="text-3xl font-semibold tracking-tight">{{ greetingMessage }}, {{ firstName }}</h2>
            <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Volume {{ selectedVolumeLabel ?? currentVolume }} dashboard at a glance.
            </p>
          </section>

          <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <article class="card">
              <p class="text-2xl font-semibold">{{ dashboardStats.booksRead }}</p>
              <p class="text-sm text-zinc-600 dark:text-zinc-400">Books in Library</p>
            </article>
            <article class="card">
              <p class="text-2xl font-semibold">{{ dashboardStats.activeMembers }}</p>
              <p class="text-sm text-zinc-600 dark:text-zinc-400">Active Members</p>
            </article>
            <article class="card">
              <p class="text-2xl font-semibold">{{ dashboardStats.discussions }}</p>
              <p class="text-sm text-zinc-600 dark:text-zinc-400">Discussions</p>
            </article>
            <article class="card">
              <p class="text-2xl font-semibold">{{ dashboardStats.upcomingEvents }}</p>
              <p class="text-sm text-zinc-600 dark:text-zinc-400">Upcoming Events</p>
            </article>
            <article class="card">
              <p class="text-2xl font-semibold">{{ selectedVolumeBooks.length }}</p>
              <p class="text-sm text-zinc-600 dark:text-zinc-400">
                Books in Volume {{ selectedVolumeLabel ?? currentVolume }}
              </p>
            </article>
          </section>

          <section class="grid gap-4 xl:grid-cols-[1.5fr,1fr]">
            <button
              v-if="featuredBook"
              type="button"
              class="panel w-full text-left transition hover:-translate-y-0.5 hover:border-emerald-300 dark:hover:border-emerald-600"
              @click="openBookDetails(featuredBook.id)"
            >
              <p class="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                Featured Book
              </p>
              <div class="mt-3 grid gap-4 sm:grid-cols-[160px,1fr] sm:items-start">
                <div class="h-56 w-40 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
                  <img
                    v-if="featuredBook.thumbnailUrl"
                    :src="featuredBook.thumbnailUrl"
                    :alt="`Cover of ${featuredBook.title}`"
                    class="h-full w-full object-cover"
                  />
                  <div
                    v-else
                    class="flex h-full w-full items-center justify-center text-center text-xs text-zinc-500 dark:text-zinc-400"
                  >
                    No cover
                  </div>
                </div>
                <div>
                  <h3 class="text-2xl font-semibold">{{ featuredBook.title }}</h3>
                  <p class="text-zinc-700 dark:text-zinc-300">by {{ featuredBook.author }}</p>
                  <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    {{ featuredBook.month }} {{ featuredBook.year }} in Volume {{ selectedVolumeLabel ?? currentVolume }}
                  </p>
                  <p class="mt-4 text-sm font-medium text-emerald-700 dark:text-emerald-300">Open details</p>
                </div>
              </div>
            </button>
            <section v-else class="panel">
              <h3 class="text-xl font-semibold">Featured Book</h3>
              <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">No featured book set for this volume yet.</p>
            </section>

            <section class="panel space-y-3">
              <h3 class="text-xl font-semibold">
                Schedule for Volume {{ selectedVolumeLabel ?? currentVolume }}
              </h3>
              <p class="text-sm text-zinc-600 dark:text-zinc-400">
                One meeting per book. Admins set each meeting from the book details page.
              </p>
              <p
                v-if="scheduledBooksForVolume.length === 0"
                class="text-sm text-zinc-600 dark:text-zinc-400"
              >
                No meetings assigned for this volume yet.
              </p>
              <ul v-else class="space-y-2">
                <li v-for="book in scheduledBooksForVolume" :key="`meeting-${book.id}`">
                  <button
                    type="button"
                    class="card w-full text-left transition hover:-translate-y-0.5 hover:border-emerald-300 dark:hover:border-emerald-600"
                    @click="openBookDetails(book.id)"
                  >
                    <p class="font-semibold">{{ book.title }}</p>
                    <p class="text-sm text-zinc-600 dark:text-zinc-400">{{ book.author }}</p>
                    <p class="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                      {{ formatEventDate(book.meetingStartsAt) }} at {{ formatEventTime(book.meetingStartsAt) }}
                    </p>
                    <p v-if="book.meetingLocation" class="text-xs text-zinc-500 dark:text-zinc-400">
                      {{ book.meetingLocation }}
                    </p>
                  </button>
                </li>
              </ul>
            </section>
          </section>

          <section class="grid gap-4 xl:grid-cols-[1.5fr,1fr]">
            <section class="panel">
              <h3 class="text-xl font-semibold">Books from Volume {{ selectedVolumeLabel ?? currentVolume }}</h3>
              <p v-if="selectedVolumeBooks.length === 0" class="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                No books in this volume yet.
              </p>
              <div class="mt-3 grid gap-3 lg:grid-cols-2">
                <button
                  v-for="book in selectedVolumeBooks"
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
                        {{ book.comments.length }} comment{{ book.comments.length === 1 ? "" : "s" }}
                      </p>
                      <p class="mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">Open details</p>
                    </div>
                  </div>
                </button>
              </div>
            </section>

            <section class="panel">
              <h3 class="text-xl font-semibold">Club Members</h3>
              <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Visible to everyone. Admins can approve new members in Admin.
              </p>
              <p v-if="members.length === 0" class="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                No active members yet.
              </p>
              <ul v-else class="mt-3 space-y-2">
                <li v-for="member in members" :key="member.id" class="comment-row">
                  <div class="min-w-0">
                    <p class="font-medium text-zinc-900 dark:text-zinc-100">{{ member.name }}</p>
                    <p class="text-xs text-zinc-500 dark:text-zinc-400">
                      Joined {{ formatDate(member.createdAt) }}
                    </p>
                  </div>
                  <div class="shrink-0 text-right">
                    <p
                      class="text-xs font-semibold uppercase tracking-wide"
                      :class="member.role === 'admin' ? 'text-amber-700 dark:text-amber-300' : 'text-zinc-500 dark:text-zinc-400'"
                    >
                      {{ member.role }}
                    </p>
                    <p class="text-xs text-zinc-500 dark:text-zinc-400">
                      {{ member.commentsCount }} comment{{ member.commentsCount === 1 ? "" : "s" }}
                    </p>
                  </div>
                </li>
              </ul>
            </section>
          </section>
        </section>

        <section v-else-if="activeView === 'admin' && isAdmin" class="panel space-y-3">
          <h3 class="text-xl font-semibold">Admin: Import Reading List</h3>
          <p class="text-sm text-zinc-600 dark:text-zinc-400">
            Upload a CSV or JSON file for a selected volume. If your file includes a `volume`
            column, it takes priority over the selected volume. You can also include `year`,
            `isbn`, `meetingStartsAt`, `meetingLocation`, `thumbnailUrl`, and bookseller resource link columns.
          </p>
          <div class="grid gap-3 lg:grid-cols-4 lg:items-end">
            <label class="field-label">
              List
              <select v-model="uploadVolumePreset" class="input">
                <option value="current">Current Books Volume {{ currentVolume }}</option>
                <option value="past">Past Books Volume {{ pastVolume }}</option>
                <option value="custom">Custom Volume</option>
                <option value="csv">Use volume column from CSV</option>
              </select>
            </label>
            <label class="field-label">
              Volume
              <input
                v-model.number="uploadVolume"
                class="input"
                type="number"
                min="1"
                max="99"
                step="1"
                :disabled="uploadVolumePreset !== 'custom'"
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
              :disabled="uploadingReadingList || clearingVolume || clearingUploadHistory || backfillingCovers"
              @click="uploadReadingList"
            >
              {{ uploadingReadingList ? "Uploading..." : "Import" }}
            </button>
            <button
              class="btn-danger"
              :disabled="uploadingReadingList || clearingVolume || clearingUploadHistory || backfillingCovers"
              @click="clearVolumeBooks"
            >
              {{ clearingVolume ? "Clearing..." : "Clear Volume" }}
            </button>
            <button
              class="btn-secondary"
              :disabled="uploadingReadingList || clearingVolume || clearingUploadHistory || backfillingCovers"
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
              Pending Approvals
            </h4>
            <p v-if="pendingUsers.length === 0" class="text-sm text-zinc-600 dark:text-zinc-400">
              No pending users.
            </p>
            <ul v-else class="space-y-2">
              <li v-for="pendingUser in pendingUsers" :key="pendingUser.id" class="comment-row">
                <div class="min-w-0">
                  <p class="font-medium text-zinc-900 dark:text-zinc-100">{{ pendingUser.name }}</p>
                  <p class="truncate text-xs text-zinc-600 dark:text-zinc-400">
                    {{ pendingUser.email }}
                  </p>
                </div>
                <button
                  class="btn-primary shrink-0"
                  :disabled="approvingUserId === String(pendingUser.id)"
                  @click="approvePendingUser(pendingUser)"
                >
                  {{ approvingUserId === String(pendingUser.id) ? "Approving..." : "Approve" }}
                </button>
              </li>
            </ul>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <h4 class="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                Recent Uploads
              </h4>
              <button
                class="btn-secondary px-2 py-1 text-xs"
                :disabled="clearingUploadHistory || uploadHistory.length === 0"
                @click="clearUploadHistory"
              >
                {{ clearingUploadHistory ? "Clearing..." : "Clear History" }}
              </button>
            </div>
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
