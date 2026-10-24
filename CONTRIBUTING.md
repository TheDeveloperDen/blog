# Contributing a Post

Thanks for writing for the DevDen blog! Please read the [rules](RULES.md) first.

> [!NOTE]
> You don't need to be confident with Git! The GitHub web UI should be enough. If you have trouble, feel free to ask for help in the Discord!

## TLDR

1. Make a fork, if you haven't already.
2. Add a folder for your posts under `posts/`, named in lowercase with words joined by `-` (e.g. `my-first-post`). This becomes the post's web address.
3. Put your post's content in a file named `index.md` in this folder. Images can also go in this folder.
4. Open a Pull Request (PR). You should get automated feedback if you did anything wrong, and then it will be manually reviewed.


## Your Post

Copy [`posts/_template/`](posts/_template/) to get started. A post is a Markdown file with a few lines of details at the top:

```markdown
---
title: My first post
authors: [your-handle]
tags: [java, learning]
---

Today I finally worked out how classes work in Java...
```

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | |
| `authors` | yes | Your GitHub username. You must be one of the authors of a post you submit |
| `tags` | no | Lowercase, words joined with `-` (e.g. `game-dev`) |
| `summary` | no | A 1-2 sentence summary. If you skip it, the start of the post is used. |

### Images

Put images in your post's folder, next to `index.md`, and refer to them by file name:

```markdown
![A screenshot of the finished game, with the score at 12](screenshot.png)
```

- Supported Formats: `png`, `jpg`, or `webp`. No size limit (for now, please don't abuse).
- Write alt text (the part in the square brackets) describing the image.
- Only use images you have the right to share. See the [rules](RULES.md#your-own-work).

## Your Author Profile (optional)

By default, authors are shown with their GitHub & Discord username and avatar. To add a display name and short bio, create `authors/your-github-username.md`:
```markdown
---
name: Your Name or Nickname
---

A sentence or two about you as a short bio. Linking to other sites (GitHub, socials, etc) is allowed!
```

## How to open the Pull Request

### On the GitHub Website 

1. In the `posts` folder, click **Add File -> Create new file**.
2. In the name box, type the path with slashes, e.g. `my-first-post/index.md`. Typing a `/` makes a file inside a folder.
3. Write the post, then click Commit changes and choose to create a Pull Request.
4. To add an image, open your new folder and use **Add file** -> **Upload files**.

## What happens next

1. **Automatic checks** run on your PR. If any fail, the message should say what to fix. You can edit your files and push again.
2. A **staff member reviews** the post. They may ask for changes, this is normal and nothing to worry about!
3. When it's approved and merged, the post appears on the website shortly afterwards.

## Changing or removing a post

Simply open a new PR editing or removing the post!

## License

By opening a pull request, you agree to publish your post under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See the [rules](RULES.md#licence).

