# MemChat

**The project in this repository is [`memory-app/`](memory-app/).** Start with
[`memory-app/README.md`](memory-app/README.md) for what it is, how it is
deployed, and how to run it locally.

MemChat is a notes app with an assistant that answers from your notes first:
text notes, checklists, a daily diary, tags, pins and date filtering, with a
chat panel that can search and add to them. It runs on Vercel, Render, Qdrant
Cloud and Groq.

**Live:** https://mem-chat.vercel.app (the backend sleeps when idle, so the
first request can take up to 50 seconds)

## The rest of this repository

Everything outside `memory-app/` comes from the
[AI Cookbook](https://github.com/daveebbelaar/ai-cookbook) by Dave Ebbelaar,
which this repository was forked from: examples and tutorials for building AI
systems. MemChat uses one piece of it directly, the Qdrant Docker setup in
`knowledge/mem0/docker/`, for local development.
