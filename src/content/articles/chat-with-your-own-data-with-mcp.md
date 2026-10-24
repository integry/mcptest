---
title: "Chat with your own data: connect a database, spreadsheet or docs to Claude or ChatGPT with MCP"
navTitle: "Chat with your own data"
summary: "Connect Supabase, Airtable or Notion to your assistant, start with a small read-only question, and check permissions and results in mcptest.io before trusting the answers."
track: "use"
level: "newcomer"
order: 400
category: "Use cases"
readingTimeMinutes: 6
lastReviewed: "2026-10-24"
metaTitle: "Chat with your own data | mcptest.io"
metaDescription: "Connect Supabase, Airtable or Notion to your assistant, start with a small read-only question, and check permissions and results in mcptest.io before trusting the answers."
relatedSlugs:
  - what-can-you-do-with-mcp
  - add-remote-mcp-server-to-claude
  - connect-mcp-server-to-chatgpt
  - mcp-server-trust-checklist
sourceLinks:
  - title: "Supabase: hosted MCP and security"
    url: "https://supabase.com/docs/guides/ai-tools/mcp"
  - title: "Airtable: using the MCP server"
    url: "https://support.airtable.com/v1/docs/using-the-airtable-mcp-server"
  - title: "Notion: MCP overview"
    url: "https://developers.notion.com/guides/mcp/overview"
---

“Which customers are waiting on us?” is an ordinary question. Answering it usually means finding a table, remembering its filters, and opening the notes behind each row. An MCP connection gives your assistant tools to retrieve that information from its original home.

You do not need to build a server for these three paths. Each uses a publisher-hosted remote server in the [mcptest.io catalog](/catalog). Start with a small dataset whose answer you already know.

## Choose where the data already lives

| Your data | Remote endpoint | A useful first question |
| --- | --- | --- |
| A Supabase Postgres project | `https://mcp.supabase.com/mcp` | “List the tables in this test project. Do not change anything.” |
| An Airtable base: spreadsheet-like tables and records | `https://mcp.airtable.com/mcp` | “Show five open tasks from my Demo base, including their record IDs.” |
| Notion pages and databases | `https://mcp.notion.com/mcp` | “Find the Demo planning page and summarize its decisions, linking the page.” |

All three have `online` records in this site's `catalogValidation.json`, checked on **20 October 2026**. Those checks reached their OAuth sign-in challenges; they did **not** complete authorization or verify access to anyone's private data. A reachable server is a starting point, not a promise that your account or client can use every tool.

Airtable covers the spreadsheet-like path here. These URLs do not connect an arbitrary Excel file or Google Sheet, and Supabase does not connect an unrelated database just because it speaks SQL.

## Connect the server once

1. Open the server from the [catalog](/catalog) in the playground. Check that the hostname matches the publisher's endpoint above.
2. Start its OAuth sign-in. Read the requested access, choose your test workspace, and approve only access you intend to grant. Keep credentials out of the chat prompt.
3. Inspect the discovered tool list. Look for search, list or read tools first; leave update, execute or delete tools alone for this first experiment.
4. Add the same endpoint in your assistant. Use [the Claude setup guide](/learn/add-remote-mcp-server-to-claude) or [the ChatGPT setup guide](/learn/connect-mcp-server-to-chatgpt) for the current menus and workspace permissions. Signing in to mcptest does not sign the assistant in; each client has its own authorization.
5. Enable the connection in a new conversation and ask one of the questions above. Ask it to name the tool it used and show the source identifiers.

If your assistant has the service in its own connector directory, that is often the easiest installation route. A missing custom-connection option can be a plan or administrator restriction. It does not mean you should paste a database password into chat.

## Database path: Supabase

Use a development project or a branch containing synthetic data. In Supabase's MCP setup page, choose the project and its read-only option. Copy the generated endpoint, including its project and feature restrictions, into the playground and the assistant. The base URL above identifies the server; the setup page produces the narrower URL for your project.

[Supabase's documentation](https://supabase.com/docs/guides/ai-tools/mcp) describes project scoping and feature groups. Without a selected project, access can extend across projects. Its guidance recommends development data and careful review of tool calls.

After listing tables, try: “Count rows in the demo orders table by status. Show the SQL and the counts. Do not include customer emails.” Compare with a saved query in your database dashboard. Read-only SQL can still reveal sensitive information, scan large tables, and incur costs; restrict the account as well as the prompt.

## Spreadsheet path: Airtable

Make a Demo base with five tasks and known statuses, then connect Airtable and select only the bases needed for the experiment in its consent flow. Ask the assistant to find the base, list its tables, and read a few records before asking for totals.

[Airtable's help page](https://support.airtable.com/v1/docs/using-the-airtable-mcp-server) says MCP access follows your Airtable permissions and is available on all Airtable plans. Your AI app's own plan and your organization's integration policy still apply. The server can also create and update records, so “connected successfully” does not imply “read-only.”

Ask: “How many Demo tasks are open? Include record IDs and tell me if results were paginated.” A filtered view, incomplete pagination, or ambiguous status labels can explain a wrong count. For a change later, request a preview of the exact record IDs and new values, then review the action approval.

## Docs path: Notion

Connect the hosted endpoint, authorize your test workspace, and create a page named “Demo planning” with three decisions you can recognize. Ask the assistant to search for that title, read the page, and give you a summary with a page link.

[Notion's documentation](https://developers.notion.com/guides/mcp/overview) says its hosted MCP connection uses OAuth and can read and update content you can access. If search finds nothing, check the workspace, the page permissions, and the tools actually returned by the server. An assistant's confident answer without a retrieved page is not evidence it read your notes.

This is retrieval on demand. It does not guarantee every attachment, image, linked document or long page was read. Ask what was searched and what was left out.

## Where your information goes

A tool result travels from the data service through its MCP server to the AI host, where it becomes conversation context. Testing a private tool in mcptest also puts its result in your testing session. Use synthetic records for the first pass and avoid sharing reports containing private results or tokens.

OAuth limits access but does not make retrieved content trustworthy instructions. A document can contain text that tries to redirect the assistant. Keep write approvals enabled, inspect unexpected tool calls, and disconnect in both the assistant and the service when the experiment is over. The [server trust checklist](/learn/mcp-server-trust-checklist) walks through that review.

## Test one answer before trusting ten

Return to the [mcptest.io playground](/), authorize the same endpoint, list its tools and make one narrow read call. Compare the raw result with the assistant's answer. If the raw data is right but the answer is wrong, improve the question or retrieval; if the tool result is wrong or inaccessible, fix the connection and permissions first.
