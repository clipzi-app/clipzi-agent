---
name: clipzi
description: Turn a long video (podcast, interview, stream, lecture, webinar) into finished short vertical clips for TikTok, Reels and YouTube Shorts with Clipzi. Use when the user wants clips, shorts, reels or highlights from a long video file, wants the best or funniest moments of a recording, or wants a specific moment cut, framed for vertical (following whoever talks, split screen for two), captioned and exported as mp4.
---

# Clipzi

Clipzi takes a long video and gives back finished short clips: it transcribes it, finds the moments that stand on their own (cut on whole sentences), frames each one for vertical (the person talking, a split screen when two talk), adds captions and a title, removes dead air, and renders the mp4. You drive it with the Clipzi tools this plugin connects (the MCP server at https://clipzi.app/mcp). The person signs in with their Clipzi account the first time; it is created right there if they do not have one, with no card.

Do the whole job yourself, start to finish. If the request is vague (how many clips, which moments), choose sensibly: 3 clips, the best moments.

## The short way

1. Get the video into Clipzi (see "The video").
2. `make_clips` with the video's id, or with `url` for a link to the file. Pass `count`, and `query` when they asked for a topic or a kind of moment ("the funniest parts").
3. `get_job` with `wait_seconds: 50`, again until `status` is `done`. `result.clips` fills in as each clip finishes: hand each one over as it arrives.

Allow a few minutes for the analysis of a new video, plus 2 to 4 minutes per clip.

## The video

- **A link to the file** (direct https, or a Google Drive or Dropbox share link set to "anyone with the link"): pass it as `url` to `make_clips`, or to `import_video`.
- **A file on the person's computer, and you have a terminal**: `upload_video` returns an address and the exact command to send the file to it; run it, then `finish_upload`.
- **A file on the person's computer, and you have no terminal**: `get_upload_link` returns the person's Clipzi page. Give them that link, ask them to drop the video there and tell you when it finished; then `list_videos` (the new one is first).
- **Already in the account**: `list_videos`.
- A YouTube, TikTok, Instagram or Vimeo page does not work, and never explain how to download from those sites. Ask for the file.

## Step by step (when the person wants to choose)

1. `list_clips` shows the moments Clipzi found. `find_moments` searches what is said. `get_transcript` reads it so you can choose a start and an end yourself.
2. `create_clip` makes a clip from times you chose.
3. `make_clips` with `clip_ids` plans and renders exactly those. Or one at a time: `plan_clip`, then `render_clip`.
4. To restyle a clip without planning it again (title, caption look, logo, texts on the video): `edit_clip`, then `render_clip`. `list_templates` says what each caption look is.

## Rules

- Times are in seconds.
- Ask the person before deleting anything (`delete_clip`, `delete_clip_file`) or replacing a clip they edited (`plan_clip` with `force`).
- An account without a plan can try Clipzi (2 long videos, 5 clips edited by the AI). Its clips come back as `watch_page` instead of a file: give the person that link, where they watch the clip in Clipzi. Downloading needs a plan.
- When a tool answers `quota`, `paid_plan_required` or `payment_required`, call `get_account`, tell the person where they stand, and offer `get_upgrade_link`. The person pays on that page; never you.

## Hand over

For each finished clip give its title, its length and its link: `url` (the mp4), or `watch_page` when the account has no plan. End with one line: every clip is also at https://clipzi.app/dashboard, where they can change anything (framing, captions, title, cuts).

Reference (limits, error codes): https://clipzi.app/en/developers
