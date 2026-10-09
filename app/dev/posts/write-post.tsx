'use client';

import { Plus } from 'lucide-react';
import { useActionState, useState } from 'react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { ComposeBody, ComposeBox, ComposeTitle } from '@/components/ui/field';
import { MAX_ANGLE, MAX_THREAD_POSTS } from '@/lib/dev/posts';
import { writePost, type PostsActionState } from './actions';
import { Counter } from './post-item';

/**
 * Write your own post: a line under the heading, beside Ask for a post, that
 * opens a compose box. The first line says what the post is about and may be
 * left blank; under it is one box per post in the thread, each with X's
 * counter, and "Add a post" opens the next, up to five.
 *
 * What is saved joins the drafts as a suggested row, so from there it is
 * edited, copied and marked posted like one Dash wrote. Unlike Ask for a
 * post, no run is started, so it is never held off while one is going.
 *
 * `defaultOpen` is for the surface gallery, which draws the box open.
 */
export function WritePost({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [posts, setPosts] = useState(['']);
  const [state, action, pending] = useActionState(
    async (prev: PostsActionState, formData: FormData) => {
      const next = await writePost(prev, formData);
      if (!next.error) {
        setOpen(false);
        setPosts(['']);
      }
      return next;
    },
    {} as PostsActionState,
  );

  if (!open) return <AddTrigger label="Write your own" onClick={() => setOpen(true)} />;

  const thread = posts.length > 1;
  return (
    <form action={action} className="space-y-1">
      <ComposeBox className="space-y-2">
        <ComposeTitle
          name="angle"
          maxLength={MAX_ANGLE}
          aria-label="What the post is about"
          placeholder="What it is about, in a line (optional)"
        />
        {posts.map((text, index) => {
          const label = thread ? `Post ${index + 1}` : 'The post';
          const counterId = `write-post-${index}-count`;
          return (
            <div key={index} className={thread ? 'border-l-2 border-border pl-3' : undefined}>
              <ComposeBody
                name="post"
                required={index === 0}
                autoFocus={index === posts.length - 1}
                rows={3}
                value={text}
                onChange={(event) =>
                  setPosts((current) => current.map((p, i) => (i === index ? event.target.value : p)))
                }
                aria-label={label}
                aria-describedby={counterId}
                placeholder={index === 0 ? 'Write the post' : 'The next post in the thread'}
              />
              <div className="flex justify-end">
                <Counter text={text} id={counterId} />
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {posts.length < MAX_THREAD_POSTS && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setPosts((p) => [...p, ''])}>
              <Plus className="size-3.5" aria-hidden />
              Add a post
            </Button>
          )}
          <span className="ml-auto flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setPosts(['']);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" pending={pending}>
              {pending ? 'Saving…' : 'Save draft'}
            </Button>
          </span>
        </div>
      </ComposeBox>
      {state.error && (
        <p role="alert" className="text-small text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
