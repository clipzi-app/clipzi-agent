---
name: clipzi
description: Turn a long video (podcast, interview, stream, lecture, webinar) into finished short vertical clips for TikTok, Reels and YouTube Shorts with Clipzi. Use when the user wants clips, shorts, reels or highlights from a long video file, wants the best or funniest moments of a recording, or wants a specific moment cut, framed for vertical (following whoever talks, split screen for two), captioned and exported as mp4.
---

# Clipzi

Clipzi takes a long video and gives back finished short clips: it transcribes it, finds the moments that stand on their own (cut on whole sentences), frames each one for vertical (the person talking, a split screen when two talk), adds captions and a title, removes dead air, and renders the mp4. You drive it with the `clipzi` command. Every command prints JSON on stdout; progress goes to stderr.

## Setup (once)

- A person with a browser: `npx clipzi login` opens Clipzi to sign in and allow this terminal. No account yet? The same screen creates one.
- A server, CI or an agent with no browser: set `CLIPZI_API_KEY` to a key the person creates at https://clipzi.app/dashboard/agents.
- Check with `npx clipzi account`: the plan, how many long videos are left, how many clips the AI can still edit.

## The short way

```bash
npx clipzi make ./episode.mp4 --count 5 --out ./clips
```

- The source can be a local file (uploaded for you), a link to the video FILE (direct https, or a Google Drive / Dropbox share link set to "anyone with the link"), or the id of a video already in Clipzi (`clipzi videos`).
- `--query "where they talk about pricing"` makes the clips about that instead of the best moments overall.
- `--template` picks the caption look (`clipzi call list_templates` lists them), `--pace off|natural|fast|extra` how much dead air is cut, `--title` puts the suggested title on the video, `--horizontal` gives each clip as it was filmed (no framing or captions; faster).
- Each clip is saved in `--out` as it finishes, named after its title. Allow a few minutes for the analysis of a new video plus 2 to 4 minutes per clip.

## Step by step (when the person wants to choose)

1. `clipzi upload <file> --wait` or `clipzi import <link> --wait` brings the video in and waits for the analysis.
2. `clipzi clips <video_id>` lists the moments Clipzi found. `clipzi find <video_id> the funniest story` searches what is said. `clipzi transcript <video_id>` reads it to choose start and end yourself.
3. `clipzi call create_clip '{"video_id":"...","start":120.5,"end":158,"title":"..."}'` makes a clip from times you chose.
4. `clipzi make <video_id> --clips <id1,id2>` plans and renders exactly those clips. Or one at a time: `clipzi call plan_clip '{"clip_id":"..."}'`, then `clipzi render <clip_id>`.
5. To restyle a clip without planning it again (title, caption look, logo, texts on the video): `clipzi call edit_clip '{"clip_id":"...","template":"..."}'`, then `clipzi render <clip_id>`.

`clipzi tools` lists every tool the server has and `clipzi call <tool> '<json>'` runs any of them.

## Rules

- Times are in seconds.
- Ask the person before deleting anything (`delete_clip`, `delete_clip_file`) or replacing a clip they edited (`plan_clip` with `force`).
- Links to pages that play a video (YouTube, TikTok, Instagram, Vimeo) do not work: ask for the file, or a Drive / Dropbox link to it.
- An account without a plan can try Clipzi (2 long videos, 5 clips edited by the AI). Its clips come back as `watch_page` instead of a file: give the person that link, where they watch the clip in Clipzi. Downloading needs a plan.
- When a command answers `quota`, `paid_plan_required` or `payment_required`, run `clipzi account` and offer `clipzi call get_upgrade_link '{"plan":"starter_2026"}'` (or `agency` for Pro, `studio` for Business). The person pays on that page; never you.
- Exit codes: 0 done, 1 the tool could not (the JSON `error.message` says what to do), 2 wrong usage, 3 not signed in.

Everything made here also shows up in the Clipzi web app (https://clipzi.app/dashboard), where the person can change any clip. Docs: https://clipzi.app/en/developers
