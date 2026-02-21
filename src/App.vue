<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from "vue";
import FlatPickr from "vue-flatpickr-component";
import "flatpickr/dist/flatpickr.min.css";
import { useRoute, useRouter } from "vue-router";
import BookCommentThread from "./components/BookCommentThread.vue";

const THEME_KEY = "bookclub.theme.v1";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
const API_ORIGIN = (() => {
  try {
    return new URL(API_BASE).origin;
  } catch {
    return "";
  }
})();
const DEV_QUICK_LOGIN_ENABLED =
  import.meta.env.DEV &&
  String(import.meta.env.VITE_DEV_QUICK_LOGIN_ENABLED || "true").trim().toLowerCase() !== "false";
const DEMO_ACCOUNTS = DEV_QUICK_LOGIN_ENABLED
  ? [
      {
        id: "member",
        label: "Demo Member",
        email: import.meta.env.VITE_DEV_MEMBER_EMAIL || "member@example.com",
        password: import.meta.env.VITE_DEV_MEMBER_PASSWORD || "bookclub123"
      }
    ]
  : [];
const route = useRoute();
const router = useRouter();
const headerRef = ref(null);
const volumeMenuRef = ref(null);
const headerOffset = ref(0);

const loading = ref(true);
const submittingAuth = ref(false);
const completingBookId = ref("");
const ratingBookId = ref("");
const featuringBookId = ref("");
const featureStarAnimatingBookId = ref("");
const savingBookIsbn = ref(false);
const savingBookCover = ref(false);
const deletingBookRecord = ref(false);
const uploadingBookFeaturedImage = ref(false);
const uploadingReadingList = ref(false);
const clearingVolume = ref(false);
const clearingUploadHistory = ref(false);
const backfillingCovers = ref(false);
const backfillingThriftBooks = ref(false);
const uploadingFeaturedFallbacks = ref(false);
const removingFeaturedFallbackUrl = ref("");
const errorMessage = ref("");
const adminMessage = ref("");
const adminMessageTone = ref("success");

const isDark = ref(loadTheme());
const user = ref(null);
const authMode = ref("login");
const activeView = ref("volume");
const adminDrawerOpen = ref(false);
const adminTab = ref("single");

const authForm = ref({
  name: "",
  email: "",
  password: ""
});
const selectedDemoAccountId = ref(DEMO_ACCOUNTS[0]?.id || "");

