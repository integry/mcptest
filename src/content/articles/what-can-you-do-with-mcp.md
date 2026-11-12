---
title: What can you do with MCP?
navTitle: What you can do with MCP
summary: "Six practical uses of MCP servers, from searching your own documents to coding agents and unattended automation, each with a real public server and its honest limits."
track: understand
level: newcomer
order: 21
category: Use cases
readingTimeMinutes: 4
lastReviewed: "2026-10-20"
metaTitle: "What Can You Do With MCP? Use Cases and Limits | mcptest.io"
metaDescription: "Real MCP use cases: chat with your own data, act in your tools, voice on the go, coding agents and automation. Each names a public server and its limits."
relatedSlugs:
  - mcp-explained-for-everyone
  - is-mcp-safe
  - connect-remote-mcp-server
  - mcp-clients-compared
  - mcp-vs-api-vs-function-calling
sourceLinks:
  - title: "What is the Model Context Protocol (MCP)?"
    url: "https://modelcontextprotocol.io/docs/getting-started/intro"
  - title: "Claude: Get started with connectors"
    url: "https://claude.com/docs/connectors"
  - title: "Claude: Get started with custom connectors using remote MCP"
    url: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
  - title: "VS Code: Add and manage MCP servers"
    url: "https://code.visualstudio.com/docs/agent-customization/mcp-servers"
  - title: "Claude API: MCP connector"
    url: "https://platform.claude.com/docs/en/agents-and-tools/mcp-connector"
  - title: "OpenAI API: Connectors and MCP servers"
    url: "https://developers.openai.com/api/docs/guides/tools-connectors-mcp"
---

An MCP server gives an AI assistant a set of named abilities in one product: search these documents, read this calendar, create this ticket. What you can do depends on which servers you connect and which app you use them from. The uses below are grouped by what changes for you, and each names a public server from the [mcptest.io catalog](/catalog) that you can inspect before connecting.

## Look up current documentation

Language models are trained on a snapshot of the web, so their knowledge of software products goes stale. Documentation servers let the assistant search the publisher's current pages and quote them.

- **Microsoft Learn** searches Azure, .NET and Microsoft 365 documentation and code samples.
- **AWS Knowledge** and **Cloudflare Docs** do the same for their platforms.
- **DeepWiki** answers questions about public GitHub repositories.

All four are free and need no sign-in, which makes them the easiest place to start.

**Limits.** The assistant only sees the passages the search returns. A vague question can bring back the wrong page, and the assistant may still combine retrieved text with its own memory. Check the cited links for anything you will act on.

## Chat with your own data

Servers from workspace products let the assistant search and read what you can already see in your account. With the **Notion** server connected, you can ask "summarize the decisions in last week's planning notes"; with **Atlassian** connected, you can ask about a Confluence page or a Jira epic.

**Limits.** These servers require you to sign in, and the assistant gets the same access your account has, no more. Results depend on the product's own search, so documents with poor titles or no text (scanned PDFs, images) may not be found. Long documents are often returned in part. Your organization's administrator may need to approve the connector first.

## Act in your tools from a chat window

Many servers can also change things. The **Linear** and **Asana** servers can create and update tasks, and the **Slack** server can post messages. A single request such as "file a bug for the login timeout we just discussed and assign it to me" can turn into one tool call.

**Limits.** Write actions are where mistakes cost the most. The assistant can pick the wrong project, misread a name, or create duplicates. Most chat apps let you require approval for each tool, and the MCP specification recommends that apps keep a person able to deny tool calls. Leave approvals on for anything that sends, deletes or pays. [Is MCP safe?](/learn/is-mcp-safe) explains why.

## Voice assistants on the go

Remote servers live on the internet, not on your computer, so the same connection can follow your account to a phone. Claude's help pages, for example, state that remote connectors work in the mobile app as well as on the web and desktop. A request such as "what's on my task list for today?" can then reach the same **Asana** or **Linear** server you set up at your desk.

**Limits.** Connectors are usually added on the web or desktop first. Whether a particular voice mode can call tools, and whether it asks for approval out loud or on screen, varies by app and changes often, so check your app's current help pages. On a phone you also see less of what the tool returned, which makes it harder to catch a wrong result.

## Coding agents in the editor

Code editors and terminal coding agents, such as Visual Studio Code, Cursor and Claude Code, are MCP hosts too. Developers connect servers that give the agent context it would otherwise guess:

- **Context7** returns version-specific library documentation and examples.
- **GitHub** reads issues, pull requests and code.
- **Sentry** fetches the error report behind a bug.
- **Grep by Vercel** searches code across public repositories.

**Limits.** Every connected tool adds its description to what the model reads, so connecting dozens of servers can make tool choice worse and responses slower. Local servers that run on your machine can execute code with your permissions; VS Code's documentation advises reviewing the publisher, command and requested access before starting one.

## Automation without a chat window

MCP is not limited to chat apps. Both the Claude API and the OpenAI API can attach a remote MCP server to a request, so a scheduled job or a backend service can let a model call, for example, the **Sentry** server to summarize overnight errors or the **Stripe** server to look up a failed payment.

**Limits.** No one is watching to approve each call. Give the automation its own credentials with the narrowest permissions the server offers, prefer read-only tools, and log every call. If the same steps run every time, ordinary code that calls the product's API directly is cheaper and more predictable than a model choosing tools; [MCP vs API vs function calling](/learn/mcp-vs-api-vs-function-calling) compares the options.

## What MCP will not do for you

Connecting a server does not make an assistant better at judgment. It still misunderstands requests, and a server can only do what its tools were built to do. A product with a narrow MCP server (search only, say) stays narrow until its publisher adds more tools. Before relying on any server, read its tool list and try a few calls yourself.

## See a server's tools before you connect it

The fastest way to judge a use case is to look at the actual tools. [Open DeepWiki in the mcptest.io playground](/server/mcp.deepwiki.com/mcp/mcp), ask it about a GitHub repository you know, and compare its answer with what you expected.
