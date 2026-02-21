<script setup>
defineOptions({ name: "BookCommentThread" });

const props = defineProps({
  comments: {
    type: Array,
    default: () => []
  },
  activeReplyCommentId: {
    type: String,
    default: ""
  },
  replyDrafts: {
    type: Object,
    default: () => ({})
  },
  commentActionId: {
    type: String,
    default: ""
  },
  canDeleteComment: {
    type: Function,
    required: true
  },
  formatDate: {
    type: Function,
    required: true
  },
  formatCommentTime: {
    type: Function,
    required: true
  }
});

const emit = defineEmits([
  "toggle-reply",
  "set-reply-draft",
  "submit-reply",
  "toggle-like",
  "delete-comment"
]);

function onDraftInput(commentId, event) {
  emit("set-reply-draft", commentId, event?.target?.value || "");
}

function forwardSetReplyDraft(...args) {
  emit("set-reply-draft", ...args);
}
</script>

<template>
  <ul class="space-y-2">
    <li v-for="comment in props.comments" :key="comment.id" class="space-y-2">
      <article class="comment-row flex-col items-stretch gap-2">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <p>{{ comment.text }}</p>
            <small class="text-xs text-zinc-500 dark:text-zinc-300">
              by {{ comment.authorName || "Unknown" }} on
              {{ props.formatDate(comment.createdAt) }} at
              {{ props.formatCommentTime(comment.createdAt) }}
            </small>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="btn-secondary icon-btn px-2 py-1 text-xs"
              @click="emit('toggle-reply', comment.id)"
            >
              <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10 14 4 20M4 20v-6m0 6h6" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M20 5H9a5 5 0 0 0-5 5v4" />
              </svg>
              <span>{{ props.activeReplyCommentId === comment.id ? "Cancel" : "Reply" }}</span>
            </button>
            <button
              type="button"
              class="btn-secondary icon-btn px-2 py-1 text-xs"
              :class="
                comment.likesCount > 0
                  ? 'border-[#C8963E]/70'
                  : 'text-zinc-600 dark:text-zinc-300'
              "
              :style="
                comment.likesCount > 0
                  ? { color: '#C8963E', borderColor: '#C8963E' }
                  : undefined
              "
              :aria-pressed="comment.isLikedByUser ? 'true' : 'false'"
              :disabled="props.commentActionId === `like:${comment.id}`"
              @click="emit('toggle-like', comment)"
            >
              <svg
                class="ui-icon"
                viewBox="0 0 24 24"
                :fill="comment.likesCount > 0 ? 'currentColor' : 'none'"
                stroke="currentColor"
                stroke-width="1.8"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M6 6.5h10v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-11Z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M16 8h1.8a2.2 2.2 0 0 1 0 4.4H16"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M8.2 6.5v2.4M10.9 6.5v2.4M13.6 6.5v2.4"
                />
              </svg>
              <span>{{ comment.likesCount }}</span>
            </button>
            <button
              v-if="props.canDeleteComment(comment)"
              type="button"
              class="btn-danger icon-btn px-2 py-1 text-xs"
              :disabled="props.commentActionId === `delete:${comment.id}`"
              @click="emit('delete-comment', comment)"
            >
              <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12"></path>
              </svg>
              <span>{{ props.commentActionId === `delete:${comment.id}` ? "Deleting..." : "Delete" }}</span>
            </button>
          </div>
        </div>

        <div v-if="props.activeReplyCommentId === comment.id" class="flex gap-2">
          <input
            :value="props.replyDrafts[comment.id] || ''"
            class="input"
            placeholder="Write a reply..."
            @input="onDraftInput(comment.id, $event)"
            @keyup.enter="emit('submit-reply', comment.id)"
          />
          <button
            class="btn-primary icon-btn"
            :disabled="props.commentActionId === `reply:${comment.id}`"
            @click="emit('submit-reply', comment.id)"
          >
            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" />
            </svg>
            <span>{{ props.commentActionId === `reply:${comment.id}` ? "Adding..." : "Reply" }}</span>
          </button>
        </div>
      </article>

      <div v-if="comment.replies && comment.replies.length > 0" class="ml-4 border-l-2 border-zinc-200 pl-3 dark:border-zinc-700">
        <BookCommentThread
          :comments="comment.replies"
          :active-reply-comment-id="props.activeReplyCommentId"
          :reply-drafts="props.replyDrafts"
          :comment-action-id="props.commentActionId"
          :can-delete-comment="props.canDeleteComment"
          :format-date="props.formatDate"
          :format-comment-time="props.formatCommentTime"
          @toggle-reply="emit('toggle-reply', $event)"
          @set-reply-draft="forwardSetReplyDraft"
          @submit-reply="emit('submit-reply', $event)"
          @toggle-like="emit('toggle-like', $event)"
          @delete-comment="emit('delete-comment', $event)"
        />
      </div>
    </li>
  </ul>
</template>
