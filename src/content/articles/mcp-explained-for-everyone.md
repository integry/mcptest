---
title: "What is MCP? A plain-English explanation"
navTitle: MCP for everyone
summary: What the Model Context Protocol is, what problem it solves, and what happens when an AI assistant uses a connected server, explained without code.
track: understand
level: newcomer
order: 20
category: Protocol fundamentals
readingTimeMinutes: 5
lastReviewed: "2026-10-20"
metaTitle: "What Is MCP? A Plain-English Explanation | mcptest.io"
metaDescription: "What is MCP? A plain-English guide to the Model Context Protocol for people who use ChatGPT or Claude: the problem it solves, remote servers, and connecting one."
relatedSlugs:
  - what-is-mcp
  - what-can-you-do-with-mcp
  - is-mcp-safe
  - connect-remote-mcp-server
  - mcp-glossary
sourceLinks:
  - title: "What is the Model Context Protocol (MCP)?"
    url: "https://modelcontextprotocol.io/docs/getting-started/intro"
  - title: "Anthropic: Introducing the Model Context Protocol (November 25, 2024)"
    url: "https://www.anthropic.com/news/model-context-protocol"
  - title: "Anthropic: Donating MCP and establishing the Agentic AI Foundation (December 9, 2025)"
    url: "https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation"
  - title: "Claude: Get started with connectors"
    url: "https://claude.com/docs/connectors"
  - title: "MCP specification: Tools"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/tools"
---

MCP stands for Model Context Protocol. It is a shared set of rules that lets an AI assistant, such as ChatGPT or Claude, connect to other software: your calendar, a document store, an issue tracker, a search engine, a company database. Once connected, the assistant can look things up there and, if you allow it, take actions for you.

Anthropic published MCP in November 2024 as an open standard. It is now maintained as an open project that many companies use, including the makers of ChatGPT, Gemini, Microsoft Copilot, Cursor and Visual Studio Code.

## The problem MCP solves

A chat assistant on its own only knows what it learned during training and what you paste into the conversation. It cannot see today's meeting list, read a file in your company drive, or file a ticket.

Before MCP, every pairing of an assistant and a service needed its own custom integration. If five assistants wanted to work with fifty services, that could mean hundreds of separate pieces of glue code, each built and maintained by someone. Many pairings were never built at all.

MCP replaces those one-off integrations with a single common format. A service describes what it offers once, in the MCP format. Any assistant that speaks MCP can then use it.

## One plug for every tool

The official MCP documentation compares MCP to a USB-C port, and the comparison has become the standard way to explain it. Before USB-C, phones, laptops and cameras each had their own cables. With one shared connector, any cable works with any device that has the port.

MCP does the same for AI assistants. The assistant has one "port", and each service provides a matching "plug". The analogy has a limit worth knowing: a USB-C cable does not decide what to do, but an AI assistant does. The assistant chooses which connected tool to use based on what you ask, which is why permissions matter (see [Is MCP safe?](/learn/is-mcp-safe)).

## The three parts: app, client and server

You will see three words in MCP writing:

- **Host**: the app you use, such as the Claude app, ChatGPT or a code editor.
- **Client**: the part inside that app that talks MCP to one connected service.
- **Server**: the program on the other side that offers abilities to the assistant.

A server mostly offers **tools**, which are actions with a name and a description, such as "search documentation" or "create task". Some servers also offer **resources** (data the app can read) and **prompts** (ready-made instructions). The [glossary](/learn/mcp-glossary) defines these and other terms in one or two sentences each.

## What a remote server is

A server can run in two places.

A **local** server is a small program installed on your own computer. Developers often use these, for example to let a coding assistant read files in a project folder.

A **remote** server runs on the internet at a web address, much like a website. You do not install anything. The assistant connects to the address, and the company that runs the server handles the rest. Most servers aimed at everyday users are remote, because they work in a browser and on a phone. The guide to [remote and local servers](/docs/remote-vs-local) covers the technical differences.

## Who runs MCP servers

Remote servers are usually run by the company whose product they connect to. Notion, Linear, Atlassian, GitHub, Stripe and many others publish their own. Some are free and public: Microsoft Learn, Cloudflare and Context7 run servers that search technical documentation without any sign-in.

Anyone can build and publish a server, which is both the strength and the risk of the system. A server from the company that owns the product is a different thing from an unknown server that claims to connect to it. The [catalog](/catalog) lists public remote servers with their publisher, sign-in method and latest test result.

## What "connect a server" means in practice

In most chat apps, connecting a server (often called a "connector") takes a few steps:

1. Open the app's connector settings and pick a service from its directory, or paste the server's web address.
2. If the service holds private data, you are sent to its own sign-in page. You log in there, not in the chat app, and you see which permissions the assistant is asking for. You approve or cancel.
3. Back in the chat, you turn the connector on for the conversations where you want it.
4. When the assistant wants to use one of the server's tools, the app can ask you first. You can allow it once, allow it always, or block it.

You can disconnect a server at any time. Disconnecting removes the assistant's access to that service; your account at the service itself is unaffected.

## A walk-through: one question, one tool

Suppose you have connected Microsoft's public documentation server and you ask: "How do I rotate a storage account key in Azure?"

1. **The app tells the assistant what is available.** Along with your question, the assistant receives the list of tools from connected servers. For this server that includes a tool for searching Microsoft's documentation, with a short description of what it does.
2. **The assistant decides to use a tool.** It recognizes that current documentation will give a better answer than memory, so it prepares a request: search for "rotate storage account access keys".
3. **The app may ask for your approval.** If you have set this tool to need approval, you see the tool name and the search text and choose whether to allow it.
4. **The server does the work.** The app sends the request to the server's web address. The server runs the search and returns the matching passages.
5. **The assistant answers.** It reads the returned text and writes a reply, usually pointing to the pages it used.

The assistant never logged in to Microsoft's systems or browsed the web on its own. It asked a server to run one named tool, the server answered, and the answer came back into the chat. Every MCP tool call follows that same pattern, whether the tool searches documents, reads your calendar or creates an invoice.

## What MCP does not do

MCP is a way to connect, not a guarantee of quality or safety. It does not make an assistant's answers correct, it does not check whether a server is trustworthy, and it does not decide what you have agreed to share. Those depend on the server's publisher, the permissions you grant and the approval settings in your app.

## Try a real server

You can see exactly what an assistant sees. [Open the Microsoft Learn server in the mcptest.io playground](/server/learn.microsoft.com/api/mcp/mcp): it needs no account, lists the server's tools with their descriptions, and lets you run a documentation search yourself.
