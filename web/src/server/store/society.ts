import { randomUUID } from "node:crypto";

import { readCollection, writeCollection } from "./jsonStore";

export type SocietyPostRecord = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  body_md: string;
  firebase_uid: string | null;
  author_email: string | null;
  author_display_name: string | null;
  published: boolean;
  pinned: boolean;
  locked: boolean;
  pro_only?: boolean;
  created_at_ms: number;
  updated_at_ms: number;
};

export type SocietyCommentRecord = {
  id: string;
  post_id: string;
  firebase_uid: string;
  author_email: string | null;
  author_display_name: string | null;
  body_md: string;
  created_at_ms: number;
  updated_at_ms: number;
};

type SocietyState = {
  posts: Record<string, SocietyPostRecord>;
  comments: Record<string, SocietyCommentRecord>;
};

function nowMs() {
  return Date.now();
}

function defaultState(): SocietyState {
  return { posts: {}, comments: {} };
}

class SocietyStore {
  private posts = new Map<string, SocietyPostRecord>();
  private comments = new Map<string, SocietyCommentRecord>();

  constructor() {
    const state = readCollection<SocietyState>("society", defaultState());
    this.posts = new Map(Object.entries(state.posts || {}));
    this.comments = new Map(Object.entries(state.comments || {}));
  }

  private persist() {
    writeCollection("society", {
      posts: Object.fromEntries(this.posts.entries()),
      comments: Object.fromEntries(this.comments.entries()),
    });
  }

  listPosts(input: { kind?: string | null; before_ms?: number | null; limit: number }) {
    return [...this.posts.values()]
      .filter((post) => post.published)
      .filter((post) => !input.kind || post.kind === input.kind)
      .filter((post) => input.before_ms == null || post.created_at_ms < input.before_ms)
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return Number(b.pinned) - Number(a.pinned);
        return b.created_at_ms - a.created_at_ms;
      })
      .slice(0, input.limit);
  }

  getPost(id: string) {
    return this.posts.get(id) || null;
  }

  listComments(postId: string, limit: number) {
    return [...this.comments.values()]
      .filter((comment) => comment.post_id === postId)
      .sort((a, b) => a.created_at_ms - b.created_at_ms)
      .slice(0, limit);
  }

  createComment(input: {
    post_id: string;
    firebase_uid: string;
    author_email: string | null;
    author_display_name: string | null;
    body_md: string;
  }) {
    const now = nowMs();
    const comment: SocietyCommentRecord = {
      id: randomUUID(),
      post_id: input.post_id,
      firebase_uid: input.firebase_uid,
      author_email: input.author_email,
      author_display_name: input.author_display_name,
      body_md: input.body_md,
      created_at_ms: now,
      updated_at_ms: now,
    };
    this.comments.set(comment.id, comment);
    const post = this.posts.get(input.post_id);
    if (post) {
      post.updated_at_ms = now;
      this.posts.set(post.id, post);
    }
    this.persist();
    return comment;
  }

  createThread(input: {
    title: string;
    summary: string;
    body_md: string;
    firebase_uid: string;
    author_email: string | null;
    author_display_name: string | null;
  }) {
    const now = nowMs();
    const post: SocietyPostRecord = {
      id: randomUUID(),
      kind: "discussion",
      title: input.title,
      summary: input.summary,
      body_md: input.body_md,
      firebase_uid: input.firebase_uid,
      author_email: input.author_email,
      author_display_name: input.author_display_name,
      published: true,
      pinned: false,
      locked: false,
      created_at_ms: now,
      updated_at_ms: now,
    };
    this.posts.set(post.id, post);
    this.persist();
    return post;
  }
}

const globalStore = globalThis as typeof globalThis & {
  __emwaverSocietyStore?: SocietyStore;
};

export const societyStore = globalStore.__emwaverSocietyStore ?? new SocietyStore();
globalStore.__emwaverSocietyStore = societyStore;
