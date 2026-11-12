---
title: "A short history of MCP: from launch to the 2026 specification"
navTitle: MCP timeline
summary: "The Model Context Protocol from its November 2024 launch to the stateless 2026-07-28 revision: governance, adoption, and what each specification revision changed for users."
track: understand
level: newcomer
order: 25
category: Protocol fundamentals
readingTimeMinutes: 4
lastReviewed: "2026-10-20"
metaTitle: "MCP Timeline: Launch, Linux Foundation and Every Spec Revision | mcptest.io"
metaDescription: "A short MCP history: the 2024 launch, the Agentic AI Foundation, vendor adoption, and what the 2024-11-05 to 2026-07-28 revisions changed for users."
relatedSlugs:
  - mcp-explained-for-everyone
  - what-is-mcp
  - is-mcp-safe
  - remote-vs-local
  - mcp-glossary
sourceLinks:
  - title: "Anthropic: Introducing the Model Context Protocol (November 25, 2024)"
    url: "https://www.anthropic.com/news/model-context-protocol"
  - title: "Anthropic: Donating MCP and establishing the Agentic AI Foundation (December 9, 2025)"
    url: "https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation"
  - title: "MCP specification 2024-11-05"
    url: "https://modelcontextprotocol.io/specification/2024-11-05"
  - title: "MCP 2025-03-26 key changes"
    url: "https://modelcontextprotocol.io/specification/2025-03-26/changelog"
  - title: "MCP 2025-06-18 key changes"
    url: "https://modelcontextprotocol.io/specification/2025-06-18/changelog"
  - title: "MCP 2025-11-25 key changes"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/changelog"
  - title: "MCP 2026-07-28 key changes"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/changelog"
  - title: "MCP 2026-07-28 release overview"
    url: "https://blog.modelcontextprotocol.io/posts/2026-07-28/"
  - title: "MCP Registry preview announcement (September 8, 2025)"
    url: "https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/"
---

The Model Context Protocol is less than two years old, and it has changed quickly. Each specification revision is named after its release date. This page covers the milestones and, for each revision, what changed for the people using MCP servers rather than those building them.

## At a glance

| Date | Milestone |
| --- | --- |
| November 25, 2024 | Anthropic announces MCP; first specification, 2024-11-05 |
| March 26, 2025 | Revision 2025-03-26: OAuth-based authorization, Streamable HTTP |
| June 18, 2025 | Revision 2025-06-18: stricter sign-in rules, structured tool output, elicitation |
| September 8, 2025 | Official MCP Registry launches in preview |
| November 25, 2025 | Revision 2025-11-25: icons, incremental consent, URL elicitation |
| December 9, 2025 | MCP donated to the Agentic AI Foundation under the Linux Foundation |
| July 28, 2026 | Revision 2026-07-28: stateless protocol core |

## November 2024: launch

Anthropic announced MCP on November 25, 2024, describing it as an open standard for connecting AI assistants to the systems where data lives. The announcement named Block and Apollo as early adopters, and the developer tool companies Zed, Replit, Codeium and Sourcegraph as working with it.

### Revision 2024-11-05: the first specification

The first specification defined the three roles (host, client and server) and the three things a server can offer: tools, resources and prompts. For users, MCP mostly meant local servers: small programs started by a desktop app on your own computer. A remote option existed, using a pair of HTTP endpoints and Server-Sent Events, but there was no standard way to sign in to a remote server, so few public services offered one.

## 2025: remote servers and sign-in

### Revision 2025-03-26: sign-in and a new remote transport

This revision added an authorization framework based on OAuth 2.1, the same family of standards behind "Sign in with Google". For users, this is what made remote servers for private data practical: you could connect a service by signing in on its own page instead of pasting keys into a configuration file. It also introduced Streamable HTTP, a simpler remote transport that works through one web address, and tool annotations that describe whether a tool only reads or can change or delete things.

### Revision 2025-06-18: safer tokens and structured results

Sign-in was tightened. MCP servers became OAuth resource servers that publish where their tokens come from, and clients had to request tokens for one specific server, so a token given to one server cannot be used against another. The specification gained a dedicated security best practices page. Tools could now return structured data alongside text, and servers could ask the user a question mid-task through **elicitation**, for example to confirm a choice.

### September 2025: the MCP Registry

The official MCP Registry launched in preview as an open catalog and API of publicly available servers, with entries maintained by their publishers. It is meant as a shared source that app directories and other catalogs build on, not as a place you browse directly.

### Revision 2025-11-25: icons, consent in steps, and URL prompts

Servers could show icons for their tools, resources and prompts, which makes connector lists easier to scan. Sign-in gained incremental consent: a server can ask for extra permission only when an action needs it, rather than requesting everything up front. Elicitation gained a URL mode, so a server can send the user to a web page (for example, a payment or account-linking page) instead of collecting sensitive data in the chat. The same revision formalized MCP's governance structure.

### December 2025: the Agentic AI Foundation

On December 9, 2025, Anthropic donated MCP to the newly formed Agentic AI Foundation, a directed fund under the Linux Foundation co-founded by Anthropic, Block and OpenAI, with support from Google, Microsoft, Amazon Web Services, Cloudflare and Bloomberg. Anthropic stated that MCP's existing maintainers and governance model would continue.

The same announcement listed ChatGPT, Cursor, Gemini, Microsoft Copilot and Visual Studio Code among the products that had adopted MCP, and reported more than 10,000 active public MCP servers.

## 2026: a stateless protocol

### Revision 2026-07-28: no sessions, faster and more reliable remote servers

The largest change so far. MCP became stateless: there is no opening handshake and no session, and every request carries the information the server needs. For users, that mostly shows up as reliability. Remote servers can run behind ordinary load balancers and restart without breaking connections, and servers can tell clients how long a tool list can be cached.

Sign-in was hardened again, with checks that stop one authorization server from impersonating another. Three older features (roots, sampling and protocol logging) and the original HTTP-plus-Server-Sent-Events transport were formally deprecated, with at least twelve months before removal. Apps and servers built for 2025 revisions keep working during that window, which is why many clients, including the [mcptest.io playground](/docs/testing-guide), try the 2026 protocol first and fall back to the older handshake.

## Where this leaves users

If you connect remote servers from a chat app or editor, the practical effect of these revisions is that signing in is standard, permissions can be narrower, and the same server works across more apps. [Is MCP safe?](/learn/is-mcp-safe) covers what the security changes do and do not protect against.

## See which revision a server speaks

Servers in the wild run every revision on this page. [Open DeepWiki in the mcptest.io playground](/server/mcp.deepwiki.com/mcp/mcp) to see the protocol version it negotiates, or browse the [catalog](/catalog), where each entry shows the protocol era found in its latest check.
