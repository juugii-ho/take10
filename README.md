# TAKE10 — a simulation studio for video

**No actors. No location. Just the right take.**

Built at c0mpiled-17 Seoul (2026-11-09) · RFS: AI-Powered Consumer Products for a Billion People

## Problem
A 30-second campaign video (e.g. an anti-school-bullying spot) needs actors, a location, a crew and a shoot day —
and you still only get the one scene you planned.

## What TAKE10 does
1. **Pick a space** — a floor plan the agents can reason about (school cafeteria, office floor).
2. **Cast** — every character is an independent AI agent with its own persona. Each turn it only sees its own
   position, who is nearby and what was just said or done, and decides its own thought, line, action and movement.
   **Nothing is scripted.**
3. **Write your message** — e.g. "한 사람의 목소리가 바꿀 수 있다" (one voice can change it).
4. **Run ×N** — the same moment is simulated as several takes in parallel; they diverge (in one take the new student
   walks away, in another the bystander finally speaks up).
5. **A director agent** scores every take against your message (penalising preachy or forced ones) and marks the
   **BEST MATCH**.
6. **Film it** — a 3D viewer replays the chosen take; place the camera anywhere (wide, close-up, over-the-shoulder,
   top, or free orbit like Blender) and record the shot to a video file.

## Run
```bash
node server/index.js        # http://localhost:8795  (Node 18+, no dependencies)
```
Requires a logged-in `claude` CLI (agents use Claude Haiku for speed, the director uses the default Claude model).
`MAX_AGENTS` env limits concurrent agent calls (default 10).

## How it works
- `server/index.js` — space packs, per-character agent turns (perception → JSON thought/say/action/move_to,
  movement clamped to 3 m per beat and blocked by furniture), parallel takes, director judging.
- `web/index.html` — studio UI: setup, live take grid (top-down), agent log with inner thoughts, best match.
- `web/viewer.js` — Three.js camera viewer and recorder (three.js vendored, MIT).

All characters and situations are fictional. Not affiliated with Anthropic.
