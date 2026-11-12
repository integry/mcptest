---
title: "Chat with your own data: connect a database, spreadsheet or docs to Claude or ChatGPT with MCP"
navTitle: "Chat with your own data"
summary: "Connect Supabase, Airtable or Notion to your assistant, start with a small read-only question, and check permissions and results in mcptest.io before trusting the answers."
track: "use"
level: "newcomer"
order: 400
category: "Use cases"
readingTimeMinutes: 6
lastReviewed: "2026-11-11"
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
  - title: "Notion: get started with MCP"
    url: "https://developers.notion.com/guides/mcp/get-started-with-mcp"
---

"Which customers are waiting on us?" is an ordinary question. Answering it usually means finding a table, remembering its filters and opening the notes behind each row. An MCP connection gives your assistant tools that fetch that information from where it already lives.

You do not need to build anything for the three paths below. Each uses a remote MCP server hosted by the service itself, listed in the [mcptest.io catalog](/catalog). Start with a small set of data whose answer you already know.

## Choose where the data already lives

| Your data | Remote endpoint | A useful first question |
| --- | --- | --- |
| A Supabase Postgres project | `https://mcp.supabase.com/mcp` | "List the tables in this test project. Do not change anything." |
| An Airtable base: spreadsheet-like tables and records | `https://mcp.airtable.com/mcp` | "Show five open tasks from my Demo base, including their record IDs." |
| Notion pages and databases | `https://mcp.notion.com/mcp` | "Find the Demo planning page and summarize its decisions, linking the page." |

All three were recorded as `online` in this site's catalog checks on **2 November 2026**. Those checks only reached each server's OAuth sign-in challenge. They did **not** sign in or read anyone's private data. A reachable server is a starting point, not a promise that your account or assistant can use every tool.

Airtable is the spreadsheet-like option here. None of these URLs connects an Excel file or a Google Sheet, and Supabase connects only Supabase projects, not any SQL database.

## Connect the server once

1. Open the server from the [catalog](/catalog) in the playground. Check that the hostname matches the endpoint above.
2. Start its OAuth sign-in. Read the requested access, choose your test workspace, and approve only the access you intend to grant. Never paste passwords or keys into the chat.
3. Look at the list of tools the server returns. Try search, list or read tools first. Leave update, execute and delete tools alone for this first test.
4. Add the same endpoint to your assistant. [The Claude setup guide](/learn/add-remote-mcp-server-to-claude) and [the ChatGPT setup guide](/learn/connect-mcp-server-to-chatgpt) cover the current menus and workspace permissions. Signing in on mcptest does not sign your assistant in; each app has its own sign-in.
5. Turn the connection on in a new conversation and ask one of the questions above. Ask the assistant to name the tool it used and show the record or page IDs.

If your assistant already lists the service in its own connector directory, installing from there is often easier. If the option to add a custom connection is missing, your plan or administrator may not allow it. That is never a reason to paste a database password into chat.

## Database path: Supabase

Use a development project, or a branch with made-up data.

1. On Supabase's MCP setup page, choose the project and the read-only option.
2. Copy the URL it generates. It adds settings to the base endpoint, such as `project_ref` (one project), `read_only=true` and `features` (which tool groups are on).
3. Use that generated URL in both the playground and your assistant.

[Supabase's documentation](https://supabase.com/docs/guides/ai-tools/mcp) explains these settings. Without a `project_ref`, access can extend to every project in your account. Supabase advises connecting to production only when you need to, and then scoping it to one project, using read-only mode and limiting features. It also advises keeping tool approvals on and reviewing each tool call.

After listing tables, try: "Count rows in the demo orders table by status. Show the SQL and the counts. Do not include customer emails." Compare the result with a saved query in your Supabase dashboard. Read-only SQL can still reveal sensitive data, scan large tables and add cost, so limit what the connection can reach, not just what you ask for.

## Spreadsheet path: Airtable

1. Make a Demo base with five tasks and known statuses.
2. Connect Airtable and approve access.
3. Ask the assistant to find the base, list its tables and read a few records before you ask for totals.

[Airtable's help page](https://support.airtable.com/v1/docs/using-the-airtable-mcp-server) says MCP access follows your existing Airtable permissions and is available on all Airtable plans. You can add or remove the bases a connection can reach afterwards, on Airtable's third-party integrations page. Your AI app's plan and your organization's integration policy still apply. If you can edit a base, the server can also create and update its records, so "connected successfully" does not mean "read-only".

Ask: "How many Demo tasks are open? Include record IDs and tell me if results were paginated." A filtered view, an incomplete set of pages or unclear status labels can explain a wrong count. Before any change later, ask for a preview of the exact record IDs and new values, then review the approval prompt.

## Docs path: Notion

1. Connect the hosted endpoint and sign in to your test workspace.
2. Create a page named "Demo planning" with three decisions you will recognize.
3. Ask the assistant to search for that title, read the page and give you a summary with a page link.

[Notion's documentation](https://developers.notion.com/guides/mcp/overview) says its hosted MCP server uses OAuth and can read and update the content you can access in the workspace you select. Workspace guests cannot connect. If search finds nothing, check the workspace, the page permissions and the tools the server actually returned. A confident answer without a retrieved page is not evidence the assistant read your notes.

The assistant fetches content when it needs it. That does not guarantee it read every attachment, image, linked page or long page. Ask what it searched and what it left out.

## Where your information goes

A tool result travels from the service, through its MCP server, to the AI app, where it becomes part of the conversation. Testing a private tool in mcptest also puts the result in your testing session. Use made-up records for the first pass, and do not share reports that contain private results or tokens.

Signing in limits what the assistant can reach. It does not make the content it retrieves safe to follow as instructions: a document can contain text that tries to steer the assistant. Keep approvals for changes turned on, look into unexpected tool calls, and disconnect in both the assistant and the service when you finish. The [server trust checklist](/learn/mcp-server-trust-checklist) walks through that review.

## Test one answer before trusting ten

Go back to the [mcptest.io playground](/), sign in to the same endpoint, list its tools and make one narrow read call. Compare the raw result with the assistant's answer. If the raw data is right but the answer is wrong, improve the question. If the tool result is wrong or missing, fix the connection and permissions first.
