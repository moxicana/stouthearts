<script setup>
import { computed, ref, watch } from "vue";

const CURRENT_YEAR = new Date().getFullYear();
const PAST_YEAR = 2025;
const STORAGE_KEY = "bookclub.homepage.v1";

const activeView = ref("home");
const commentDrafts = ref({});
const state = ref(loadState());

const currentYearBooks = computed(() => state.value[String(CURRENT_YEAR)] || []);
const pastBooks = computed(() => state.value[String(PAST_YEAR)] || []);
const featuredBook = computed(
  () => currentYearBooks.value.find((book) => book.isFeatured) || currentYearBooks.value[0]
);

watch(
  state,
  (value) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  },
  { deep: true }
);

function defaultState() {
  return {
    [String(CURRENT_YEAR)]: [
      {
        id: crypto.randomUUID(),
        title: "The Ministry for the Future",
        author: "Kim Stanley Robinson",
        month: "February",
        isFeatured: true,
        comments: [
          {
            id: crypto.randomUUID(),
            text: "Great opening discussion on climate policy.",
            createdAt: new Date(`${CURRENT_YEAR}-02-07`).toISOString()
          }
        ]
      },
      {
        id: crypto.randomUUID(),
        title: "Tomorrow, and Tomorrow, and Tomorrow",
        author: "Gabrielle Zevin",
        month: "March",
        isFeatured: false,
        comments: [
          {
            id: crypto.randomUUID(),
            text: "Potential pick for our game-dev themed month.",
            createdAt: new Date(`${CURRENT_YEAR}-01-29`).toISOString()
          }
        ]
      },
      {
        id: crypto.randomUUID(),
        title: "Pachinko",
        author: "Min Jin Lee",
        month: "April",
        isFeatured: false,
        comments: []
      },
      {
        id: crypto.randomUUID(),
        title: "The Seven Husbands of Evelyn Hugo",
        author: "Taylor Jenkins Reid",
        month: "May",
        isFeatured: false,
        comments: []
      },
      {
        id: crypto.randomUUID(),
        title: "The Thursday Murder Club",
        author: "Richard Osman",
        month: "June",
        isFeatured: false,
        comments: []
      },
      {
        id: crypto.randomUUID(),
        title: "The Vanishing Half",
        author: "Brit Bennett",
        month: "July",
        isFeatured: false,
        comments: []
      }
    ],
    [String(PAST_YEAR)]: [
      {
        id: crypto.randomUUID(),
        title: "Station Eleven",
        author: "Emily St. John Mandel",
        month: "January",
        comments: [
          {
            id: crypto.randomUUID(),
            text: "One of our highest-rated books from last year.",
            createdAt: new Date(`${PAST_YEAR}-01-24`).toISOString()
          }
        ]
      },
      {
        id: crypto.randomUUID(),
        title: "The Nickel Boys",
        author: "Colson Whitehead",
        month: "May",
        comments: []
      },
      {
        id: crypto.randomUUID(),
        title: "Demon Copperhead",
        author: "Barbara Kingsolver",
        month: "September",
        comments: []
      },
      {
        id: crypto.randomUUID(),
        title: "The Wager",
        author: "David Grann",
        month: "October",
        comments: []
      },
      {
        id: crypto.randomUUID(),
        title: "Yellowface",
        author: "R. F. Kuang",
        month: "November",
        comments: []
      },
      {
        id: crypto.randomUUID(),
        title: "Project Hail Mary",
        author: "Andy Weir",
        month: "December",
        comments: []
      }
    ]
  };
}

function loadState() {
  try {
    const defaults = defaultState();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;

    const parsed = JSON.parse(raw);
    return {
      [String(CURRENT_YEAR)]: mergeWithDefaults(
        parsed[String(CURRENT_YEAR)],
        defaults[String(CURRENT_YEAR)]
      ),
      [String(PAST_YEAR)]: mergeWithDefaults(parsed[String(PAST_YEAR)], defaults[String(PAST_YEAR)])
    };
  } catch {
    return defaultState();
  }
}

