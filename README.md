# Clipzi for agents and terminals

[Clipzi](https://clipzi.app) turns long videos (podcasts, interviews, streams, lectures) into finished short vertical clips: it finds the moments that stand on their own, frames each one for vertical (the person talking, a split screen when two talk), captions it, removes dead air and renders the mp4.

This repository is everything an agent needs to use it:

- **`clipzi`**, the command line (`npx clipzi`), for terminals, scripts and agents that run commands.
- **The `clipzi` skill** (`skills/clipzi/SKILL.md`), which teaches an agent when and how to use it.
- **Plugins** for Claude Code and Gemini CLI that bring the skill and Clipzi's MCP server together.

## Quick start

```bash
npx clipzi login                      # opens the browser: sign in and allow this terminal
npx clipzi make ./episode.mp4 --count 5 --out ./clips
```

`make` uploads the file, lets Clipzi choose the moments, frames and captions each clip and saves every mp4 in `./clips` as it finishes. The source can also be a link to the video file (direct, Google Drive or Dropbox) or the id of a video already in your account.

No browser (a server, CI, a headless agent)? Create a key at https://clipzi.app/dashboard/agents and set `CLIPZI_API_KEY`.

## Install it in your agent

| Agent | How |
|---|---|
| Any agent that reads skills | `npx skills add gonzaloorsi/clipzi-agent` |
| Claude Code (skill + MCP server) | `/plugin marketplace add gonzaloorsi/clipzi-agent`, then `/plugin install clipzi@clipzi` |
| Claude Code (MCP server only) | `claude mcp add --transport http clipzi https://clipzi.app/mcp` |
| Gemini CLI | `gemini extensions install https://github.com/gonzaloorsi/clipzi-agent` |
| Claude.ai, ChatGPT, Cursor and others | Add a connector with the address `https://clipzi.app/mcp`: https://clipzi.app/en/mcp |

## Commands

```
clipzi make <file | link | video_id> [--count 5] [--query "..."] [--template t] [--pace p] [--title] [--horizontal] [--out ./clips]
clipzi account | videos | video <id> | clips <video_id> | transcript <video_id> | find <video_id> <words>
clipzi upload <file> | import <link> | render <clip_id> | job <job_id>
clipzi tools | call <tool> '<json>'
```

Every command prints JSON on stdout and progress on stderr. Exit codes: 0 done, 1 the tool could not (the JSON says why and what to do), 2 wrong usage, 3 not signed in.

## Plans

Every Clipzi plan includes the agent tools. Without a plan you can try it with your own video (2 long videos, 5 clips edited by the AI): the clips come back as a page in Clipzi where you watch them, and downloading needs a plan. Plans: https://clipzi.app/en#pricing

The CLI is a client of Clipzi's MCP server, so it follows exactly the same rules as Claude or ChatGPT do. Developer docs: https://clipzi.app/en/developers

## License

MIT
