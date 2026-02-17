<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from "vue";
import FlatPickr from "vue-flatpickr-component";
import "flatpickr/dist/flatpickr.min.css";
import { useRoute, useRouter } from "vue-router";

const THEME_KEY = "bookclub.theme.v1";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
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
const headerOffset = ref(0);

const loading = ref(true);
const submittingAuth = ref(false);
const busyBookId = ref("");
const completingBookId = ref("");
const ratingBookId = ref("");
const featuringBookId = ref("");
const savingBookIsbn = ref(false);
const savingBookCover = ref(false);
const uploadingBookFeaturedImage = ref(false);
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
const adminSettingsExpanded = ref(false);
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
const uploadHistory = ref([]);
const pendingUsers = ref([]);
const approvingUserId = ref("");
const uploadMode = ref("append");
const readingListFile = ref(null);
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
    resetIsbnForm(value);
    isbnMessage.value = "";
    resetCoverForm(value);
    coverMessage.value = "";
    featuredImageMessage.value = "";
    resetMeetingForm(value);
    meetingMessage.value = "";
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
  window.removeEventListener("resize", updateHeaderOffset);
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

async function onHeaderFeaturedImageSelected(event) {
  const input = event.target;
  const file = input.files?.[0] || null;
  input.value = "";
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
  profileImageFile.value = event.target.files?.[0] || null;
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
    resetSingleRecordForm();
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
  <main class="min-h-screen bg-[#F2EFDF] text-[#23260F] dark:bg-[#23260F] dark:text-[#F2EFDF]">
    <header
      ref="headerRef"
      class="fixed inset-x-0 top-0 z-40 border-b border-[#9BA7BF]/50 bg-[#F2EFDF]/95 backdrop-blur dark:border-[#3B4013] dark:bg-[#23260F]/95"
    >
      <div class="mx-auto flex w-full max-w-screen-2xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <div class="flex min-w-0 flex-wrap items-center gap-3 sm:gap-6">
            <button
              type="button"
              class="text-left transition hover:opacity-90"
              @click="goHome"
            >
              <h1 class="text-4xl font-bold tracking-tight">Stout Hearts</h1>
              <p class="mt-1 text-zinc-600 dark:text-zinc-400">Book club tracker</p>
            </button>
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
            <button
              v-if="user"
              class="btn-secondary inline-flex items-center gap-2 px-2 py-1.5"
              @click="openMemberProfile(user.id)"
            >
              <span class="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 text-xs font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                <img
                  v-if="user.profileImageUrl"
                  :src="user.profileImageUrl"
                  :alt="`${user.name} profile image`"
                  class="h-full w-full object-cover"
                />
                <span v-else>{{ getInitials(user.name) }}</span>
              </span>
              <span class="text-sm text-zinc-600 dark:text-zinc-400">
                {{ user.name }} ({{ user.role }})
              </span>
            </button>
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

    <div class="mx-auto max-w-6xl px-4 pb-8 sm:px-6 lg:px-8" :style="{ paddingTop: `${headerOffset + 24}px` }">

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

          <section
            v-if="DEMO_ACCOUNTS.length > 0"
            class="mt-5 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/40"
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
              <button class="btn-secondary" type="button" @click="fillDemoCredentials">
                Fill
              </button>
              <button class="btn-primary" type="button" :disabled="submittingAuth" @click="signInDemoAccount">
                {{ submittingAuth ? "Signing in..." : "Sign in demo" }}
              </button>
            </div>
            <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Development only.
            </p>
          </section>
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
              <div class="flex items-center gap-3">
                <p class="text-sm text-zinc-600 dark:text-zinc-400">Volume {{ selectedBook.volume }}</p>
                <p
                  v-if="selectedBook.isFeatured"
                  class="text-xs font-semibold uppercase tracking-wide text-[#607EA6] dark:text-[#9BA7BF]"
                >
                  Featured for Volume
                </p>
              </div>
            </div>

            <section class="overflow-visible rounded-xl bg-zinc-50/50 dark:bg-zinc-900/20">
              <div class="relative h-44 overflow-hidden rounded-t-xl sm:h-56">
                <img
                  v-if="selectedBook.featuredImageUrl"
                  :src="selectedBook.featuredImageUrl"
                  :alt="`Featured header for ${selectedBook.title}`"
                  class="absolute inset-0 h-full w-full object-cover"
                  style="
                    -webkit-mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 1) 62%, rgba(0, 0, 0, 0) 100%);
                    mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 1) 62%, rgba(0, 0, 0, 0) 100%);
                  "
                />
                <div
                  v-else
                  class="absolute inset-0 flex items-center justify-center bg-zinc-100 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                >
                  No featured header image uploaded yet.
                </div>
                <div class="absolute inset-0 bg-gradient-to-b from-zinc-950/25 via-zinc-950/5 to-transparent"></div>
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
                        ? 'border-amber-300/80 bg-black/70 text-amber-300 hover:bg-black/70'
                        : ''
                    "
                    :disabled="selectedBook.isFeatured || featuringBookId === selectedBook.id"
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
                    @click="setFeaturedBookForVolume(selectedBook.id)"
                  >
                    <svg
                      class="h-4 w-4"
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
                    :src="selectedBook.thumbnailUrl"
                    :alt="`Cover of ${selectedBook.title}`"
                    class="h-full w-full object-contain"
                  />
                  <div
                    v-else
                    class="flex h-full w-full items-center justify-center text-center text-xs text-zinc-500 dark:text-zinc-400"
                  >
                    No cover image
                  </div>
                </div>
                <h2 class="text-3xl font-semibold sm:text-4xl">{{ selectedBook.title }}</h2>
                <p class="mt-1 text-zinc-700 dark:text-zinc-300">by {{ selectedBook.author }}</p>
                <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {{ selectedBook.month }} {{ selectedBook.year }}
                </p>
                <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  ISBN: {{ selectedBook.isbn || "Not set" }}
                </p>
              </div>
            </section>
            <p
              v-if="featuredImageMessage"
              class="text-sm"
              :class="
                featuredImageMessageTone === 'error'
                  ? 'text-rose-600 dark:text-rose-300'
                  : 'text-[#607EA6] dark:text-[#9BA7BF]'
              "
            >
              {{ featuredImageMessage }}
            </p>

            <div class="grid gap-4 lg:grid-cols-[1.4fr,1fr]">
              <article class="card space-y-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <h3 class="text-xl font-semibold">Reading Status</h3>
                  <span class="rounded-full bg-[#F2EFDF] px-3 py-1 text-xs font-semibold text-[#3B4013] dark:bg-[#23260F]/60 dark:text-[#F2EFDF]">
                    {{ selectedBookCompletionStats.completed }} / {{ selectedBookCompletionStats.participants }} completed
                  </span>
                </div>
                <div class="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                  <div
                    class="h-full rounded-full bg-[#607EA6] transition-[width] duration-500 dark:bg-[#9BA7BF]"
                    :style="{ width: `${selectedBookCompletionStats.percent}%` }"
                  ></div>
                </div>
                <p class="text-sm text-zinc-600 dark:text-zinc-400">
                  {{
                    selectedBookCompletionStats.participants > 0
                      ? `${selectedBookCompletionStats.remaining} member${selectedBookCompletionStats.remaining === 1 ? "" : "s"} still reading.`
                      : "Member completion stats will appear as members mark this book complete."
                  }}
                </p>

                <div class="flex flex-wrap items-center gap-2">
                  <p v-if="selectedBook.isCompleted" class="text-sm text-[#607EA6] dark:text-[#9BA7BF]">
                    Completed
                    <span v-if="selectedBook.completedAt">
                      on {{ formatDate(selectedBook.completedAt) }} at {{ formatCommentTime(selectedBook.completedAt) }}
                    </span>
                  </p>
                  <p v-else class="text-sm text-zinc-600 dark:text-zinc-400">Not completed yet.</p>
                  <button
                    class="btn-secondary"
                    :disabled="completingBookId === selectedBook.id"
                    @click="setBookCompletion(selectedBook.id, !selectedBook.isCompleted)"
                  >
                    {{
                      completingBookId === selectedBook.id
                        ? "Saving..."
                        : selectedBook.isCompleted
                          ? "Mark as Not Completed"
                          : "Mark as Completed"
                    }}
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
                            : 'text-zinc-300 dark:text-zinc-600'
                        "
                      >
                        ★
                      </span>
                    </div>
                    <p class="text-sm text-zinc-600 dark:text-zinc-400">
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
                  <p v-if="selectedBook.ratingsCount === 0" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
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
                            : 'text-zinc-400 hover:text-zinc-500 dark:text-zinc-500 dark:hover:text-zinc-300'
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
                      class="btn-secondary px-2 py-1 text-xs"
                      :disabled="ratingBookId === selectedBook.id"
                      @click="clearBookRating(selectedBook.id)"
                    >
                      {{ ratingBookId === selectedBook.id ? "Saving..." : "Clear Rating" }}
                    </button>
                  </div>
                </div>
              </article>

              <article class="card space-y-3">
                <div class="flex items-center gap-2">
                  <svg
                    class="h-4 w-4 text-[#607EA6] dark:text-[#9BA7BF]"
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
                <div v-if="selectedBook.meetingStartsAt" class="space-y-2">
                  <p class="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    {{ formatEventDate(selectedBook.meetingStartsAt) }} at {{ formatEventTime(selectedBook.meetingStartsAt) }}
                  </p>
                  <p v-if="selectedBook.meetingLocation" class="text-sm text-zinc-700 dark:text-zinc-300">
                    {{ selectedBook.meetingLocation }}
                  </p>
                  <div class="flex flex-wrap items-center gap-2 pt-1">
                    <a
                      class="btn-secondary px-3 py-1 text-xs"
                      :href="selectedBookMeetingActions.calendarUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Add to Calendar
                    </a>
                    <a
                      v-if="selectedBookMeetingActions.mapUrl"
                      class="btn-secondary px-3 py-1 text-xs"
                      :href="selectedBookMeetingActions.mapUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open Map
                    </a>
                  </div>
                </div>
                <p v-else class="text-sm text-zinc-600 dark:text-zinc-400">
                  No meeting set for this book yet.
                </p>
              </article>
            </div>

            <section v-if="isAdmin" class="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
              <div class="flex items-center justify-between gap-2">
                <h3 class="text-lg font-semibold">Admin Settings</h3>
                <button
                  type="button"
                  class="btn-secondary px-3 py-1 text-xs"
                  :aria-expanded="adminSettingsExpanded ? 'true' : 'false'"
                  @click="adminSettingsExpanded = !adminSettingsExpanded"
                >
                  {{ adminSettingsExpanded ? "Collapse" : "Expand" }}
                </button>
              </div>
              <p class="text-xs text-zinc-500 dark:text-zinc-400">
                Changes here apply to this logical book across all member records for this volume.
              </p>

              <div v-if="adminSettingsExpanded" class="grid gap-3 lg:grid-cols-2">
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
                      ? 'text-rose-600 dark:text-rose-300'
                      : 'text-[#607EA6] dark:text-[#9BA7BF]'
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
                      ? 'text-rose-600 dark:text-rose-300'
                      : 'text-[#607EA6] dark:text-[#9BA7BF]'
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
                <p class="text-xs text-zinc-600 dark:text-zinc-400">
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
                      ? 'text-rose-600 dark:text-rose-300'
                      : 'text-[#607EA6] dark:text-[#9BA7BF]'
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
            </section>

            <div class="space-y-2">
              <h3 class="text-lg font-semibold">Resources</h3>
              <p v-if="selectedBook.resources.length === 0" class="text-sm text-zinc-600 dark:text-zinc-400">
                No resource links yet.
              </p>
              <ul v-else class="space-y-2">
                <li v-for="resource in selectedBook.resources" :key="`${resource.label}-${resource.url}`" class="comment-row">
                  <span>{{ resource.label }}</span>
                  <a
                    class="text-sm font-medium text-[#607EA6] underline dark:text-[#9BA7BF]"
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

        <section v-else-if="activeView === 'volume' && viewingMemberProfile" class="space-y-4">
          <section v-if="loadingMemberProfile" class="panel">
            <p>Loading profile...</p>
          </section>

          <section v-else-if="memberProfile" class="panel space-y-4">
            <div class="flex items-center justify-between gap-3">
              <button class="btn-secondary" @click="closeMemberProfile">Back to Volume</button>
              <p class="text-sm text-zinc-600 dark:text-zinc-400">{{ memberProfile.role }}</p>
            </div>

            <div class="flex flex-wrap items-center gap-4">
              <div class="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
                <img
                  v-if="memberProfile.profileImageUrl"
                  :src="memberProfile.profileImageUrl"
                  :alt="`${memberProfile.name} profile image`"
                  class="h-full w-full object-cover"
                />
                <span v-else class="text-xl font-semibold text-zinc-600 dark:text-zinc-300">
                  {{ getInitials(memberProfile.name) }}
                </span>
              </div>
              <div>
                <h2 class="text-3xl font-semibold">{{ memberProfile.name }}</h2>
                <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Joined {{ formatDate(memberProfile.createdAt) }}
                </p>
              </div>
            </div>

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <article class="card">
                <p class="text-2xl font-semibold">{{ memberProfile.booksRead }}</p>
                <p class="text-sm text-zinc-600 dark:text-zinc-400">Books Completed</p>
              </article>
              <article class="card">
                <p class="text-2xl font-semibold">{{ memberProfile.commentsCount }}</p>
                <p class="text-sm text-zinc-600 dark:text-zinc-400">Comments Posted</p>
              </article>
              <article class="card">
                <p class="text-2xl font-semibold">{{ memberProfile.role }}</p>
                <p class="text-sm text-zinc-600 dark:text-zinc-400">Role</p>
              </article>
            </div>

            <form v-if="isOwnProfile" class="card space-y-2" @submit.prevent="saveProfile">
              <h3 class="text-lg font-semibold">Edit Profile</h3>
              <label class="field-label">
                Name
                <input v-model="profileForm.name" class="input" type="text" required maxlength="80" />
              </label>
              <label class="field-label">
                Profile Image
                <input
                  class="input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  @change="setProfileImageFile"
                />
              </label>
              <p class="text-xs text-zinc-500 dark:text-zinc-400">
                Upload JPG, PNG, WEBP, or GIF up to 2MB.
              </p>
              <p
                v-if="profileMessage"
                class="text-sm"
                :class="
                  profileMessageTone === 'error'
                    ? 'text-rose-600 dark:text-rose-300'
                    : 'text-[#607EA6] dark:text-[#9BA7BF]'
                "
              >
                {{ profileMessage }}
              </p>
              <div class="flex flex-wrap gap-2">
                <button class="btn-primary" :disabled="savingProfile || uploadingProfileImage">
                  {{ savingProfile ? "Saving..." : "Save Profile" }}
                </button>
                <button
                  type="button"
                  class="btn-secondary"
                  :disabled="uploadingProfileImage || !profileImageFile"
                  @click="uploadProfileImage"
                >
                  {{ uploadingProfileImage ? "Uploading..." : "Upload Image" }}
                </button>
                <button
                  type="button"
                  class="btn-danger"
                  :disabled="uploadingProfileImage || !memberProfile.profileImageUrl"
                  @click="clearProfileImage"
                >
                  {{ uploadingProfileImage ? "Working..." : "Remove Image" }}
                </button>
              </div>
            </form>

            <section v-else class="card">
              <p class="text-sm text-zinc-600 dark:text-zinc-400">
                Only this member can edit their profile image.
              </p>
            </section>

            <section class="space-y-2">
              <h3 class="text-lg font-semibold">Recent Comments</h3>
              <p
                v-if="memberRecentComments.length === 0"
                class="text-sm text-zinc-600 dark:text-zinc-400"
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
                    <p class="text-xs text-zinc-500 dark:text-zinc-400">
                      {{ formatDate(comment.createdAt) }} at {{ formatCommentTime(comment.createdAt) }}
                    </p>
                  </div>
                  <button
                    class="btn-secondary shrink-0 px-2 py-1 text-xs"
                    :disabled="!comment.viewerBookId"
                    @click="openBookDetails(comment.viewerBookId)"
                  >
                    {{ comment.viewerBookId ? comment.bookTitle : "Book unavailable" }}
                  </button>
                </li>
              </ul>
            </section>
          </section>

          <section v-else class="panel space-y-3">
            <h2 class="text-2xl font-semibold">Member not found</h2>
            <p class="text-sm text-zinc-600 dark:text-zinc-400">
              This profile may not exist or may be unavailable.
            </p>
            <button class="btn-secondary" @click="closeMemberProfile">Back to Volume</button>
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
              class="panel w-full overflow-hidden p-0 text-left transition hover:-translate-y-0.5 hover:border-[#B59A57] dark:hover:border-[#B59A57]"
              @click="openBookDetails(featuredBook.id)"
            >
              <div class="relative h-[30rem]">
                <div class="h-2/3 overflow-hidden border-b border-zinc-200 dark:border-zinc-700">
                  <img
                    v-if="featuredBook.featuredImageUrl"
                    :src="featuredBook.featuredImageUrl"
                    :alt="`Featured image for ${featuredBook.title}`"
                    class="h-full w-full object-cover"
                  />
                  <div
                    v-else
                    class="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#F2EFDF] to-zinc-200 text-center text-sm font-medium text-zinc-600 dark:from-[#23260F] dark:to-zinc-900 dark:text-zinc-300"
                  >
                    Add a featured image from book details
                  </div>
                </div>
                <div class="h-1/3 p-4 sm:p-5">
                  <p class="text-xs font-semibold uppercase tracking-wide text-[#607EA6] dark:text-[#9BA7BF]">
                    Featured Book
                  </p>
                  <h3 class="mt-1 text-2xl font-semibold leading-tight">{{ featuredBook.title }}</h3>
                  <p class="text-zinc-700 dark:text-zinc-300">by {{ featuredBook.author }}</p>
                  <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <p
                      v-if="featuredBook.isCompleted"
                      class="font-semibold uppercase tracking-wide text-[#607EA6] dark:text-[#9BA7BF]"
                    >
                      Completed
                    </p>
                    <p v-if="featuredBook.ratingsCount > 0" class="text-amber-700 dark:text-amber-300">
                      ★ {{ featuredBook.averageRating.toFixed(1) }} ({{ featuredBook.ratingsCount }})
                    </p>
                  </div>
                  <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    {{ featuredBook.month }} {{ featuredBook.year }} in Volume {{ selectedVolumeLabel ?? currentVolume }}
                  </p>
                  <p class="mt-2 text-sm font-medium text-[#607EA6] dark:text-[#9BA7BF]">Open details</p>
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
                    class="card w-full text-left transition hover:-translate-y-0.5 hover:border-[#B59A57] dark:hover:border-[#B59A57]"
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
                  class="card text-left transition hover:-translate-y-0.5 hover:border-[#B59A57] dark:hover:border-[#B59A57]"
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
                      <p
                        v-if="book.isCompleted"
                        class="mt-1 text-xs font-semibold uppercase tracking-wide text-[#607EA6] dark:text-[#9BA7BF]"
                      >
                        Completed
                      </p>
                      <p v-if="book.ratingsCount > 0" class="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        ★ {{ book.averageRating.toFixed(1) }} ({{ book.ratingsCount }})
                      </p>
                      <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {{ book.comments.length }} comment{{ book.comments.length === 1 ? "" : "s" }}
                      </p>
                      <p class="mt-2 text-sm font-medium text-[#607EA6] dark:text-[#9BA7BF]">Open details</p>
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
                <li v-for="member in members" :key="member.id">
                  <button
                    class="comment-row w-full text-left transition hover:-translate-y-0.5 hover:border-[#B59A57] dark:hover:border-[#B59A57]"
                    @click="openMemberProfile(member.id)"
                  >
                    <div class="flex min-w-0 items-center gap-3">
                      <div class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
                        <img
                          v-if="member.profileImageUrl"
                          :src="member.profileImageUrl"
                          :alt="`${member.name} profile image`"
                          class="h-full w-full object-cover"
                        />
                        <span v-else class="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                          {{ getInitials(member.name) }}
                        </span>
                      </div>
                      <div class="min-w-0">
                        <p class="font-medium text-zinc-900 dark:text-zinc-100">{{ member.name }}</p>
                        <p class="text-xs text-zinc-500 dark:text-zinc-400">
                          Joined {{ formatDate(member.createdAt) }}
                        </p>
                      </div>
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
                  </button>
                </li>
              </ul>
            </section>
          </section>
        </section>

        <section v-else-if="activeView === 'admin' && isAdmin" class="space-y-5">
          <section class="panel space-y-4">
            <div class="flex flex-wrap items-center gap-3">
              <h3 class="text-2xl font-semibold">Admin: Import Reading List</h3>
              <span
                class="rounded border border-[#607EA6]/60 bg-[#607EA6]/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-[#607EA6] dark:text-[#9BA7BF]"
              >
                Admin
              </span>
            </div>
            <div class="h-px bg-zinc-200 dark:bg-zinc-800"></div>
            <div class="inline-flex rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-900/60">
              <button
                type="button"
                class="rounded-lg px-4 py-2 text-sm font-semibold transition"
                :class="
                  adminTab === 'single'
                    ? 'bg-[#B59A57] text-[#23260F] dark:bg-[#B59A57] dark:text-[#23260F]'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                "
                @click="adminTab = 'single'"
              >
                Single Record
              </button>
              <button
                type="button"
                class="rounded-lg px-4 py-2 text-sm font-semibold transition"
                :class="
                  adminTab === 'bulk'
                    ? 'bg-[#B59A57] text-[#23260F] dark:bg-[#B59A57] dark:text-[#23260F]'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                "
                @click="adminTab = 'bulk'"
              >
                Bulk Import
              </button>
              <button
                type="button"
                class="rounded-lg px-4 py-2 text-sm font-semibold transition"
                :class="
                  adminTab === 'approvals'
                    ? 'bg-[#B59A57] text-[#23260F] dark:bg-[#B59A57] dark:text-[#23260F]'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                "
                @click="adminTab = 'approvals'"
              >
                Approvals <span class="text-amber-500">• {{ pendingUsers.length }}</span>
              </button>
            </div>
          </section>

          <section v-if="adminTab === 'single'" class="panel space-y-5">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
              <p class="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600 dark:text-zinc-400">New Record</p>
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
                  class="btn-secondary"
                  :disabled="singleRecordIsbnLookupLoading"
                  @click="autofillSingleRecordFromIsbn(true)"
                >
                  {{ singleRecordIsbnLookupLoading ? "Looking up..." : "Autofill from ISBN" }}
                </button>
              </div>

              <p
                v-if="singleRecordLookupMessage"
                class="text-sm"
                :class="
                  singleRecordLookupMessageTone === 'error'
                    ? 'text-rose-600 dark:text-rose-300'
                    : 'text-[#607EA6] dark:text-[#9BA7BF]'
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
                <button type="button" class="btn-secondary" :disabled="singleRecordSubmitting" @click="resetSingleRecordForm">
                  Reset
                </button>
                <button class="btn-primary" :disabled="singleRecordSubmitting">
                  {{ singleRecordSubmitting ? "Adding..." : "Add Record" }}
                </button>
              </div>
            </form>

            <section class="card space-y-3">
              <div class="flex items-center justify-between gap-2">
                <h4 class="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                  Session Records
                </h4>
                <button
                  class="btn-secondary px-2 py-1 text-xs"
                  :disabled="singleRecordSession.length === 0"
                  @click="clearSingleRecordSession"
                >
                  Clear
                </button>
              </div>
              <p v-if="singleRecordSession.length === 0" class="text-sm text-zinc-600 dark:text-zinc-400">
                No records added this session.
              </p>
              <ul v-else class="space-y-2">
                <li v-for="record in singleRecordSession" :key="record.id" class="comment-row">
                  <div class="min-w-0">
                    <p class="font-medium text-zinc-900 dark:text-zinc-100">{{ record.title }}</p>
                    <p class="text-xs text-zinc-600 dark:text-zinc-400">
                      Volume {{ record.volume }} • {{ record.month }} {{ record.year }} • {{ record.author }}
                    </p>
                  </div>
                  <span class="text-xs text-zinc-500 dark:text-zinc-400">{{ record.isbn }}</span>
                </li>
              </ul>
            </section>
          </section>

          <section v-else-if="adminTab === 'bulk'" class="space-y-5">
            <section class="panel space-y-5">
              <div class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600 dark:text-zinc-400">Bulk Import</p>
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
                  class="input flex cursor-pointer items-center gap-2 text-zinc-600 hover:border-[#B59A57] hover:text-zinc-800 dark:text-zinc-300 dark:hover:border-[#B59A57] dark:hover:text-zinc-100"
                >
                  <input
                    class="sr-only"
                    type="file"
                    accept=".csv,.json"
                    @change="setReadingListFile"
                  />
                  <svg
                    class="h-4 w-4 shrink-0 text-[#607EA6] dark:text-[#9BA7BF]"
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
                    {{ readingListFile ? readingListFile.name : "Upload CSV or JSON..." }}
                  </span>
                </label>
              </div>

              <div class="card space-y-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                <p class="text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">Column Reference</p>
                <p>Required: `volume`, `title`, `author`, `month`.</p>
                <p>Optional: `year` (scheduled read year), `isbn`, `meetingStartsAt`, `meetingLocation`, `thumbnailUrl`, `isFeatured`, `resources`.</p>
                <p>Rules: `volume` integer 1-99, `year` 2025-2100, valid ISBN-10/13, valid URLs, valid meeting date/time.</p>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <div class="flex flex-wrap gap-3">
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
                <button
                  class="btn-primary"
                  :disabled="uploadingReadingList || clearingVolume || clearingUploadHistory || backfillingCovers"
                  @click="uploadReadingList"
                >
                  {{ uploadingReadingList ? "Uploading..." : "Import" }}
                </button>
              </div>
            </section>

            <section class="panel space-y-4">
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
              <ul v-else class="space-y-3">
                <li v-for="upload in uploadHistory" :key="upload.id" class="comment-row py-3">
                  <span>{{ upload.filename }} ({{ formatUploadMode(upload.mode) }}, {{ upload.rowsImported }} {{ upload.mode === "clear" ? "deleted" : upload.mode === "backfill" ? "updated" : "rows" }})</span>
                  <small class="text-xs text-zinc-500 dark:text-zinc-400">
                    {{ formatDate(upload.createdAt) }}
                  </small>
                </li>
              </ul>
            </section>
          </section>

          <section v-else class="panel space-y-4">
            <h4 class="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
              Pending Approvals
            </h4>
            <p v-if="pendingUsers.length === 0" class="text-sm text-zinc-600 dark:text-zinc-400">
              No pending users.
            </p>
            <ul v-else class="space-y-3">
              <li v-for="pendingUser in pendingUsers" :key="pendingUser.id" class="comment-row py-3">
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
          </section>

          <p
            v-if="adminMessage"
            class="text-sm"
            :class="
              adminMessageTone === 'error'
                ? 'text-rose-600 dark:text-rose-300'
                : 'text-[#607EA6] dark:text-[#9BA7BF]'
            "
          >
            {{ adminMessage }}
          </p>
        </section>
      </section>
    </div>
  </main>
</template>