function mergeWithDefaults(candidate, defaults) {
  if (!Array.isArray(candidate) || candidate.length === 0) return defaults;
  return candidate.map((book) => ({
    ...book,
    comments: Array.isArray(book.comments) ? book.comments : []
  }));
}

function addComment(bookId, year) {
  const text = (commentDrafts.value[bookId] || "").trim();
  if (!text) return;

  const yearKey = String(year);
  const book = state.value[yearKey].find((item) => item.id === bookId);
  if (!book) return;

  if (!Array.isArray(book.comments)) {
    book.comments = [];
  }

  book.comments.unshift({
    id: crypto.randomUUID(),
    text,
    createdAt: new Date().toISOString()
  });

  commentDrafts.value[bookId] = "";
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString();
}
</script>

<template>
  <main class="page">
    <header class="hero">
      <h1>Book Club</h1>
      <p>Our reading list for {{ CURRENT_YEAR }}</p>
    </header>

    <nav class="top-nav">
      <button :class="{ active: activeView === 'home' }" @click="activeView = 'home'">
        Home
      </button>
      <button :class="{ active: activeView === 'past' }" @click="activeView = 'past'">
        Past Books ({{ PAST_YEAR }})
      </button>
    </nav>

    <section v-if="activeView === 'home'" class="content">
      <article v-if="featuredBook" class="featured">
        <p class="eyebrow">Featured Book of the Month</p>
        <h2>{{ featuredBook.title }}</h2>
        <p>by {{ featuredBook.author }}</p>
        <p class="month">{{ featuredBook.month }} {{ CURRENT_YEAR }}</p>
      </article>

      <section class="panel">
        <h3>Reading in {{ CURRENT_YEAR }}</h3>
        <div class="books-grid">
          <article v-for="book in currentYearBooks" :key="book.id" class="book-card">
            <h4>{{ book.title }}</h4>
            <p class="meta">{{ book.author }} | {{ book.month }}</p>

            <div class="comments">
              <p class="comments-label">Comments</p>
              <p v-if="!book.comments || book.comments.length === 0" class="empty">
                No comments yet.
              </p>
              <ul v-else>
                <li v-for="comment in book.comments" :key="comment.id">
                  <span>{{ comment.text }}</span>
                  <small>{{ formatDate(comment.createdAt) }}</small>
                </li>
              </ul>
              <div class="comment-input">
                <input
                  v-model="commentDrafts[book.id]"
                  placeholder="Add comment..."
                  @keyup.enter="addComment(book.id, CURRENT_YEAR)"
                />
                <button @click="addComment(book.id, CURRENT_YEAR)">Add</button>
              </div>
            </div>
          </article>
        </div>
      </section>
    </section>

    <section v-else class="content">
      <section class="panel">
        <h3>Books from {{ PAST_YEAR }}</h3>
        <div class="books-grid">
          <article v-for="book in pastBooks" :key="book.id" class="book-card">
            <h4>{{ book.title }}</h4>
            <p class="meta">{{ book.author }} | {{ book.month }} {{ PAST_YEAR }}</p>

            <div class="comments">
              <p class="comments-label">Comments</p>
              <p v-if="!book.comments || book.comments.length === 0" class="empty">
                No comments yet.
              </p>
              <ul v-else>
                <li v-for="comment in book.comments" :key="comment.id">
                  <span>{{ comment.text }}</span>
                  <small>{{ formatDate(comment.createdAt) }}</small>
                </li>
              </ul>
              <div class="comment-input">
                <input
                  v-model="commentDrafts[book.id]"
                  placeholder="Add comment..."
                  @keyup.enter="addComment(book.id, PAST_YEAR)"
                />
                <button @click="addComment(book.id, PAST_YEAR)">Add</button>
              </div>
            </div>
          </article>
        </div>
      </section>
    </section>
  </main>
</template>