const currentVolume = ref(2);
const pastVolume = ref(1);
const volumes = ref([]);
const selectedVolume = ref(null);
const showVolumeMenu = ref(false);
const commentDrafts = ref({});
const replyDrafts = ref({});
const activeReplyCommentId = ref("");
const commentActionId = ref("");
const uploadHistory = ref([]);
const featuredImageFallbackUrls = ref([]);
const featuredFallbackDropActive = ref(false);
const pendingUsers = ref([]);
const approvingUserId = ref("");
const denyingUserId = ref("");
const promotingMemberId = ref("");
const uploadMode = ref("append");
const readingListFile = ref(null);
const readingListDropActive = ref(false);
const singleRecordSubmitting = ref(false);
const singleRecordIsbnLookupLoading = ref(false);
const lastSingleRecordLookupIsbn = ref("");
const singleRecordLookupMessage = ref("");
const singleRecordLookupMessageTone = ref("success");
const singleRecordSession = ref([]);
const singleRecordForm = ref({
  volume: "",
  title: "",
  author: "",
  month: "",
  year: "",
  isbn: "",
  thumbnailUrl: "",
  featuredImageUrl: ""
});
const pendingRequestCount = computed(() => pendingUsers.value.length);
const dashboardStats = ref({
  booksRead: 0,
  activeMembers: 0,
  discussions: 0,
  upcomingEvents: 0,
  currentVolumeBooks: 0
});
const members = ref([]);
const memberProfile = ref(null);
const memberRecentComments = ref([]);
const loadingMemberProfile = ref(false);
const savingProfile = ref(false);
const uploadingProfileImage = ref(false);
const profileImageFile = ref(null);
const profileImageDropActive = ref(false);
const profileMessage = ref("");
const profileMessageTone = ref("success");
const profileForm = ref({
  name: ""
});
const savingBookMeeting = ref(false);
const clearingBookMeeting = ref(false);
const meetingMessage = ref("");
const meetingMessageTone = ref("success");
const isbnMessage = ref("");
const isbnMessageTone = ref("success");
const isbnForm = ref({
  isbn: ""
});
const coverMessage = ref("");
const coverMessageTone = ref("success");
const coverForm = ref({
  thumbnailUrl: ""
});
const featuredImageMessage = ref("");
const featuredImageMessageTone = ref("success");
const featuredImageDropActive = ref(false);
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
let headerResizeObserver;

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
const routeMemberId = computed(() => {
  const match = route.path.match(/^\/members\/(\d+)$/);
  return match ? Number(match[1]) : null;
});
const selectedBook = computed(() => {
  if (!routeBookId.value) return null;
  for (const volumeGroup of volumes.value) {
    const found = volumeGroup.books.find((book) => book.id === routeBookId.value);
    if (found) return { ...found, volume: volumeGroup.volume };
  }
  return null;
});
const selectedBookThreadedComments = computed(() => buildThreadedComments(selectedBook.value?.comments || []));
const selectedBookFeaturedImageUrl = computed(() => resolveFeaturedImageUrl(selectedBook.value));
const selectedBookCompletionStats = computed(() => {
  const participants = Math.max(Number(selectedBook.value?.participantsCount || 0), 0);
  const completed = Math.max(Number(selectedBook.value?.completedCount || 0), 0);
  const clampedCompleted = participants > 0 ? Math.min(completed, participants) : completed;
  const percent = participants > 0 ? Math.round((clampedCompleted / participants) * 100) : 0;
  return {
    participants,
    completed: clampedCompleted,
    remaining: Math.max(participants - clampedCompleted, 0),
    percent
  };
});
const selectedBookMeetingActions = computed(() => {
  const book = selectedBook.value;
  if (!book?.meetingStartsAt) {
    return { calendarUrl: "", mapUrl: "" };
  }
  const startsAt = new Date(book.meetingStartsAt);
  if (Number.isNaN(startsAt.getTime())) {
    return { calendarUrl: "", mapUrl: "" };
  }
  const endsAt = new Date(startsAt.getTime() + 90 * 60 * 1000);
  const title = `Stouthearts Book Club: ${book.title}`;
  const details = [
    `Discussion of "${book.title}" by ${book.author}.`,
    `Volume ${book.volume}`,
    book.meetingLocation ? `Location: ${book.meetingLocation}` : ""
  ]
    .filter(Boolean)
    .join("\n");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${toGoogleCalendarDate(startsAt)}/${toGoogleCalendarDate(endsAt)}`,
    details,
    location: book.meetingLocation || ""
  });
  return {
    calendarUrl: `https://calendar.google.com/calendar/render?${params.toString()}`,
    mapUrl: book.meetingLocation
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(book.meetingLocation)}`
      : ""
  };
});
const viewingBookDetails = computed(() => Boolean(routeBookId.value));
const viewingMemberProfile = computed(() => routeMemberId.value !== null);
const isOwnProfile = computed(
  () => Boolean(memberProfile.value && user.value && memberProfile.value.id === user.value.id)
);
const featuredBook = computed(
  () => selectedVolumeBooks.value.find((book) => book.isFeatured) || selectedVolumeBooks.value[0]
);
const featuredBookDisplayImageUrl = computed(() => resolveFeaturedImageUrl(featuredBook.value));
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
const MONTH_OPTIONS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

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
  if (!value) {
    adminDrawerOpen.value = false;
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

watch(routeBookId, (value) => {
  if (!value) {
    adminDrawerOpen.value = false;
  }
});

watch(selectedBook, (value) => {
  if (value && selectedVolume.value !== value.volume) {
    selectedVolume.value = value.volume;
  }
  if (value) {
    resetIsbnForm(value);
    isbnMessage.value = "";
    resetCoverForm(value);
    coverMessage.value = "";
    featuredImageMessage.value = "";
    resetMeetingForm(value);
    meetingMessage.value = "";
    activeReplyCommentId.value = "";
  }
});

watch(
  [routeMemberId, () => user.value?.id],
  async ([memberId, userId]) => {
    if (!memberId) {
      memberProfile.value = null;
      memberRecentComments.value = [];
      profileMessage.value = "";
      return;
    }
    if (!userId) return;
    await loadMemberProfile(memberId);
  },
  { immediate: true }
);

onMounted(async () => {
  await bootstrap();
  await nextTick();
  updateHeaderOffset();
  window.addEventListener("resize", updateHeaderOffset);
  window.addEventListener("pointerdown", handleGlobalPointerDown, true);
  if (typeof ResizeObserver !== "undefined" && headerRef.value) {
    headerResizeObserver = new ResizeObserver(() => {
      updateHeaderOffset();
    });
    headerResizeObserver.observe(headerRef.value);
  }
});

onUnmounted(() => {
  stopPendingUsersPolling();
  if (headerResizeObserver) {
    headerResizeObserver.disconnect();
    headerResizeObserver = undefined;
  }
  window.removeEventListener("pointerdown", handleGlobalPointerDown, true);
  window.removeEventListener("resize", updateHeaderOffset);
});

function handleGlobalPointerDown(event) {
  const target = event.target;
  if (showVolumeMenu.value && volumeMenuRef.value && !volumeMenuRef.value.contains(target)) {
    showVolumeMenu.value = false;
  }
}

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

function updateHeaderOffset() {
  const height = headerRef.value?.getBoundingClientRect().height || 0;
  headerOffset.value = Math.ceil(height);
}

function getSelectedDemoAccount() {
  return DEMO_ACCOUNTS.find((account) => account.id === selectedDemoAccountId.value) || null;
}

function fillDemoCredentials() {
  const account = getSelectedDemoAccount();
  if (!account) return;
  authMode.value = "login";
  authForm.value = {
    name: "",
    email: account.email,
    password: account.password
  };
  resetAuthError();
}

async function signInDemoAccount() {
  fillDemoCredentials();
  await submitAuth();
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

function isUpcomingMeeting(value) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;
  return timestamp > Date.now();
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

function toTimestamp(value) {
  const time = new Date(value || "").getTime();
  return Number.isNaN(time) ? 0 : time;
}

function buildThreadedComments(comments) {
  if (!Array.isArray(comments) || comments.length === 0) return [];

  const nodesById = new Map();
  for (const comment of comments) {
    nodesById.set(comment.id, {
      id: comment.id,
      text: comment.text || "",
      authorName: comment.authorName || "Unknown",
      authorUserId: Number(comment.authorUserId || 0),
      parentCommentId: comment.parentCommentId || null,
      createdAt: comment.createdAt || null,
      likesCount: Number(comment.likesCount || 0),
      isLikedByUser: Boolean(comment.isLikedByUser),
      replies: []
    });
  }

  const roots = [];
  for (const node of nodesById.values()) {
    const parent = node.parentCommentId ? nodesById.get(node.parentCommentId) : null;
    if (parent) {
      parent.replies.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortTree = (items) => {
    items.sort((left, right) => toTimestamp(left.createdAt) - toTimestamp(right.createdAt));
    for (const item of items) {
      if (item.replies.length > 0) sortTree(item.replies);
    }
  };
  sortTree(roots);
  return roots;
}

function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "U";
  return parts
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function normalizeFeaturedImageFallbackUrls(value) {
  if (!Array.isArray(value)) return [];
  const deduped = [];
  const seen = new Set();
  for (const entry of value) {
    const trimmed = String(entry || "").trim();
    if (!trimmed) continue;
    let normalized = "";
    if (trimmed.startsWith("/")) {
      normalized = trimmed;
    } else {
      try {
        const parsed = new URL(trimmed);
        if (!["http:", "https:"].includes(parsed.protocol)) continue;
        normalized = parsed.toString();
      } catch {
        continue;
      }
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

function resolveApiAssetUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!trimmed.startsWith("/")) return trimmed;
  if (!API_ORIGIN) return trimmed;
  return `${API_ORIGIN}${trimmed}`;
}

function getFeaturedImageFallbackForBook(book) {
  const urls = featuredImageFallbackUrls.value;
  if (!book || urls.length === 0) return null;
  const key = [book.volume || "", book.title || "", book.author || "", book.month || "", book.year || ""].join("|");
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return urls[hash % urls.length] || null;
}

function resolveFeaturedImageUrl(book) {
  if (!book) return null;
  return resolveApiAssetUrl(book.featuredImageUrl || getFeaturedImageFallbackForBook(book));
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

function toGoogleCalendarDate(value) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
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
    featuredImageFallbackUrls.value = [];
    dashboardStats.value = {
      booksRead: 0,
      activeMembers: 0,
      discussions: 0,
      upcomingEvents: 0,
      currentVolumeBooks: 0
    };
    members.value = [];
    memberProfile.value = null;
    memberRecentComments.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadBooks() {
  const payload = await api("/books");
  currentVolume.value = payload.currentVolume;
  pastVolume.value = payload.pastVolume;
  const normalizedFallbackUrls = normalizeFeaturedImageFallbackUrls(payload.featuredImageFallbackUrls);
  featuredImageFallbackUrls.value = normalizedFallbackUrls;
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
  if (!singleRecordForm.value.volume) {
    singleRecordForm.value.volume = String(payload.currentVolume || "");
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

async function loadMemberProfile(memberId) {
  loadingMemberProfile.value = true;
  profileMessage.value = "";
  try {
    const payload = await api(`/members/${encodeURIComponent(String(memberId))}`);
    memberProfile.value = payload.member || null;
    memberRecentComments.value = payload.recentComments || [];
    profileForm.value = {
      name: payload.member?.name || ""
    };
    profileImageFile.value = null;
  } catch (error) {
    memberProfile.value = null;
    memberRecentComments.value = [];
    errorMessage.value = error.message;
  } finally {
    loadingMemberProfile.value = false;
  }
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

function resetIsbnForm(book = selectedBook.value) {
  isbnForm.value = {
    isbn: book?.isbn || ""
  };
}

function resetCoverForm(book = selectedBook.value) {
  coverForm.value = {
    thumbnailUrl: book?.thumbnailUrl || ""
  };
}

async function saveBookIsbn() {
  if (!isAdmin.value || !selectedBook.value) return;
  isbnMessage.value = "";
  const isbn = (isbnForm.value.isbn || "").trim();

  savingBookIsbn.value = true;
  try {
    await api(`/admin/books/${encodeURIComponent(selectedBook.value.id)}/isbn`, {
      method: "PUT",
      body: JSON.stringify({
        isbn: isbn || null
      })
    });
    await loadBooks();
    isbnMessageTone.value = "success";
    isbnMessage.value = isbn ? "ISBN saved." : "ISBN cleared.";
  } catch (error) {
    isbnMessageTone.value = "error";
    isbnMessage.value = error.message;
  } finally {
    savingBookIsbn.value = false;
  }
}

async function clearBookIsbn() {
  if (!isAdmin.value || !selectedBook.value) return;
  isbnForm.value = { isbn: "" };
  await saveBookIsbn();
}

async function saveBookCover() {
  if (!isAdmin.value || !selectedBook.value) return;
  coverMessage.value = "";
  const thumbnailUrl = (coverForm.value.thumbnailUrl || "").trim();

  savingBookCover.value = true;
  try {
    await api(`/admin/books/${encodeURIComponent(selectedBook.value.id)}/thumbnail`, {
      method: "PUT",
      body: JSON.stringify({
        thumbnailUrl: thumbnailUrl || null
      })
    });
    await loadBooks();
    coverMessageTone.value = "success";
    coverMessage.value = thumbnailUrl ? "Cover image saved." : "Cover image cleared.";
  } catch (error) {
    coverMessageTone.value = "error";
    coverMessage.value = error.message;
  } finally {
    savingBookCover.value = false;
  }
}

async function clearBookCover() {
  if (!isAdmin.value || !selectedBook.value) return;
  coverForm.value = { thumbnailUrl: "" };
  await saveBookCover();
}

async function deleteSelectedBookRecord() {
  if (!isAdmin.value || !selectedBook.value || deletingBookRecord.value) return;
  const confirmation = window.confirm(
    `Delete "${selectedBook.value.title}" by ${selectedBook.value.author} from Volume ${selectedBook.value.volume} for all members?\n\nThis will permanently remove associated comments, completion history, and ratings for this record.`
  );
  if (!confirmation) return;

  deletingBookRecord.value = true;
  resetAuthError();
  try {
    await api(`/admin/books/${encodeURIComponent(selectedBook.value.id)}`, {
      method: "DELETE"
    });
    await loadBooks();
    await loadDashboard();
    router.push("/");
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    deletingBookRecord.value = false;
  }
}

function extractFilesFromEvent(event) {
  if (event?.target?.files?.length) return Array.from(event.target.files);
  if (event?.dataTransfer?.files?.length) return Array.from(event.dataTransfer.files);
  return [];
}

function extractFileFromEvent(event) {
  return extractFilesFromEvent(event)[0] || null;
}

function clearInputValue(event) {
  if (event?.target && typeof event.target.value === "string") {
    event.target.value = "";
  }
}

async function uploadBookFeaturedImage(file) {
  if (!isAdmin.value || !selectedBook.value) return;
  if (!file) {
    featuredImageMessageTone.value = "error";
    featuredImageMessage.value = "Choose an image file first.";
    return;
  }

  featuredImageMessage.value = "";
  uploadingBookFeaturedImage.value = true;
  try {
    const formData = new FormData();
    formData.append("file", file);
    await api(`/admin/books/${encodeURIComponent(selectedBook.value.id)}/featured-image`, {
      method: "POST",
      body: formData
    });
    await loadBooks();
    featuredImageMessageTone.value = "success";
    featuredImageMessage.value = "Featured image uploaded.";
  } catch (error) {
    featuredImageMessageTone.value = "error";
    featuredImageMessage.value = error.message;
  } finally {
    uploadingBookFeaturedImage.value = false;
  }
}

async function clearBookFeaturedImage() {
  if (!isAdmin.value || !selectedBook.value) return;
  if (!selectedBook.value.featuredImageUrl) return;
  uploadingBookFeaturedImage.value = true;
  featuredImageMessage.value = "";
  try {
    await api(`/admin/books/${encodeURIComponent(selectedBook.value.id)}/featured-image`, {
      method: "DELETE"
    });
    await loadBooks();
    featuredImageMessageTone.value = "success";
    featuredImageMessage.value = "Featured image cleared.";
  } catch (error) {
    featuredImageMessageTone.value = "error";
    featuredImageMessage.value = error.message;
  } finally {
    uploadingBookFeaturedImage.value = false;
  }
}

function onHeaderFeaturedImageDragOver() {
  if (!isAdmin.value || uploadingBookFeaturedImage.value) return;
  featuredImageDropActive.value = true;
}

function onHeaderFeaturedImageDragLeave() {
  featuredImageDropActive.value = false;
}

async function onHeaderFeaturedImageDrop(event) {
  featuredImageDropActive.value = false;
  if (!isAdmin.value || uploadingBookFeaturedImage.value) return;
  const file = extractFileFromEvent(event);
  if (!file) return;
  await uploadBookFeaturedImage(file);
}

async function onHeaderFeaturedImageSelected(event) {
  featuredImageDropActive.value = false;
  const file = extractFileFromEvent(event);
  clearInputValue(event);
  if (!file) return;
  await uploadBookFeaturedImage(file);
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

async function saveProfile() {
  if (!isOwnProfile.value) return;
  profileMessage.value = "";
  const name = (profileForm.value.name || "").trim();
  if (name.length < 2) {
    profileMessageTone.value = "error";
    profileMessage.value = "Name must be at least 2 characters.";
    return;
  }

  savingProfile.value = true;
  try {
    const payload = await api("/users/me/profile", {
      method: "PUT",
      body: JSON.stringify({
        name
      })
    });
    user.value = payload.user;
    await loadBooks();
    await loadDashboard();
    if (memberProfile.value?.id) {
      await loadMemberProfile(memberProfile.value.id);
    }
    profileMessageTone.value = "success";
    profileMessage.value = "Profile updated.";
  } catch (error) {
    profileMessageTone.value = "error";
    profileMessage.value = error.message;
  } finally {
    savingProfile.value = false;
  }
}

function setProfileImageFile(event) {
  profileImageDropActive.value = false;
  profileImageFile.value = extractFileFromEvent(event);
  clearInputValue(event);
}

function onProfileImageDragOver() {
  if (!isOwnProfile.value || uploadingProfileImage.value) return;
  profileImageDropActive.value = true;
}

function onProfileImageDragLeave() {
  profileImageDropActive.value = false;
}

function onProfileImageDrop(event) {
  profileImageDropActive.value = false;
  if (!isOwnProfile.value || uploadingProfileImage.value) return;
  profileImageFile.value = extractFileFromEvent(event);
}

async function uploadProfileImage() {
  if (!isOwnProfile.value) return;
  if (!profileImageFile.value) {
    profileMessageTone.value = "error";
    profileMessage.value = "Choose an image file first.";
    return;
  }

  profileMessage.value = "";
  uploadingProfileImage.value = true;
  try {
    const formData = new FormData();
    formData.append("file", profileImageFile.value);
    const payload = await api("/users/me/profile-image", {
      method: "POST",
      body: formData
    });
    user.value = payload.user;
    profileImageFile.value = null;
    await loadBooks();
    await loadDashboard();
    if (memberProfile.value?.id) {
      await loadMemberProfile(memberProfile.value.id);
    }
    profileMessageTone.value = "success";
    profileMessage.value = "Profile image updated.";
  } catch (error) {
    profileMessageTone.value = "error";
    profileMessage.value = error.message;
  } finally {
    uploadingProfileImage.value = false;
  }
}

async function clearProfileImage() {
  if (!isOwnProfile.value) return;
  profileMessage.value = "";
  uploadingProfileImage.value = true;
  try {
    const payload = await api("/users/me/profile-image", {
      method: "DELETE"
    });
    user.value = payload.user;
    profileImageFile.value = null;
    await loadDashboard();
    if (memberProfile.value?.id) {
      await loadMemberProfile(memberProfile.value.id);
    }
    profileMessageTone.value = "success";
    profileMessage.value = "Profile image removed.";
  } catch (error) {
    profileMessageTone.value = "error";
    profileMessage.value = error.message;
  } finally {
    uploadingProfileImage.value = false;
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
    completingBookId.value = "";
    ratingBookId.value = "";
    volumes.value = [];
    selectedVolume.value = null;
    showVolumeMenu.value = false;
    commentDrafts.value = {};
    replyDrafts.value = {};
    activeReplyCommentId.value = "";
    commentActionId.value = "";
    uploadHistory.value = [];
    featuredImageFallbackUrls.value = [];
    featuredFallbackDropActive.value = false;
    removingFeaturedFallbackUrl.value = "";
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
    memberProfile.value = null;
    memberRecentComments.value = [];
    profileForm.value = { name: "" };
    profileImageFile.value = null;
    profileMessage.value = "";
    meetingForm.value = { date: "", time: "", location: "" };
    meetingMessage.value = "";
    isbnForm.value = { isbn: "" };
    isbnMessage.value = "";
    coverForm.value = { thumbnailUrl: "" };
    coverMessage.value = "";
    featuredImageMessage.value = "";
    adminTab.value = "single";
    singleRecordSession.value = [];
    uploadingFeaturedFallbacks.value = false;
    resetSingleRecordForm();
    activeView.value = "volume";
    await router.push("/");
  }
}

function canDeleteComment(comment) {
  if (!comment || !user.value) return false;
  return user.value.role === "admin" || Number(comment.authorUserId) === Number(user.value.id);
}

function toggleReplyComposer(commentId) {
  if (!commentId) return;
  activeReplyCommentId.value = activeReplyCommentId.value === commentId ? "" : commentId;
}

function setReplyDraft(commentId, value) {
  if (!commentId) return;
  replyDrafts.value[commentId] = value;
}

async function addComment(bookId, options = {}) {
  const parentCommentId = options.parentCommentId || null;
  const draftSource = parentCommentId ? replyDrafts.value[parentCommentId] : commentDrafts.value[bookId];
  const text = (draftSource || "").trim();
  if (!text) return;

  commentActionId.value = parentCommentId ? `reply:${parentCommentId}` : `comment:${bookId}`;
  resetAuthError();
  try {
    await api(`/books/${bookId}/comments`, {
      method: "POST",
      body: JSON.stringify({ text, parentCommentId })
    });
    if (parentCommentId) {
      replyDrafts.value[parentCommentId] = "";
      activeReplyCommentId.value = "";
    } else {
      commentDrafts.value[bookId] = "";
    }
    await loadBooks();
    await loadDashboard();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    commentActionId.value = "";
  }
}

async function deleteComment(bookId, comment) {
  if (!bookId || !comment?.id || !canDeleteComment(comment)) return;
  const confirmation = window.confirm("Delete this comment and any replies?");
  if (!confirmation) return;

  commentActionId.value = `delete:${comment.id}`;
  resetAuthError();
  try {
    await api(`/books/${encodeURIComponent(bookId)}/comments/${encodeURIComponent(comment.id)}`, {
      method: "DELETE"
    });
    replyDrafts.value = {};
    if (activeReplyCommentId.value === comment.id) {
      activeReplyCommentId.value = "";
    }
    await loadBooks();
    await loadDashboard();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    commentActionId.value = "";
  }
}

async function toggleCommentLike(bookId, comment) {
  if (!bookId || !comment?.id) return;
  commentActionId.value = `like:${comment.id}`;
  resetAuthError();
  try {
    await api(`/books/${encodeURIComponent(bookId)}/comments/${encodeURIComponent(comment.id)}/like`, {
      method: "PUT",
      body: JSON.stringify({ liked: !comment.isLikedByUser })
    });
    await loadBooks();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    commentActionId.value = "";
  }
}

async function setBookCompletion(bookId, completed) {
  if (!bookId) return;
  completingBookId.value = bookId;
  resetAuthError();
  try {
    await api(`/books/${encodeURIComponent(bookId)}/completion`, {
      method: "PUT",
      body: JSON.stringify({ completed })
    });
    await loadBooks();
    await loadDashboard();
    if (routeMemberId.value) {
      await loadMemberProfile(routeMemberId.value);
    }
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    completingBookId.value = "";
  }
}

async function setBookRating(bookId, rating) {
  if (!bookId) return;
  ratingBookId.value = bookId;
  resetAuthError();
  try {
    await api(`/books/${encodeURIComponent(bookId)}/rating`, {
      method: "PUT",
      body: JSON.stringify({ rating })
    });
    await loadBooks();
    await loadDashboard();
    if (routeMemberId.value) {
      await loadMemberProfile(routeMemberId.value);
    }
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    ratingBookId.value = "";
  }
}

async function clearBookRating(bookId) {
  if (!bookId) return;
  ratingBookId.value = bookId;
  resetAuthError();
  try {
    await api(`/books/${encodeURIComponent(bookId)}/rating`, {
      method: "DELETE"
    });
    await loadBooks();
    await loadDashboard();
    if (routeMemberId.value) {
      await loadMemberProfile(routeMemberId.value);
    }
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    ratingBookId.value = "";
  }
}

async function setFeaturedBookForVolume(bookId) {
  if (!bookId) return;
  featureStarAnimatingBookId.value = bookId;
  window.setTimeout(() => {
    if (featureStarAnimatingBookId.value === bookId) {
      featureStarAnimatingBookId.value = "";
    }
  }, 280);
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
  if (value === "backfill-thriftbooks") return "Backfill ThriftBooks";
  if (value === "clear") return "Clear Volume";
  return value === "replace" ? "Replace" : "Append";
}

function setReadingListFile(event) {
  readingListDropActive.value = false;
  readingListFile.value = extractFileFromEvent(event);
  clearInputValue(event);
}

function onReadingListDragOver() {
  if (!isAdmin.value || uploadingReadingList.value) return;
  readingListDropActive.value = true;
}

function onReadingListDragLeave() {
  readingListDropActive.value = false;
}

function onReadingListDrop(event) {
  readingListDropActive.value = false;
  if (!isAdmin.value || uploadingReadingList.value) return;
  readingListFile.value = extractFileFromEvent(event);
}

function resetSingleRecordForm() {
  singleRecordForm.value = {
    volume: String(currentVolume.value || ""),
    title: "",
    author: "",
    month: "",
    year: "",
    isbn: "",
    thumbnailUrl: "",
    featuredImageUrl: ""
  };
  lastSingleRecordLookupIsbn.value = "";
  singleRecordLookupMessage.value = "";
}

function clearSingleRecordSession() {
  singleRecordSession.value = [];
}

function normalizeIsbnInput(value) {
  const compact = String(value || "")
    .replace(/[^0-9Xx]/g, "")
    .toUpperCase();
  if (!compact) return "";
  return /^(?:\d{9}[\dX]|\d{13})$/.test(compact) ? compact : "";
}

async function autofillSingleRecordFromIsbn(force = false) {
  const normalizedIsbn = normalizeIsbnInput(singleRecordForm.value.isbn);
  if (!normalizedIsbn) {
    if (force) {
      singleRecordLookupMessageTone.value = "error";
      singleRecordLookupMessage.value = "Enter a valid ISBN-10 or ISBN-13 first.";
    }
    return;
  }
  if (!force && normalizedIsbn === lastSingleRecordLookupIsbn.value) return;

  singleRecordIsbnLookupLoading.value = true;
  singleRecordLookupMessage.value = "";
  try {
    const payload = await api("/admin/reading-list/isbn-lookup", {
      method: "POST",
      body: JSON.stringify({ isbn: normalizedIsbn })
    });
    const book = payload.book || {};
    singleRecordForm.value.isbn = book.isbn || normalizedIsbn;
    if (book.title) singleRecordForm.value.title = book.title;
    if (book.author) singleRecordForm.value.author = book.author;
    if (book.thumbnailUrl) singleRecordForm.value.thumbnailUrl = book.thumbnailUrl;
    if (!singleRecordForm.value.month && book.month) {
      singleRecordForm.value.month = book.month;
    }
    lastSingleRecordLookupIsbn.value = normalizedIsbn;
    singleRecordLookupMessageTone.value = "success";
    singleRecordLookupMessage.value = "Autofilled available fields from ISBN.";
  } catch (error) {
    singleRecordLookupMessageTone.value = "error";
    singleRecordLookupMessage.value = error.message;
  } finally {
    singleRecordIsbnLookupLoading.value = false;
  }
}

async function submitSingleRecord() {
  adminMessage.value = "";
  const featuredImageUrl = singleRecordForm.value.featuredImageUrl.trim();
  const payload = {
    mode: uploadMode.value,
    volume: Number(singleRecordForm.value.volume),
    title: singleRecordForm.value.title.trim(),
    author: singleRecordForm.value.author.trim(),
    month: singleRecordForm.value.month,
    year: Number(singleRecordForm.value.year),
    isbn: singleRecordForm.value.isbn.trim(),
    thumbnailUrl: singleRecordForm.value.thumbnailUrl.trim(),
    featuredImageUrl: featuredImageUrl || undefined
  };

  if (
    !Number.isInteger(payload.volume) ||
    payload.volume < 1 ||
    payload.volume > 99 ||
    !payload.title ||
    !payload.author ||
    !payload.month ||
    !Number.isInteger(payload.year) ||
    payload.year < 2025 ||
    payload.year > 2100 ||
    !payload.isbn ||
    !payload.thumbnailUrl
  ) {
    adminMessageTone.value = "error";
    adminMessage.value = "Complete all required fields before adding a record.";
    return;
  }
  if (payload.featuredImageUrl) {
    try {
      new URL(payload.featuredImageUrl);
    } catch {
      adminMessageTone.value = "error";
      adminMessage.value = "Featured image URL must be a valid URL.";
      return;
    }
  }

  singleRecordSubmitting.value = true;
  try {
    const response = await api("/admin/reading-list/record", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await loadBooks();
    await loadDashboard();
    await loadUploadHistory();
    singleRecordSession.value.unshift({
      id: `${Date.now()}-${Math.random()}`,
      ...payload
    });
    adminMessageTone.value = "success";
    adminMessage.value = `Added 1 record for Volume ${payload.volume}. Inserted ${response.summary.booksInserted}, updated ${response.summary.booksUpdated}.`;
    resetSingleRecordForm();
  } catch (error) {
    adminMessageTone.value = "error";
    adminMessage.value = error.message;
  } finally {
    singleRecordSubmitting.value = false;
  }
}

async function uploadReadingList() {
  adminMessage.value = "";
  if (!readingListFile.value) {
    adminMessageTone.value = "error";
    adminMessage.value = "Select a CSV or JSON file first.";
    return;
  }

  const formData = new FormData();
  formData.append("mode", uploadMode.value);
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
    adminMessage.value = `Imported ${payload.summary.rowsReceived} row(s) from CSV volumes. Inserted ${payload.summary.booksInserted}, updated ${payload.summary.booksUpdated}.`;
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
  const rawInput = window.prompt("Enter the Volume number to clear (1-99):", "");
  if (rawInput === null) return;
  const volume = Number(rawInput);
  if (!Number.isInteger(volume) || volume < 1 || volume > 99) {
    adminMessageTone.value = "error";
    adminMessage.value = "Enter a valid volume number between 1 and 99.";
    return;
  }
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

async function backfillThriftBooksResources() {
  adminMessage.value = "";
  backfillingThriftBooks.value = true;
  try {
    const payload = await api("/admin/reading-list/backfill-thriftbooks", {
      method: "POST"
    });
    await loadBooks();
    await loadUploadHistory();
    adminMessageTone.value = "success";
    adminMessage.value = `ThriftBooks backfill complete. Updated ${payload.summary.booksUpdated} book resource list(s) from ${payload.summary.candidates} candidate record(s).`;
  } catch (error) {
    adminMessageTone.value = "error";
    adminMessage.value = error.message;
  } finally {
    backfillingThriftBooks.value = false;
  }
}

async function uploadFeaturedFallbackImages(files) {
  if (!isAdmin.value) return;
  const selectedFiles = Array.isArray(files) ? files.filter(Boolean) : [];
  if (selectedFiles.length === 0) {
    adminMessageTone.value = "error";
    adminMessage.value = "Choose one or more images first.";
    return;
  }

  adminMessage.value = "";
  uploadingFeaturedFallbacks.value = true;
  try {
    const formData = new FormData();
    for (const file of selectedFiles) {
      formData.append("files", file);
    }
    const payload = await api("/admin/settings/featured-image-fallbacks/upload", {
      method: "POST",
      body: formData
    });
    featuredImageFallbackUrls.value = normalizeFeaturedImageFallbackUrls(payload.urls);
    adminMessageTone.value = "success";
    adminMessage.value = `Uploaded ${payload.uploaded || selectedFiles.length} fallback image(s).`;
  } catch (error) {
    adminMessageTone.value = "error";
    adminMessage.value = error.message;
  } finally {
    uploadingFeaturedFallbacks.value = false;
  }
}

function onFeaturedFallbackDragOver() {
  if (!isAdmin.value || uploadingFeaturedFallbacks.value) return;
  featuredFallbackDropActive.value = true;
}

function onFeaturedFallbackDragLeave() {
  featuredFallbackDropActive.value = false;
}

async function onFeaturedFallbackDrop(event) {
  featuredFallbackDropActive.value = false;
  if (!isAdmin.value || uploadingFeaturedFallbacks.value) return;
  const files = extractFilesFromEvent(event);
  if (files.length === 0) return;
  await uploadFeaturedFallbackImages(files);
}

async function onFeaturedFallbackSelected(event) {
  featuredFallbackDropActive.value = false;
  const files = extractFilesFromEvent(event);
  clearInputValue(event);
  if (files.length === 0) return;
  await uploadFeaturedFallbackImages(files);
}

async function removeFeaturedFallbackImage(url) {
  if (!isAdmin.value || !url || removingFeaturedFallbackUrl.value) return;
  removingFeaturedFallbackUrl.value = url;
  adminMessage.value = "";
  try {
    const payload = await api("/admin/settings/featured-image-fallbacks", {
      method: "DELETE",
      body: JSON.stringify({ url })
    });
    featuredImageFallbackUrls.value = normalizeFeaturedImageFallbackUrls(payload.urls);
    adminMessageTone.value = "success";
    adminMessage.value = "Fallback image removed.";
  } catch (error) {
    adminMessageTone.value = "error";
    adminMessage.value = error.message;
  } finally {
    removingFeaturedFallbackUrl.value = "";
  }
}

async function clearFeaturedImageFallbacks() {
  if (!isAdmin.value || featuredImageFallbackUrls.value.length === 0) return;
  const confirmed = window.confirm("Clear all uploaded fallback images?");
  if (!confirmed) return;

  uploadingFeaturedFallbacks.value = true;
  adminMessage.value = "";
  try {
    const payload = await api("/admin/settings/featured-image-fallbacks", {
      method: "PUT",
      body: JSON.stringify({ urls: [] })
    });
    featuredImageFallbackUrls.value = normalizeFeaturedImageFallbackUrls(payload.urls);
    adminMessageTone.value = "success";
    adminMessage.value = "Cleared fallback images.";
  } catch (error) {
    adminMessageTone.value = "error";
    adminMessage.value = error.message;
  } finally {
    uploadingFeaturedFallbacks.value = false;
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

async function denyPendingUser(pendingUser) {
  if (!pendingUser?.id) return;
  denyingUserId.value = String(pendingUser.id);
  adminMessage.value = "";
  try {
    await api(`/admin/users/${encodeURIComponent(String(pendingUser.id))}/deny`, {
      method: "POST"
    });
    await loadPendingUsers();
    adminMessageTone.value = "success";
    adminMessage.value = `Denied ${pendingUser.email}.`;
  } catch (error) {
    adminMessageTone.value = "error";
    adminMessage.value = error.message;
  } finally {
    denyingUserId.value = "";
  }
}

async function promoteMember(member) {
  if (!isAdmin.value || !member?.id || member.role === "admin") return;
  const confirmed = window.confirm(`Grant admin privileges to ${member.name}?`);
  if (!confirmed) return;

  promotingMemberId.value = String(member.id);
  adminMessage.value = "";
  try {
    await api(`/admin/users/${encodeURIComponent(String(member.id))}/promote`, {
      method: "POST"
    });
    await loadDashboard();
    if (routeMemberId.value === Number(member.id)) {
      await loadMemberProfile(Number(member.id));
    }
    adminMessageTone.value = "success";
    adminMessage.value = `${member.name} is now an admin.`;
  } catch (error) {
    adminMessageTone.value = "error";
    adminMessage.value = error.message;
  } finally {
    promotingMemberId.value = "";
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

function goHome() {
  activeView.value = "volume";
  showVolumeMenu.value = false;
  router.push("/");
}

function openBookDetails(bookId) {
  showVolumeMenu.value = false;
  router.push(`/books/${encodeURIComponent(bookId)}`);
}

function closeBookDetails() {
  adminDrawerOpen.value = false;
  activeReplyCommentId.value = "";
  replyDrafts.value = {};
  router.push("/");
}

function openMemberProfile(memberId) {
  if (!memberId) return;
  activeView.value = "volume";
  showVolumeMenu.value = false;
  router.push(`/members/${encodeURIComponent(String(memberId))}`);
}

function closeMemberProfile() {
  router.push("/");
}
</script>

<template>
  <main class="min-h-screen bg-[#F2EFDF] text-[#23260F] dark:bg-[#0F1115] dark:text-[#E6E8ED]">
    <header
      ref="headerRef"
      class="fixed inset-x-0 top-0 z-40 border-b border-[#D8D2C3] bg-[#F2EFDF]/95 backdrop-blur dark:border-[#313947] dark:bg-[#0F1115]/95"
    >
      <div class="mx-auto flex w-full max-w-screen-2xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <div class="flex min-w-0 flex-wrap items-center gap-3 sm:gap-6">
            <button
              type="button"
              class="text-left transition hover:opacity-90"
              @click="goHome"
            >
              <h1 class="brand-title-shadow text-4xl font-bold tracking-tight">Stout Hearts</h1>
              <p class="mt-1 text-zinc-600 dark:text-zinc-300">Book club tracker</p>
            </button>
            <nav v-if="user" class="flex flex-wrap items-center gap-2">
              <div ref="volumeMenuRef" class="relative">
                <button
                  class="btn-tab icon-btn"
                  :class="{ 'btn-tab-active': activeView === 'volume' }"
                  @click="toggleVolumeMenu"
                >
                  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6" />
                  </svg>
                  <span>Volume</span>
                  <span v-if="selectedVolumeLabel !== null"> {{ selectedVolumeLabel }}</span>
                </button>
                <div
                  v-if="showVolumeMenu"
                  class="absolute left-0 z-20 mt-2 min-w-56 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-[#313947] dark:bg-[#151A22]"
                >
                  <button
                    v-for="volumeGroup in volumes"
                    :key="volumeGroup.volume"
                    class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    @click="openVolume(volumeGroup.volume)"
                  >
                    <span>Volume {{ volumeGroup.volume }}</span>
                    <span class="text-xs text-zinc-500 dark:text-zinc-300">{{ volumeGroup.books.length }}</span>
                  </button>
                  <p v-if="volumes.length === 0" class="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-300">
                    No volumes yet.
                  </p>
                </div>
              </div>
              <button
                v-if="isAdmin"
                class="btn-tab icon-btn"
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
                <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 3l7 3v6c0 4.3-2.8 7.6-7 9-4.2-1.4-7-4.7-7-9V6l7-3Z" />
                </svg>
                <span>Admin</span>
                <span
                  v-if="pendingRequestCount > 0"
                  class="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-[#A62014] px-1.5 py-0.5 text-xs font-semibold leading-none text-white"
                >
                  {{ pendingRequestCount > 99 ? "99+" : pendingRequestCount }}
                </span>
              </button>
            </nav>
          </div>
          <div class="flex items-center gap-2 sm:gap-3">
            <button
              v-if="user"
              class="btn-secondary inline-flex items-center gap-2 px-2 py-1.5"
              @click="openMemberProfile(user.id)"
            >
              <span class="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 text-xs font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                <img
                  v-if="user.profileImageUrl"
                  :src="resolveApiAssetUrl(user.profileImageUrl)"
                  :alt="`${user.name} profile image`"
                  class="h-full w-full object-cover"
                />
                <span v-else>{{ getInitials(user.name) }}</span>
              </span>
              <span class="text-sm text-zinc-600 dark:text-zinc-300">
                {{ user.name }} ({{ user.role }})
              </span>
            </button>
            <button v-if="user" class="btn-secondary icon-btn" @click="logout">
              <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 17l5-5-5-5" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M20 12H9" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7" />
              </svg>
              <span>Sign out</span>
            </button>
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

    <div class="mx-auto max-w-6xl px-4 pb-8 sm:px-6 lg:px-8" :style="{ paddingTop: `${headerOffset + 24}px` }">

      <section v-if="loading" class="panel">
        <p>Loading...</p>
      </section>

      <section v-else-if="!user" class="mx-auto max-w-md">
        <article class="panel">
          <h2 class="text-2xl font-semibold">
            {{ authMode === "login" ? "Sign in" : "Create account" }}
          </h2>
          <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
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
            <p v-if="authMode === 'register'" class="text-xs text-zinc-500 dark:text-zinc-300">
              Use at least 8 characters with letters and numbers.
            </p>
            <p v-if="errorMessage" class="text-sm text-[#A62014] dark:text-[#A62014]">
              {{ errorMessage }}
            </p>
            <button class="btn-primary icon-btn w-full justify-center" :disabled="submittingAuth">
              <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path
                  v-if="authMode === 'login'"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M15 17l5-5-5-5M20 12H9M12 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7"
                />
                <path
                  v-else
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 5v14M5 12h14"
                />
              </svg>
              <span>{{ submittingAuth ? "Please wait..." : authMode === "login" ? "Sign in" : "Create account" }}</span>
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

          <section
            v-if="DEMO_ACCOUNTS.length > 0"
            class="mt-5 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-3 dark:border-[#313947] dark:bg-[#171B22]/75"
          >
            <p class="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
              Dev Quick Login
            </p>
            <div class="mt-2 grid gap-2 sm:grid-cols-[1fr,auto,auto] sm:items-end">
              <label class="field-label">
                Account
                <select v-model="selectedDemoAccountId" class="input">
                  <option v-for="account in DEMO_ACCOUNTS" :key="account.id" :value="account.id">
                    {{ account.label }}
                  </option>
                </select>
              </label>
              <button class="btn-secondary icon-btn" type="button" @click="fillDemoCredentials">
                <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v18M3 12h18" />
                </svg>
                <span>Fill</span>
              </button>
              <button class="btn-primary icon-btn" type="button" :disabled="submittingAuth" @click="signInDemoAccount">
                <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 17l5-5-5-5M20 12H9M12 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7" />
                </svg>
                <span>{{ submittingAuth ? "Signing in..." : "Sign in demo" }}</span>
              </button>
            </div>
            <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-300">
              Development only.
            </p>
          </section>
        </article>
      </section>

      <section v-else class="space-y-4">
        <p v-if="errorMessage" class="text-sm text-[#A62014] dark:text-[#A62014]">
          {{ errorMessage }}
        </p>

        <section v-if="activeView === 'volume' && viewingBookDetails" class="space-y-4">
          <section v-if="selectedBook" class="panel space-y-4">
            <div class="flex items-center justify-between gap-3">
              <button class="btn-secondary icon-btn" @click="closeBookDetails">
                <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6" />
                </svg>
                <span>Back to Volume</span>
              </button>
              <div class="flex items-center gap-2 sm:gap-3">
                <p class="text-sm text-zinc-600 dark:text-zinc-300">Volume {{ selectedBook.volume }}</p>
                <p
                  v-if="selectedBook.isFeatured"
                  class="text-xs font-semibold uppercase tracking-wide text-[#C8963E] dark:text-[#C8963E]"
                >
                  Featured for Volume
                </p>
                <button
                  v-if="isAdmin"
                  type="button"
                  class="btn-secondary icon-btn px-3 py-1 text-xs"
                  :aria-expanded="adminDrawerOpen ? 'true' : 'false'"
                  @click="adminDrawerOpen = true"
                >
                  <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M19.4 15a1.8 1.8 0 0 0 .36 2l.07.08a2.2 2.2 0 1 1-3.1 3.1l-.09-.07a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.09 1.65V22a2.2 2.2 0 0 1-4.4 0v-.11a1.8 1.8 0 0 0-1.08-1.65 1.8 1.8 0 0 0-2 .36l-.1.07a2.2 2.2 0 1 1-3.1-3.1l.08-.08a1.8 1.8 0 0 0 .36-2 1.8 1.8 0 0 0-1.65-1.09H2.2a2.2 2.2 0 1 1 0-4.4h.12a1.8 1.8 0 0 0 1.65-1.08 1.8 1.8 0 0 0-.36-2l-.08-.1a2.2 2.2 0 1 1 3.1-3.1l.1.08a1.8 1.8 0 0 0 2 .36H8.8a1.8 1.8 0 0 0 1.09-1.65V2.2a2.2 2.2 0 1 1 4.4 0v.12a1.8 1.8 0 0 0 1.08 1.65 1.8 1.8 0 0 0 2-.36l.09-.08a2.2 2.2 0 1 1 3.1 3.1l-.07.1a1.8 1.8 0 0 0-.36 2v.04a1.8 1.8 0 0 0 1.64 1.07h.12a2.2 2.2 0 1 1 0 4.4h-.12a1.8 1.8 0 0 0-1.64 1.08V15Z"
                    />
                  </svg>
                  <span>Admin Settings</span>
                </button>
              </div>
            </div>

            <section class="overflow-visible rounded-xl bg-zinc-50/50 dark:bg-[#171B22]/75">
              <div
                class="relative h-44 overflow-hidden rounded-t-xl transition sm:h-56"
                :class="isAdmin && featuredImageDropActive ? 'ring-2 ring-inset ring-[#C8963E]' : ''"
                @dragenter.prevent="onHeaderFeaturedImageDragOver"
                @dragover.prevent="onHeaderFeaturedImageDragOver"
                @dragleave.prevent="onHeaderFeaturedImageDragLeave"
                @drop.prevent="onHeaderFeaturedImageDrop"
              >
                <img
                  v-if="selectedBookFeaturedImageUrl"
                  :src="selectedBookFeaturedImageUrl"
                  :alt="`Featured header for ${selectedBook.title}`"
                  class="absolute inset-0 h-full w-full object-cover"
                  style="
                    -webkit-mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 1) 62%, rgba(0, 0, 0, 0) 100%);
                    mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 1) 62%, rgba(0, 0, 0, 0) 100%);
                  "
                />
                <div
                  v-else
                  class="absolute inset-0 flex items-center justify-center bg-zinc-100 text-xs font-medium text-zinc-500 dark:bg-[#1D232D] dark:text-zinc-300"
                >
                  Add a featured image or configure admin fallback images.
                </div>
                <div class="absolute inset-0 bg-gradient-to-b from-zinc-950/25 via-zinc-950/5 to-transparent"></div>
                <div
                  v-if="isAdmin && featuredImageDropActive"
                  class="absolute inset-0 z-10 flex items-center justify-center bg-black/35 text-xs font-semibold uppercase tracking-wide text-white"
                >
                  Drop image to upload
                </div>
                <label
                  v-if="isAdmin"
                  class="absolute right-3 top-3 z-20 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/60 bg-black/45 text-white shadow transition hover:bg-black/65"
                  :class="uploadingBookFeaturedImage ? 'pointer-events-none opacity-60' : ''"
                  title="Upload featured header image"
                  aria-label="Upload featured header image"
                >
                  <input
                    class="sr-only"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    :disabled="uploadingBookFeaturedImage"
                    @change="onHeaderFeaturedImageSelected"
                  />
                  <svg
                    class="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 16V6"></path>
                    <path d="m8 10 4-4 4 4"></path>
                    <path d="M4 18.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5"></path>
                  </svg>
                </label>
              </div>
              <div class="relative min-h-[10rem] px-4 pb-4 pl-36 pt-16 sm:min-h-[11rem] sm:px-6 sm:pb-6 sm:pl-48 sm:pt-8">
                <div
                  class="absolute -top-20 left-4 h-48 w-32 overflow-hidden rounded-lg bg-transparent shadow-lg ring-1 ring-black/10 dark:ring-white/10 sm:-top-24 sm:h-56 sm:w-36"
                >
                  <button
                    v-if="isAdmin"
                    type="button"
                    class="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/70 bg-black/55 text-white shadow transition hover:bg-black/70"
                    :class="
                      selectedBook.isFeatured
                        ? 'border-[#C8963E]/90 bg-black/75 text-[#C8963E] hover:bg-black/75'
                        : 'text-[#F2EFDF]'
                    "
                    :disabled="featuringBookId === selectedBook.id"
                    :aria-disabled="selectedBook.isFeatured || featuringBookId === selectedBook.id ? 'true' : 'false'"
                    :title="
                      selectedBook.isFeatured
                        ? 'Already the featured book for this volume'
                        : featuringBookId === selectedBook.id
                          ? 'Setting featured book...'
                          : 'Set this as the featured book for this volume'
                    "
                    :aria-label="
                      selectedBook.isFeatured
                        ? 'Already the featured book for this volume'
                        : featuringBookId === selectedBook.id
                          ? 'Setting featured book'
                          : 'Set this as the featured book for this volume'
                    "
                    :data-feature-star-animate="featureStarAnimatingBookId === selectedBook.id ? 'true' : 'false'"
                    @click="!selectedBook.isFeatured && setFeaturedBookForVolume(selectedBook.id)"
                  >
                    <svg
                      class="h-4 w-4"
                      :class="selectedBook.isFeatured ? 'text-[#C8963E]' : ''"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        d="M12 3.5 14.8 9l6.1.9-4.4 4.3 1 6.1L12 17.6l-5.5 2.7 1-6.1L3.1 9.9 9.2 9 12 3.5Z"
                      />
                    </svg>
                  </button>
                  <img
                    v-if="selectedBook.thumbnailUrl"
                    :src="resolveApiAssetUrl(selectedBook.thumbnailUrl)"
                    :alt="`Cover of ${selectedBook.title}`"
                    class="h-full w-full object-cover"
                  />
                  <div
                    v-else
                    class="flex h-full w-full items-center justify-center text-center text-xs text-zinc-500 dark:text-zinc-300"
                  >
                    No cover image
                  </div>
                </div>
                <h2 class="text-3xl font-semibold sm:text-4xl">{{ selectedBook.title }}</h2>
                <p class="mt-1 text-zinc-700 dark:text-zinc-300">by {{ selectedBook.author }}</p>
                <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                  {{ selectedBook.month }} {{ selectedBook.year }}
                </p>
                <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-300">
                  ISBN: {{ selectedBook.isbn || "Not set" }}
                </p>
              </div>
            </section>
            <p
              v-if="featuredImageMessage"
              class="text-sm"
              :class="
                featuredImageMessageTone === 'error'
                  ? 'text-[#A62014] dark:text-[#A62014]'
                  : 'text-[#C8963E] dark:text-[#C8963E]'
              "
            >
              {{ featuredImageMessage }}
            </p>

            <div class="grid gap-4 lg:grid-cols-[1.4fr,1fr]">
              <article class="card space-y-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <h3 class="text-xl font-semibold">Reading Status</h3>
                  <span class="rounded-full bg-[#F2EFDF] px-3 py-1 text-xs font-semibold text-[#313947] dark:bg-[#151A22]/75 dark:text-[#F2EFDF]">
                    {{ selectedBookCompletionStats.completed }} / {{ selectedBookCompletionStats.participants }} completed
                  </span>
                </div>
                <div class="h-2 w-full overflow-hidden rounded-full bg-zinc-300 dark:bg-[#3A4252]">
                  <div
                    class="h-full rounded-full bg-[#1F9D8A] transition-[width] duration-500 dark:bg-[#26B39D]"
                    :style="{ width: `${selectedBookCompletionStats.percent}%` }"
                  ></div>
                </div>
                <p class="text-sm text-zinc-600 dark:text-zinc-300">
                  {{
                    selectedBookCompletionStats.participants > 0
                      ? `${selectedBookCompletionStats.remaining} member${selectedBookCompletionStats.remaining === 1 ? "" : "s"} still reading.`
                      : "Member completion stats will appear as members mark this book complete."
                  }}
                </p>

                <div class="flex flex-wrap items-center gap-2">
                  <p v-if="selectedBook.isCompleted" class="text-sm text-[#1F9D8A] dark:text-[#26B39D]">
                    Completed
                    <span v-if="selectedBook.completedAt">
                      on {{ formatDate(selectedBook.completedAt) }} at {{ formatCommentTime(selectedBook.completedAt) }}
                    </span>
                  </p>
                  <p v-else class="text-sm text-zinc-600 dark:text-zinc-300">Not completed yet.</p>
                  <button
                    class="btn-secondary icon-btn"
                    :disabled="completingBookId === selectedBook.id"
                    @click="setBookCompletion(selectedBook.id, !selectedBook.isCompleted)"
                  >
                    <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                      <path
                        v-if="selectedBook.isCompleted"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M6 12h12M12 6v12"
                      />
                      <path
                        v-else
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="m20 6-11 11-5-5"
                      />
                    </svg>
                    <span>{{
                      completingBookId === selectedBook.id
                        ? "Saving..."
                        : selectedBook.isCompleted
                          ? "Mark as Not Completed"
                          : "Mark as Completed"
                    }}</span>
                  </button>
                </div>

                <div class="border-t border-zinc-200 pt-3 dark:border-zinc-700">
                  <p class="text-sm text-zinc-700 dark:text-zinc-300">Club Rating</p>
                  <div class="mt-1 flex items-center gap-2">
                    <div class="flex items-center gap-0.5 text-base">
                      <span
                        v-for="star in 5"
                        :key="`avg-${selectedBook.id}-${star}`"
                        :class="
                          selectedBook.ratingsCount > 0 && star <= Math.round(selectedBook.averageRating || 0)
                            ? 'text-amber-500'
                            : 'text-zinc-300 dark:text-zinc-400'
                        "
                      >
                        ★
                      </span>
                    </div>
                    <p class="text-sm text-zinc-600 dark:text-zinc-300">
                      <span v-if="selectedBook.ratingsCount > 0" class="font-semibold text-zinc-900 dark:text-zinc-100">
                        {{ selectedBook.averageRating.toFixed(1) }}/5
                      </span>
                      <span>
                        {{
                          selectedBook.ratingsCount > 0
                            ? ` (${selectedBook.ratingsCount} rating${selectedBook.ratingsCount === 1 ? "" : "s"})`
                            : " No ratings yet"
                        }}
                      </span>
                    </p>
                  </div>
                  <p v-if="selectedBook.ratingsCount === 0" class="mt-1 text-xs text-zinc-500 dark:text-zinc-300">
                    Be the first to rate after marking this book completed.
                  </p>

                  <div v-if="selectedBook.isCompleted" class="mt-3 flex flex-wrap items-center gap-2">
                    <p class="text-sm text-zinc-700 dark:text-zinc-300">Your rating:</p>
                    <div class="flex items-center gap-1">
                      <button
                        v-for="star in 5"
                        :key="`rate-${selectedBook.id}-${star}`"
                        type="button"
                        class="rounded px-1 text-xl leading-none transition"
                        :class="
                          (selectedBook.userRating || 0) >= star
                            ? 'text-amber-500 hover:text-amber-400'
                            : 'text-zinc-400 hover:text-zinc-500 dark:text-zinc-300 dark:hover:text-zinc-300'
                        "
                        :disabled="ratingBookId === selectedBook.id"
                        @click="setBookRating(selectedBook.id, star)"
                      >
                        ★
                      </button>
                    </div>
                    <button
                      v-if="selectedBook.userRating"
                      type="button"
                      class="btn-secondary icon-btn px-2 py-1 text-xs"
                      :disabled="ratingBookId === selectedBook.id"
                      @click="clearBookRating(selectedBook.id)"
                    >
                      <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M18 6 6 18M6 6l12 12" />
                      </svg>
                      <span>{{ ratingBookId === selectedBook.id ? "Saving..." : "Clear Rating" }}</span>
                    </button>
                  </div>
                </div>
              </article>

              <article
                class="card space-y-3"
                :class="
                  isUpcomingMeeting(selectedBook.meetingStartsAt)
                    ? 'border-[#C8963E]/60 bg-[#FFF8E8] dark:border-[#C8963E]/60 dark:bg-[#2A2417]'
                    : ''
                "
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <svg
                      class="h-4 w-4 text-[#C8963E] dark:text-[#C8963E]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="4" width="18" height="18" rx="2"></rect>
                      <path d="M16 2v4"></path>
                      <path d="M8 2v4"></path>
                      <path d="M3 10h18"></path>
                    </svg>
                    <h3 class="text-xl font-semibold">Meeting</h3>
                  </div>
                  <span
                    v-if="isUpcomingMeeting(selectedBook.meetingStartsAt)"
                    class="rounded-full bg-[#C8963E] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#23260F]"
                  >
                    Upcoming
                  </span>
                </div>
                <div v-if="selectedBook.meetingStartsAt" class="space-y-2">
                  <p class="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    {{ formatEventDate(selectedBook.meetingStartsAt) }} at {{ formatEventTime(selectedBook.meetingStartsAt) }}
                  </p>
                  <p v-if="selectedBook.meetingLocation" class="text-sm text-zinc-700 dark:text-zinc-300">
                    {{ selectedBook.meetingLocation }}
                  </p>
                  <div class="flex flex-wrap items-center gap-2 pt-1">
                    <a
                      class="btn-secondary icon-btn px-3 py-1 text-xs"
                      :href="selectedBookMeetingActions.calendarUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="18" rx="2"></rect>
                        <path d="M16 2v4M8 2v4M3 10h18"></path>
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 13v5M9.5 15.5H14.5"></path>
                      </svg>
                      <span>Add to Calendar</span>
                    </a>
                    <a
                      v-if="selectedBookMeetingActions.mapUrl"
                      class="btn-secondary icon-btn px-3 py-1 text-xs"
                      :href="selectedBookMeetingActions.mapUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"></path>
                        <circle cx="12" cy="10" r="2.5"></circle>
                      </svg>
                      <span>Open Map</span>
                    </a>
                  </div>
                </div>
                <p v-else class="text-sm text-zinc-600 dark:text-zinc-300">
                  No meeting set for this book yet.
                </p>
              </article>
            </div>

            <Teleport to="body">
              <div v-if="isAdmin && adminDrawerOpen" class="fixed inset-0 z-50">
                <button
                  type="button"
                  class="absolute inset-0 bg-black/50"
                  aria-label="Close admin settings drawer"
                  @click="adminDrawerOpen = false"
                ></button>
                <aside
                  class="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l border-zinc-200 bg-[#F2EFDF] shadow-2xl dark:border-[#313947] dark:bg-[#0F1115]"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Book admin settings"
                >
                  <div class="sticky top-0 z-10 border-b border-zinc-200 bg-[#F2EFDF]/95 px-4 py-4 backdrop-blur dark:border-[#313947] dark:bg-[#0F1115]/95 sm:px-6">
                    <div class="flex items-start justify-between gap-4">
                      <div>
                        <h3 class="text-lg font-semibold">Admin Settings</h3>
                        <p class="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                          Changes here apply to this logical book across all member records for this volume.
                        </p>
                      </div>
                      <button type="button" class="btn-secondary icon-btn px-2 py-1 text-xs" @click="adminDrawerOpen = false">
                        <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M18 6 6 18M6 6l12 12" />
                        </svg>
                        <span>Close</span>
                      </button>
                    </div>
                  </div>

                  <div class="p-4 sm:p-6">
                    <div class="grid gap-3">
                      <form class="card space-y-2" @submit.prevent="saveBookIsbn">
                <p class="text-sm font-semibold">ISBN</p>
                <label class="field-label">
                  ISBN-10 or ISBN-13
                  <input
                    v-model="isbnForm.isbn"
                    class="input"
                    type="text"
                    maxlength="20"
                    inputmode="text"
                    placeholder="9780316499019"
                  />
                </label>
                <p
                  v-if="isbnMessage"
                  class="text-sm"
                  :class="
                    isbnMessageTone === 'error'
                      ? 'text-[#A62014] dark:text-[#A62014]'
                      : 'text-[#C8963E] dark:text-[#C8963E]'
                  "
                >
                  {{ isbnMessage }}
                </p>
                <div class="flex gap-2">
                  <button class="btn-primary" :disabled="savingBookIsbn">
                    {{ savingBookIsbn ? "Saving..." : "Save ISBN" }}
                  </button>
                  <button
                    type="button"
                    class="btn-secondary"
                    :disabled="savingBookIsbn"
                    @click="resetIsbnForm(selectedBook)"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    class="btn-danger"
                    :disabled="savingBookIsbn || (!selectedBook.isbn && !(isbnForm.isbn || '').trim())"
                    @click="clearBookIsbn"
                  >
                    {{ savingBookIsbn ? "Clearing..." : "Clear ISBN" }}
                  </button>
                </div>
                      </form>

                      <form class="card space-y-2" @submit.prevent="saveBookCover">
                <p class="text-sm font-semibold">Cover Image URL</p>
                <label class="field-label">
                  URL
                  <input
                    v-model="coverForm.thumbnailUrl"
                    class="input"
                    type="url"
                    maxlength="500"
                    placeholder="https://example.com/book-cover.jpg"
                  />
                </label>
                <p
                  v-if="coverMessage"
                  class="text-sm"
                  :class="
                    coverMessageTone === 'error'
                      ? 'text-[#A62014] dark:text-[#A62014]'
                      : 'text-[#C8963E] dark:text-[#C8963E]'
                  "
                >
                  {{ coverMessage }}
                </p>
                <div class="flex gap-2">
                  <button class="btn-primary" :disabled="savingBookCover">
                    {{ savingBookCover ? "Saving..." : "Save Cover" }}
                  </button>
                  <button
                    type="button"
                    class="btn-secondary"
                    :disabled="savingBookCover"
                    @click="resetCoverForm(selectedBook)"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    class="btn-danger"
                    :disabled="savingBookCover || (!selectedBook.thumbnailUrl && !(coverForm.thumbnailUrl || '').trim())"
                    @click="clearBookCover"
                  >
                    {{ savingBookCover ? "Clearing..." : "Clear Cover" }}
                  </button>
                </div>
                      </form>

                      <div class="card space-y-2">
                <p class="text-sm font-semibold">Featured Header Image</p>
                <p class="text-xs text-zinc-600 dark:text-zinc-300">
                  Use the upload icon in the top-right corner of the header image to replace it.
                </p>
                <button
                  type="button"
                  class="btn-danger w-fit"
                  :disabled="uploadingBookFeaturedImage || !selectedBook.featuredImageUrl"
                  @click="clearBookFeaturedImage"
                >
                  {{ uploadingBookFeaturedImage ? "Working..." : "Clear Featured Image" }}
                </button>
                      </div>

                      <form class="card space-y-2" @submit.prevent="saveBookMeeting">
                <p class="text-sm font-semibold">Meeting</p>
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
                      ? 'text-[#A62014] dark:text-[#A62014]'
                      : 'text-[#C8963E] dark:text-[#C8963E]'
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

                      <div class="card space-y-2">
                <p class="text-sm font-semibold">Delete Record</p>
                <p class="text-xs text-zinc-600 dark:text-zinc-300">
                  Permanently removes this book record for all members in this volume, including related comments, completion, and ratings.
                </p>
                <button
                  type="button"
                  class="btn-danger icon-btn w-fit"
                  :disabled="deletingBookRecord"
                  @click="deleteSelectedBookRecord"
                >
                  <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12"></path>
                  </svg>
                  <span>{{ deletingBookRecord ? "Deleting..." : "Delete Record" }}</span>
                </button>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </Teleport>

            <div class="space-y-2">
              <h3 class="text-lg font-semibold">Resources</h3>
              <p v-if="selectedBook.resources.length === 0" class="text-sm text-zinc-600 dark:text-zinc-300">
                No resource links yet.
              </p>
              <ul v-else class="space-y-2">
                <li v-for="resource in selectedBook.resources" :key="`${resource.label}-${resource.url}`" class="comment-row">
                  <span>{{ resource.label }}</span>
                  <a
                    class="text-sm font-medium text-[#C8963E] underline dark:text-[#C8963E]"
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
              <p v-if="selectedBookThreadedComments.length === 0" class="text-sm text-zinc-600 dark:text-zinc-300">
                No comments yet.
              </p>
              <BookCommentThread
                v-else
                :comments="selectedBookThreadedComments"
                :active-reply-comment-id="activeReplyCommentId"
                :reply-drafts="replyDrafts"
                :comment-action-id="commentActionId"
                :can-delete-comment="canDeleteComment"
                :format-date="formatDate"
                :format-comment-time="formatCommentTime"
                @toggle-reply="toggleReplyComposer"
                @set-reply-draft="setReplyDraft"
                @submit-reply="addComment(selectedBook.id, { parentCommentId: $event })"
                @toggle-like="toggleCommentLike(selectedBook.id, $event)"
                @delete-comment="deleteComment(selectedBook.id, $event)"
              />
              <div class="flex gap-2">
                <input
                  v-model="commentDrafts[selectedBook.id]"
                  class="input"
                  placeholder="Add comment..."
                  @keyup.enter="addComment(selectedBook.id)"
                />
                <button
                  class="btn-primary icon-btn"
                  :disabled="commentActionId === `comment:${selectedBook.id}`"
                  @click="addComment(selectedBook.id)"
                >
                  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" />
                  </svg>
                  <span>{{ commentActionId === `comment:${selectedBook.id}` ? "Adding..." : "Add" }}</span>
                </button>
              </div>
            </div>
          </section>

          <section v-else class="panel space-y-3">
            <h2 class="text-2xl font-semibold">Book not found</h2>
            <p class="text-sm text-zinc-600 dark:text-zinc-300">
              This book may have been removed or is not available in your current data.
            </p>
            <button class="btn-secondary icon-btn" @click="closeBookDetails">
              <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6" />
              </svg>
              <span>Back to Volume</span>
            </button>
          </section>
        </section>

        <section v-else-if="activeView === 'volume' && viewingMemberProfile" class="space-y-4">
          <section v-if="loadingMemberProfile" class="panel">
            <p>Loading profile...</p>
          </section>

          <section v-else-if="memberProfile" class="panel space-y-4">
            <div class="flex items-center justify-between gap-3">
              <button class="btn-secondary icon-btn" @click="closeMemberProfile">
                <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6" />
                </svg>
                <span>Back to Volume</span>
              </button>
              <p class="text-sm text-zinc-600 dark:text-zinc-300">{{ memberProfile.role }}</p>
            </div>

            <div class="flex flex-wrap items-center gap-4">
              <div class="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
                <img
                  v-if="memberProfile.profileImageUrl"
                  :src="resolveApiAssetUrl(memberProfile.profileImageUrl)"
                  :alt="`${memberProfile.name} profile image`"
                  class="h-full w-full object-cover"
                />
                <span v-else class="text-xl font-semibold text-zinc-600 dark:text-zinc-300">
                  {{ getInitials(memberProfile.name) }}
                </span>
              </div>
              <div>
                <h2 class="text-3xl font-semibold">{{ memberProfile.name }}</h2>
                <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                  Joined {{ formatDate(memberProfile.createdAt) }}
                </p>
              </div>
            </div>

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <article class="card">
                <p class="text-2xl font-semibold">{{ memberProfile.booksRead }}</p>
                <p class="text-sm text-zinc-600 dark:text-zinc-300">Books Completed</p>
              </article>
              <article class="card">
                <p class="text-2xl font-semibold">{{ memberProfile.commentsCount }}</p>
                <p class="text-sm text-zinc-600 dark:text-zinc-300">Comments Posted</p>
              </article>
              <article class="card">
                <p class="text-2xl font-semibold">{{ memberProfile.role }}</p>
                <p class="text-sm text-zinc-600 dark:text-zinc-300">Role</p>
              </article>
            </div>

            <form v-if="isOwnProfile" class="card space-y-2" @submit.prevent="saveProfile">
              <h3 class="text-lg font-semibold">Edit Profile</h3>
              <label class="field-label">
                Name
                <input v-model="profileForm.name" class="input" type="text" required maxlength="80" />
              </label>
              <div class="field-label space-y-2">
                <span>Profile Image</span>
                <label
                  class="input flex min-h-20 cursor-pointer items-center gap-2 text-zinc-600 hover:border-[#C8963E] hover:text-zinc-800 dark:text-zinc-300 dark:hover:border-[#C8963E] dark:hover:text-zinc-100"
                  :class="
                    profileImageDropActive
                      ? 'border-[#C8963E] bg-[#C8963E]/10 text-zinc-900 dark:bg-[#313947]/50 dark:text-zinc-100'
                      : ''
                  "
                  @dragenter.prevent="onProfileImageDragOver"
                  @dragover.prevent="onProfileImageDragOver"
                  @dragleave.prevent="onProfileImageDragLeave"
                  @drop.prevent="onProfileImageDrop"
                >
                  <input
                    class="sr-only"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    @change="setProfileImageFile"
                  />
                  <svg
                    class="h-4 w-4 shrink-0 text-[#C8963E] dark:text-[#C8963E]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 16V4"></path>
                    <path d="m7 9 5-5 5 5"></path>
                    <path d="M20 16.5v2A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-2"></path>
                  </svg>
                  <span class="truncate text-sm">
                    {{
                      profileImageFile
                        ? profileImageFile.name
                        : profileImageDropActive
                          ? "Drop image here"
                          : "Drop image here or click to browse"
                    }}
                  </span>
                </label>
              </div>
              <p class="text-xs text-zinc-500 dark:text-zinc-300">
                Upload JPG, PNG, WEBP, or GIF up to 2MB.
              </p>
              <p
                v-if="profileMessage"
                class="text-sm"
                :class="
                  profileMessageTone === 'error'
                    ? 'text-[#A62014] dark:text-[#A62014]'
                    : 'text-[#C8963E] dark:text-[#C8963E]'
                "
              >
                {{ profileMessage }}
              </p>
              <div class="flex flex-wrap gap-2">
                <button class="btn-primary icon-btn" :disabled="savingProfile || uploadingProfileImage">
                  <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m20 6-11 11-5-5" />
                  </svg>
                  <span>{{ savingProfile ? "Saving..." : "Save Profile" }}</span>
                </button>
                <button
                  type="button"
                  class="btn-secondary icon-btn"
                  :disabled="uploadingProfileImage || !profileImageFile"
                  @click="uploadProfileImage"
                >
                  <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 16V4"></path>
                    <path stroke-linecap="round" stroke-linejoin="round" d="m7 9 5-5 5 5"></path>
                    <path stroke-linecap="round" stroke-linejoin="round" d="M20 16.5v2A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-2"></path>
                  </svg>
                  <span>{{ uploadingProfileImage ? "Uploading..." : "Upload Image" }}</span>
                </button>
                <button
                  type="button"
                  class="btn-danger icon-btn"
                  :disabled="uploadingProfileImage || !memberProfile.profileImageUrl"
                  @click="clearProfileImage"
                >
                  <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M18 6 6 18M6 6l12 12" />
                  </svg>
                  <span>{{ uploadingProfileImage ? "Working..." : "Remove Image" }}</span>
                </button>
              </div>
            </form>

            <section v-else class="card">
              <p class="text-sm text-zinc-600 dark:text-zinc-300">
                Only this member can edit their profile image.
              </p>
            </section>

            <section class="space-y-2">
              <h3 class="text-lg font-semibold">Recent Comments</h3>
              <p
                v-if="memberRecentComments.length === 0"
                class="text-sm text-zinc-600 dark:text-zinc-300"
              >
                No comments yet.
              </p>
              <ul v-else class="space-y-2">
                <li
                  v-for="comment in memberRecentComments"
                  :key="comment.id"
                  class="comment-row"
                >
                  <div class="min-w-0">
                    <p>{{ comment.text }}</p>
                    <p class="text-xs text-zinc-500 dark:text-zinc-300">
                      {{ formatDate(comment.createdAt) }} at {{ formatCommentTime(comment.createdAt) }}
                    </p>
                  </div>
                  <button
                    class="btn-secondary icon-btn shrink-0 px-2 py-1 text-xs"
                    :disabled="!comment.viewerBookId"
                    @click="openBookDetails(comment.viewerBookId)"
                  >
                    <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 18l6-6-6-6" />
                    </svg>
                    <span>{{ comment.viewerBookId ? comment.bookTitle : "Book unavailable" }}</span>
                  </button>
                </li>
              </ul>
            </section>
          </section>

          <section v-else class="panel space-y-3">
            <h2 class="text-2xl font-semibold">Member not found</h2>
            <p class="text-sm text-zinc-600 dark:text-zinc-300">
              This profile may not exist or may be unavailable.
            </p>
            <button class="btn-secondary icon-btn" @click="closeMemberProfile">
              <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6" />
              </svg>
              <span>Back to Volume</span>
            </button>
          </section>
        </section>

        <section v-else-if="activeView === 'volume'" class="space-y-4">
          <section class="panel">
            <h2 class="text-3xl font-semibold tracking-tight">{{ greetingMessage }}, {{ firstName }}</h2>
            <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Volume {{ selectedVolumeLabel ?? currentVolume }} dashboard at a glance.
            </p>
          </section>

          <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <article class="card">
              <p class="text-2xl font-semibold">{{ dashboardStats.booksRead }}</p>
              <p class="text-sm text-zinc-600 dark:text-zinc-300">Books in Library</p>
            </article>
            <article class="card">
              <p class="text-2xl font-semibold">{{ dashboardStats.activeMembers }}</p>
              <p class="text-sm text-zinc-600 dark:text-zinc-300">Active Members</p>
            </article>
            <article class="card">
              <p class="text-2xl font-semibold">{{ dashboardStats.discussions }}</p>
              <p class="text-sm text-zinc-600 dark:text-zinc-300">Discussions</p>
            </article>
            <article class="card">
              <p class="text-2xl font-semibold">{{ dashboardStats.upcomingEvents }}</p>
              <p class="text-sm text-zinc-600 dark:text-zinc-300">Upcoming Events</p>
            </article>
            <article class="card">
              <p class="text-2xl font-semibold">{{ selectedVolumeBooks.length }}</p>
              <p class="text-sm text-zinc-600 dark:text-zinc-300">
                Books in Volume {{ selectedVolumeLabel ?? currentVolume }}
              </p>
            </article>
          </section>

          <section class="grid gap-4 xl:grid-cols-[1.5fr,1fr]">
            <button
              v-if="featuredBook"
              type="button"
              class="panel w-full overflow-hidden p-0 text-left transition hover:-translate-y-0.5 hover:border-[#C8963E] dark:hover:border-[#C8963E]"
              @click="openBookDetails(featuredBook.id)"
            >
              <div class="relative h-[30rem]">
                <div class="h-2/3 overflow-hidden border-b border-zinc-200 dark:border-zinc-700">
                  <img
                    v-if="featuredBookDisplayImageUrl"
                    :src="featuredBookDisplayImageUrl"
                    :alt="`Featured image for ${featuredBook.title}`"
                    class="h-full w-full object-cover"
                  />
                  <div
                    v-else
                    class="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#F2EFDF] to-zinc-200 text-center text-sm font-medium text-zinc-600 dark:from-[#12161D] dark:to-[#0B0E13] dark:text-zinc-300"
                  >
                    Add a featured image or configure admin fallback images
                  </div>
                </div>
                <div class="h-1/3 p-4 sm:p-5">
                  <p class="text-xs font-semibold uppercase tracking-wide text-[#C8963E] dark:text-[#C8963E]">
                    Featured Book
                  </p>
                  <h3 class="mt-1 text-2xl font-semibold leading-tight">{{ featuredBook.title }}</h3>
                  <p class="text-zinc-700 dark:text-zinc-300">by {{ featuredBook.author }}</p>
                  <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <p
                      v-if="featuredBook.isCompleted"
                      class="font-semibold uppercase tracking-wide text-[#C8963E] dark:text-[#C8963E]"
                    >
                      Completed
                    </p>
                    <p v-if="featuredBook.ratingsCount > 0" class="text-amber-700 dark:text-amber-300">
                      ★ {{ featuredBook.averageRating.toFixed(1) }} ({{ featuredBook.ratingsCount }})
                    </p>
                  </div>
                  <div class="mt-2 flex items-center justify-between gap-3">
                    <p class="min-w-0 text-sm text-zinc-600 dark:text-zinc-300">
                      {{ featuredBook.month }} {{ featuredBook.year }} in Volume {{ selectedVolumeLabel ?? currentVolume }}
                    </p>
                  </div>
                </div>
              </div>
            </button>
            <section v-else class="panel">
              <h3 class="text-xl font-semibold">Featured Book</h3>
              <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-300">No featured book set for this volume yet.</p>
            </section>

            <section class="panel space-y-3">
              <h3 class="text-xl font-semibold">
                Schedule for Volume {{ selectedVolumeLabel ?? currentVolume }}
              </h3>
              <p class="text-sm text-zinc-600 dark:text-zinc-300">
                One meeting per book. Admins set each meeting from the book details page.
              </p>
              <p
                v-if="scheduledBooksForVolume.length === 0"
                class="text-sm text-zinc-600 dark:text-zinc-300"
              >
                No meetings assigned for this volume yet.
              </p>
              <ul v-else class="space-y-2">
                <li v-for="book in scheduledBooksForVolume" :key="`meeting-${book.id}`">
                  <button
                    type="button"
                    class="card w-full text-left transition hover:-translate-y-0.5 hover:border-[#C8963E] dark:hover:border-[#C8963E]"
                    :class="
                      isUpcomingMeeting(book.meetingStartsAt)
                        ? 'border-[#C8963E]/60 bg-[#FFF8E8] dark:border-[#C8963E]/60 dark:bg-[#2A2417]'
                        : ''
                    "
                    @click="openBookDetails(book.id)"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <p class="font-semibold">{{ book.title }}</p>
                      <span
                        v-if="isUpcomingMeeting(book.meetingStartsAt)"
                        class="rounded-full bg-[#C8963E] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#23260F]"
                      >
                        Upcoming
                      </span>
                    </div>
                    <p class="text-sm text-zinc-600 dark:text-zinc-300">{{ book.author }}</p>
                    <p class="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                      {{ formatEventDate(book.meetingStartsAt) }} at {{ formatEventTime(book.meetingStartsAt) }}
                    </p>
                    <p v-if="book.meetingLocation" class="text-xs text-zinc-500 dark:text-zinc-300">
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
              <p v-if="selectedVolumeBooks.length === 0" class="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
                No books in this volume yet.
              </p>
              <div class="mt-3 grid gap-3 lg:grid-cols-2">
                <button
                  v-for="book in selectedVolumeBooks"
                  :key="book.id"
                  class="card text-left transition hover:-translate-y-0.5 hover:border-[#C8963E] dark:hover:border-[#C8963E]"
                  @click="openBookDetails(book.id)"
                >
                  <div class="flex gap-3">
                    <div class="h-28 w-20 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
                      <img
                        v-if="book.thumbnailUrl"
                        :src="resolveApiAssetUrl(book.thumbnailUrl)"
                        :alt="`Cover of ${book.title}`"
                        class="h-full w-full object-cover"
                      />
                      <div v-else class="flex h-full w-full items-center justify-center text-center text-[10px] text-zinc-500 dark:text-zinc-300">
                        No cover
                      </div>
                    </div>
                    <div class="min-w-0">
                      <h4 class="text-lg font-semibold">{{ book.title }}</h4>
                      <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                        {{ book.author }} | {{ book.month }} {{ book.year }}
                      </p>
                      <p
                        v-if="book.isCompleted"
                        class="mt-1 text-xs font-semibold uppercase tracking-wide text-[#C8963E] dark:text-[#C8963E]"
                      >
                        Completed
                      </p>
                      <p v-if="book.ratingsCount > 0" class="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        ★ {{ book.averageRating.toFixed(1) }} ({{ book.ratingsCount }})
                      </p>
                      <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-300">
                        {{ book.comments.length }} comment{{ book.comments.length === 1 ? "" : "s" }}
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            </section>

            <section class="panel">
              <h3 class="text-xl font-semibold">Club Members</h3>
              <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Visible to everyone.
              </p>
              <p v-if="members.length === 0" class="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
                No active members yet.
              </p>
              <ul v-else class="mt-3 space-y-2">
                <li v-for="member in members" :key="member.id">
                  <button
                    class="comment-row w-full text-left transition hover:-translate-y-0.5 hover:border-[#C8963E] dark:hover:border-[#C8963E]"
                    @click="openMemberProfile(member.id)"
                  >
                    <div class="flex min-w-0 items-center gap-3">
                      <div class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
                        <img
                          v-if="member.profileImageUrl"
                          :src="resolveApiAssetUrl(member.profileImageUrl)"
                          :alt="`${member.name} profile image`"
                          class="h-full w-full object-cover"
                        />
                        <span v-else class="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                          {{ getInitials(member.name) }}
                        </span>
                      </div>
                      <div class="min-w-0">
                        <p class="font-medium text-zinc-900 dark:text-zinc-100">{{ member.name }}</p>
                        <p class="text-xs text-zinc-500 dark:text-zinc-300">
                          Joined {{ formatDate(member.createdAt) }}
                        </p>
                      </div>
                    </div>
                    <div class="shrink-0 text-right">
                      <p
                        class="text-xs font-semibold uppercase tracking-wide"
                        :class="member.role === 'admin' ? 'text-amber-700 dark:text-amber-300' : 'text-zinc-500 dark:text-zinc-300'"
                      >
                        {{ member.role }}
                      </p>
                      <p class="text-xs text-zinc-500 dark:text-zinc-300">
                        {{ member.commentsCount }} comment{{ member.commentsCount === 1 ? "" : "s" }}
                      </p>
                    </div>
                  </button>
                </li>
              </ul>
            </section>
          </section>
        </section>

        <section v-else-if="activeView === 'admin' && isAdmin" class="space-y-5">
          <section class="panel space-y-4">
            <div class="flex flex-wrap items-center gap-3">
              <h3 class="text-2xl font-semibold">Admin Console</h3>
              <span
                class="rounded border border-[#C8963E]/60 bg-[#C8963E]/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-[#C8963E] dark:text-[#C8963E]"
              >
                Admin
              </span>
            </div>
            <div class="h-px bg-zinc-200 dark:bg-zinc-800"></div>
            <div class="inline-flex rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-[#313947] dark:bg-[#151A22]/85">
              <button
                type="button"
                class="icon-btn rounded-lg px-4 py-2 text-sm font-semibold transition"
                :class="
                  adminTab === 'single'
                    ? 'bg-[#C8963E] text-[#23260F] dark:bg-[#C8963E] dark:text-[#23260F]'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                "
                @click="adminTab = 'single'"
              >
                <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M7 4h10l3 3v13H4V4h3z"></path>
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h8M8 16h5"></path>
                </svg>
                <span>Single Record</span>
              </button>
              <button
                type="button"
                class="icon-btn rounded-lg px-4 py-2 text-sm font-semibold transition"
                :class="
                  adminTab === 'bulk'
                    ? 'bg-[#C8963E] text-[#23260F] dark:bg-[#C8963E] dark:text-[#23260F]'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                "
                @click="adminTab = 'bulk'"
              >
                <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 16V4"></path>
                  <path stroke-linecap="round" stroke-linejoin="round" d="m7 9 5-5 5 5"></path>
                  <path stroke-linecap="round" stroke-linejoin="round" d="M20 16.5v2A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-2"></path>
                </svg>
                <span>Bulk Import</span>
              </button>
              <button
                type="button"
                class="icon-btn rounded-lg px-4 py-2 text-sm font-semibold transition"
                :class="
                  adminTab === 'members'
                    ? 'bg-[#C8963E] text-[#23260F] dark:bg-[#C8963E] dark:text-[#23260F]'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                "
                @click="adminTab = 'members'"
              >
                <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"></path>
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 20a8 8 0 0 1 16 0"></path>
                </svg>
                <span>Members</span>
              </button>
              <button
                type="button"
                class="icon-btn rounded-lg px-4 py-2 text-sm font-semibold transition"
                :class="
                  adminTab === 'approvals'
                    ? 'bg-[#C8963E] text-[#23260F] dark:bg-[#C8963E] dark:text-[#23260F]'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                "
                @click="adminTab = 'approvals'"
              >
                <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"></path>
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 20a8 8 0 0 1 16 0"></path>
                </svg>
                <span>Approvals <span class="text-amber-500">• {{ pendingUsers.length }}</span></span>
              </button>
            </div>
          </section>

          <section v-if="adminTab === 'single'" class="panel space-y-5">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
              <p class="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600 dark:text-zinc-300">New Record</p>
              <label class="field-label max-w-[220px]">
                Mode
                <select v-model="uploadMode" class="input">
                  <option value="append">Append</option>
                  <option value="replace">Replace</option>
                </select>
              </label>
            </div>

            <form class="space-y-5" @submit.prevent="submitSingleRecord">
              <div class="grid gap-4 md:grid-cols-[minmax(0,1fr),auto] md:items-end">
                <label class="field-label">
                  ISBN *
                  <input
                    v-model="singleRecordForm.isbn"
                    class="input"
                    type="text"
                    maxlength="20"
                    placeholder="ISBN-10 or ISBN-13"
                    required
                    autofocus
                    @blur="autofillSingleRecordFromIsbn()"
                  />
                </label>
                <button
                  type="button"
                  class="btn-secondary icon-btn"
                  :disabled="singleRecordIsbnLookupLoading"
                  @click="autofillSingleRecordFromIsbn(true)"
                >
                  <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <circle cx="11" cy="11" r="7"></circle>
                    <path stroke-linecap="round" stroke-linejoin="round" d="m20 20-3.2-3.2"></path>
                  </svg>
                  <span>{{ singleRecordIsbnLookupLoading ? "Looking up..." : "Autofill from ISBN" }}</span>
                </button>
              </div>

              <p
                v-if="singleRecordLookupMessage"
                class="text-sm"
                :class="
                  singleRecordLookupMessageTone === 'error'
                    ? 'text-[#A62014] dark:text-[#A62014]'
                    : 'text-[#C8963E] dark:text-[#C8963E]'
                "
              >
                {{ singleRecordLookupMessage }}
              </p>

              <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <label class="field-label">
                  Volume *
                  <input
                    v-model.number="singleRecordForm.volume"
                    class="input"
                    type="number"
                    min="1"
                    max="99"
                    step="1"
                    required
                  />
                </label>
                <label class="field-label">
                  Month *
                  <select v-model="singleRecordForm.month" class="input" required>
                    <option disabled value="">-- select --</option>
                    <option v-for="month in MONTH_OPTIONS" :key="month" :value="month">{{ month }}</option>
                  </select>
                </label>
                <label class="field-label">
                  Scheduled Year *
                  <input
                    v-model="singleRecordForm.year"
                    class="input"
                    type="number"
                    min="2025"
                    max="2100"
                    step="1"
                    required
                  />
                </label>
                <label class="field-label md:col-span-2">
                  Title *
                  <input v-model="singleRecordForm.title" class="input" type="text" maxlength="200" required />
                </label>
                <label class="field-label md:col-span-2">
                  Author *
                  <input v-model="singleRecordForm.author" class="input" type="text" maxlength="160" required />
                </label>
                <label class="field-label md:col-span-2 xl:col-span-3">
                  Thumbnail URL *
                  <input
                    v-model="singleRecordForm.thumbnailUrl"
                    class="input"
                    type="url"
                    maxlength="500"
                    placeholder="https://..."
                    required
                  />
                </label>
                <label class="field-label md:col-span-2 xl:col-span-3">
                  Featured Image URL (optional)
                  <input
                    v-model="singleRecordForm.featuredImageUrl"
                    class="input"
                    type="url"
                    maxlength="500"
                    placeholder="https://..."
                  />
                </label>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <button type="button" class="btn-secondary icon-btn" :disabled="singleRecordSubmitting" @click="resetSingleRecordForm">
                  <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 1 0 3-6.7"></path>
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 4v5h5"></path>
                  </svg>
                  <span>Reset</span>
                </button>
                <button class="btn-primary icon-btn" :disabled="singleRecordSubmitting">
                  <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14"></path>
                  </svg>
                  <span>{{ singleRecordSubmitting ? "Adding..." : "Add Record" }}</span>
                </button>
              </div>
            </form>

            <section class="card space-y-3">
              <div class="flex items-center justify-between gap-2">
                <h4 class="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                  Session Records
                </h4>
                <button
                  class="btn-secondary icon-btn px-2 py-1 text-xs"
                  :disabled="singleRecordSession.length === 0"
                  @click="clearSingleRecordSession"
                >
                  <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M18 6 6 18M6 6l12 12"></path>
                  </svg>
                  <span>Clear</span>
                </button>
              </div>
              <p v-if="singleRecordSession.length === 0" class="text-sm text-zinc-600 dark:text-zinc-300">
                No records added this session.
              </p>
              <ul v-else class="space-y-2">
                <li v-for="record in singleRecordSession" :key="record.id" class="comment-row">
                  <div class="min-w-0">
                    <p class="font-medium text-zinc-900 dark:text-zinc-100">{{ record.title }}</p>
                    <p class="text-xs text-zinc-600 dark:text-zinc-300">
                      Volume {{ record.volume }} • {{ record.month }} {{ record.year }} • {{ record.author }}
                    </p>
                  </div>
                  <span class="text-xs text-zinc-500 dark:text-zinc-300">{{ record.isbn }}</span>
                </li>
              </ul>
            </section>
          </section>

          <section v-else-if="adminTab === 'bulk'" class="space-y-5">
            <section class="panel space-y-5">
              <div class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600 dark:text-zinc-300">Bulk Import</p>
                <label class="field-label max-w-[220px]">
                  Mode
                  <select v-model="uploadMode" class="input">
                    <option value="append">Append</option>
                    <option value="replace">Replace</option>
                  </select>
                </label>
              </div>

              <div class="field-label">
                File (.csv or .json)
                <label
                  class="input flex min-h-20 cursor-pointer items-center gap-2 text-zinc-600 hover:border-[#C8963E] hover:text-zinc-800 dark:text-zinc-300 dark:hover:border-[#C8963E] dark:hover:text-zinc-100"
                  :class="
                    readingListDropActive
                      ? 'border-[#C8963E] bg-[#C8963E]/10 text-zinc-900 dark:bg-[#313947]/50 dark:text-zinc-100'
                      : ''
                  "
                  @dragenter.prevent="onReadingListDragOver"
                  @dragover.prevent="onReadingListDragOver"
                  @dragleave.prevent="onReadingListDragLeave"
                  @drop.prevent="onReadingListDrop"
                >
                  <input
                    class="sr-only"
                    type="file"
                    accept=".csv,.json"
                    @change="setReadingListFile"
                  />
                  <svg
                    class="h-4 w-4 shrink-0 text-[#C8963E] dark:text-[#C8963E]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 16V4"></path>
                    <path d="m7 9 5-5 5 5"></path>
                    <path d="M20 16.5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-2"></path>
                  </svg>
                  <span class="truncate text-sm">
                    {{
                      readingListFile
                        ? readingListFile.name
                        : readingListDropActive
                          ? "Drop CSV or JSON file to import"
                          : "Drop CSV or JSON here, or click to browse"
                    }}
                  </span>
                </label>
              </div>

              <div class="card space-y-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                <p class="text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">Column Reference</p>
                <p>Required: `volume`, `title`, `author`, `month`.</p>
                <p>Optional: `year` (scheduled read year), `isbn`, `meetingStartsAt`, `meetingLocation`, `thumbnailUrl`, `isFeatured`, `resources`.</p>
                <p>Rules: `volume` integer 1-99, `year` 2025-2100, valid ISBN-10/13, valid URLs, valid meeting date/time.</p>
              </div>

              <div class="card space-y-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <p class="text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                    Featured Image Fallbacks
                  </p>
                  <p class="text-xs text-zinc-500 dark:text-zinc-300">
                    {{ featuredImageFallbackUrls.length }} saved
                  </p>
                </div>
                <p class="text-sm text-zinc-600 dark:text-zinc-300">
                  Upload image files to use when a book has no featured header image.
                </p>
                <div class="field-label">
                  Upload Fallback Images
                  <label
                    class="input flex min-h-20 cursor-pointer items-center gap-2 text-zinc-600 hover:border-[#C8963E] hover:text-zinc-800 dark:text-zinc-300 dark:hover:border-[#C8963E] dark:hover:text-zinc-100"
                    :class="
                      featuredFallbackDropActive
                        ? 'border-[#C8963E] bg-[#C8963E]/10 text-zinc-900 dark:bg-[#313947]/50 dark:text-zinc-100'
                        : ''
                    "
                    @dragenter.prevent="onFeaturedFallbackDragOver"
                    @dragover.prevent="onFeaturedFallbackDragOver"
                    @dragleave.prevent="onFeaturedFallbackDragLeave"
                    @drop.prevent="onFeaturedFallbackDrop"
                  >
                    <input
                      class="sr-only"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      multiple
                      :disabled="uploadingFeaturedFallbacks"
                      @change="onFeaturedFallbackSelected"
                    />
                    <svg
                      class="h-4 w-4 shrink-0 text-[#C8963E] dark:text-[#C8963E]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 16V4"></path>
                      <path d="m7 9 5-5 5 5"></path>
                      <path d="M20 16.5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-2"></path>
                    </svg>
                    <span class="text-sm">
                      {{
                        uploadingFeaturedFallbacks
                          ? "Uploading fallback image(s)..."
                          : featuredFallbackDropActive
                            ? "Drop fallback image files to upload"
                            : "Drop fallback image files here, or click to browse"
                      }}
                    </span>
                  </label>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn-danger icon-btn"
                    :disabled="uploadingFeaturedFallbacks || featuredImageFallbackUrls.length === 0"
                    @click="clearFeaturedImageFallbacks"
                  >
                    <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M18 6 6 18M6 6l12 12"></path>
                    </svg>
                    <span>{{ uploadingFeaturedFallbacks ? "Working..." : "Clear All" }}</span>
                  </button>
                </div>
                <p v-if="featuredImageFallbackUrls.length === 0" class="text-sm text-zinc-600 dark:text-zinc-300">
                  No fallback images uploaded yet.
                </p>
                <ul v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <li
                    v-for="url in featuredImageFallbackUrls"
                    :key="`fallback-image-${url}`"
                    class="comment-row flex-col items-stretch gap-2"
                  >
                    <div class="aspect-[16/9] overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-[#151A22]">
                      <img :src="resolveApiAssetUrl(url)" alt="Fallback image preview" class="h-full w-full object-cover" />
                    </div>
                    <div class="flex items-center justify-end">
                      <button
                        type="button"
                        class="btn-danger icon-btn px-2 py-1 text-xs"
                        :disabled="removingFeaturedFallbackUrl === url || uploadingFeaturedFallbacks"
                        @click="removeFeaturedFallbackImage(url)"
                      >
                        <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M18 6 6 18M6 6l12 12"></path>
                        </svg>
                        <span>{{ removingFeaturedFallbackUrl === url ? "Removing..." : "Remove" }}</span>
                      </button>
                    </div>
                  </li>
                </ul>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <div class="flex flex-wrap gap-3">
                  <button
                    class="btn-danger icon-btn"
                    :disabled="uploadingReadingList || clearingVolume || clearingUploadHistory || backfillingCovers || backfillingThriftBooks"
                    @click="clearVolumeBooks"
                  >
                    <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M18 6 6 18M6 6l12 12"></path>
                    </svg>
                    <span>{{ clearingVolume ? "Clearing..." : "Clear Volume" }}</span>
                  </button>
                  <button
                    class="btn-secondary icon-btn"
                    :disabled="uploadingReadingList || clearingVolume || clearingUploadHistory || backfillingCovers || backfillingThriftBooks"
                    @click="backfillCoverImages"
                  >
                    <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 1 0 3-6.7"></path>
                      <path stroke-linecap="round" stroke-linejoin="round" d="M3 4v5h5"></path>
                    </svg>
                    <span>{{ backfillingCovers ? "Backfilling..." : "Backfill Covers" }}</span>
                  </button>
                  <button
                    class="btn-secondary icon-btn"
                    :disabled="uploadingReadingList || clearingVolume || clearingUploadHistory || backfillingCovers || backfillingThriftBooks"
                    @click="backfillThriftBooksResources"
                  >
                    <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16v12H4z"></path>
                      <path stroke-linecap="round" stroke-linejoin="round" d="M8 10h8M8 14h6"></path>
                    </svg>
                    <span>{{ backfillingThriftBooks ? "Backfilling..." : "Backfill ThriftBooks" }}</span>
                  </button>
                </div>
                <button
                  class="btn-primary icon-btn"
                  :disabled="uploadingReadingList || clearingVolume || clearingUploadHistory || backfillingCovers || backfillingThriftBooks"
                  @click="uploadReadingList"
                >
                  <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 16V4"></path>
                    <path stroke-linecap="round" stroke-linejoin="round" d="m7 9 5-5 5 5"></path>
                    <path stroke-linecap="round" stroke-linejoin="round" d="M20 16.5v2A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-2"></path>
                  </svg>
                  <span>{{ uploadingReadingList ? "Uploading..." : "Import" }}</span>
                </button>
              </div>
            </section>

            <section class="panel space-y-4">
              <div class="flex items-center justify-between gap-2">
                <h4 class="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                  Recent Uploads
                </h4>
                <button
                  class="btn-secondary icon-btn px-2 py-1 text-xs"
                  :disabled="clearingUploadHistory || uploadHistory.length === 0"
                  @click="clearUploadHistory"
                >
                  <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M18 6 6 18M6 6l12 12"></path>
                  </svg>
                  <span>{{ clearingUploadHistory ? "Clearing..." : "Clear History" }}</span>
                </button>
              </div>
              <p v-if="uploadHistory.length === 0" class="text-sm text-zinc-600 dark:text-zinc-300">
                No uploads yet.
              </p>
              <ul v-else class="space-y-3">
                <li v-for="upload in uploadHistory" :key="upload.id" class="comment-row py-3">
                  <span>{{ upload.filename }} ({{ formatUploadMode(upload.mode) }}, {{ upload.rowsImported }} {{ upload.mode === "clear" ? "deleted" : upload.mode === "backfill" || upload.mode === "backfill-thriftbooks" ? "updated" : "rows" }})</span>
                  <small class="text-xs text-zinc-500 dark:text-zinc-300">
                    {{ formatDate(upload.createdAt) }}
                  </small>
                </li>
              </ul>
            </section>
          </section>

          <section v-else-if="adminTab === 'members'" class="panel space-y-4">
            <h4 class="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
              Member Roles
            </h4>
            <p class="text-sm text-zinc-600 dark:text-zinc-300">
              Promote approved members to admin from here.
            </p>
            <p v-if="members.length === 0" class="text-sm text-zinc-600 dark:text-zinc-300">
              No active members yet.
            </p>
            <ul v-else class="space-y-3">
              <li v-for="member in members" :key="`admin-member-${member.id}`" class="comment-row py-3">
                <div class="min-w-0">
                  <p class="font-medium text-zinc-900 dark:text-zinc-100">{{ member.name }}</p>
                  <p class="text-xs text-zinc-600 dark:text-zinc-300">
                    {{ member.role }} • {{ member.commentsCount }} comment{{ member.commentsCount === 1 ? "" : "s" }}
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    class="btn-secondary icon-btn px-2 py-1 text-xs"
                    @click="openMemberProfile(member.id)"
                  >
                    <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 18l6-6-6-6" />
                    </svg>
                    <span>View</span>
                  </button>
                  <button
                    v-if="member.role !== 'admin'"
                    type="button"
                    class="btn-primary icon-btn px-2 py-1 text-xs"
                    :disabled="promotingMemberId === String(member.id)"
                    @click="promoteMember(member)"
                  >
                    <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16M4 12h16" />
                    </svg>
                    <span>{{ promotingMemberId === String(member.id) ? "Granting..." : "Make Admin" }}</span>
                  </button>
                </div>
              </li>
            </ul>
          </section>

          <section v-else class="panel space-y-4">
            <h4 class="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
              Pending Approvals
            </h4>
            <p v-if="pendingUsers.length === 0" class="text-sm text-zinc-600 dark:text-zinc-300">
              No pending users.
            </p>
            <ul v-else class="space-y-3">
              <li v-for="pendingUser in pendingUsers" :key="pendingUser.id" class="comment-row py-3">
                <div class="min-w-0">
                  <p class="font-medium text-zinc-900 dark:text-zinc-100">{{ pendingUser.name }}</p>
                  <p class="truncate text-xs text-zinc-600 dark:text-zinc-300">
                    {{ pendingUser.email }}
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <button
                    class="btn-danger icon-btn"
                    :disabled="approvingUserId === String(pendingUser.id) || denyingUserId === String(pendingUser.id)"
                    @click="denyPendingUser(pendingUser)"
                  >
                    <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M18 6 6 18M6 6l12 12"></path>
                    </svg>
                    <span>{{ denyingUserId === String(pendingUser.id) ? "Denying..." : "Deny" }}</span>
                  </button>
                  <button
                    class="btn-primary icon-btn"
                    :disabled="approvingUserId === String(pendingUser.id) || denyingUserId === String(pendingUser.id)"
                    @click="approvePendingUser(pendingUser)"
                  >
                    <svg class="ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="m20 6-11 11-5-5"></path>
                    </svg>
                    <span>{{ approvingUserId === String(pendingUser.id) ? "Approving..." : "Approve" }}</span>
                  </button>
                </div>
              </li>
            </ul>
          </section>

          <p
            v-if="adminMessage"
            class="text-sm"
            :class="
              adminMessageTone === 'error'
                ? 'text-[#A62014] dark:text-[#A62014]'
                : 'text-[#C8963E] dark:text-[#C8963E]'
            "
          >
            {{ adminMessage }}
          </p>
        </section>
      </section>
    </div>
  </main>
</template>
