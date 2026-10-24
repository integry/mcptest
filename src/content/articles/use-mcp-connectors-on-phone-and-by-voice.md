---
title: "Use MCP connectors on your phone and by voice"
navTitle: "MCP on phone and by voice"
summary: "Check Claude and ChatGPT mobile and voice support as of October 2026, distinguish custom-server setup from plugin use, and test a small read action before going hands-free."
track: "use"
level: "newcomer"
order: 401
category: "Use cases"
readingTimeMinutes: 5
lastReviewed: "2026-10-24"
metaTitle: "MCP on phone and by voice | mcptest.io"
metaDescription: "Check Claude and ChatGPT mobile and voice support as of October 2026, distinguish custom-server setup from plugin use, and test a small read action before going hands-free."
relatedSlugs:
  - add-remote-mcp-server-to-claude
  - connect-mcp-server-to-chatgpt
  - what-can-you-do-with-mcp
  - is-mcp-safe
sourceLinks:
  - title: "Claude Help: custom remote MCP connectors"
    url: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
  - title: "Claude Help: voice mode"
    url: "https://support.claude.com/en/articles/11101966-use-voice-mode"
  - title: "OpenAI Help: custom MCP servers"
    url: "https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt"
  - title: "OpenAI Help: ChatGPT Voice"
    url: "https://help.openai.com/en/articles/20001274-chatgpt-voice"
---

A phone is a good place to ask “What needs my attention today?” A remote MCP server can supply the task list behind that answer. Whether your assistant can use that connection while you speak depends on the app, voice mode, plan and workspace policy.

This guide checks the official help pages on **24 October 2026**. Older advice that voice cannot use connected tools is too broad. Equally, mobile support for installed plugins does not prove that a phone can add an arbitrary custom MCP server.

## What the current help pages establish

| Experience | Plans and apps | What the docs establish |
| --- | --- | --- |
| Claude remote custom connectors | Free, Pro, Max, Team, Enterprise; remote connections also apply to mobile | Free has one custom connector. Organization owners or authorized roles control adding servers. |
| Claude voice | All five plans; iOS, Android, desktop and web, in beta | Connected tools can be used in voice, subject to the plan. Free has one connected tool; paid plans can connect more. |
| ChatGPT custom MCP creation | Business and Enterprise/Edu on web; role restrictions apply | The custom-MCP help page explicitly says mobile connection is unsupported. It does not currently list Free, Go, Plus or Pro as eligible for creation. |
| ChatGPT Live voice | Free, Go, Plus, Pro; eligible Business, Enterprise, Edu and Healthcare workspaces; web, iOS and Android | Live can use available plugins and connected apps. It does not grant access to a plugin your account lacks. |

Sources: [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [Claude voice](https://support.claude.com/en/articles/11101966-use-voice-mode), [ChatGPT custom MCP](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt), and [ChatGPT Voice](https://help.openai.com/en/articles/20001274-chatgpt-voice). Check these again if your account's menus differ: these are product capabilities, not properties of MCP itself.

## Claude: start with text on your phone

Configure a remote connector through your account's Connectors controls, following [the Claude connection guide](/learn/add-remote-mcp-server-to-claude). If a mobile setup control is absent, finish configuration on the web, then open the same account and workspace on your phone. For a Team or Enterprise account, have the appropriate owner or role add the connector first; you still authorize your own connection.

Enable it for a conversation and type a narrow request: “Read my Demo task list and give me three task titles. Do not make changes.” Open the source task list and compare. This catches account, permission and retrieval problems before speech recognition adds another variable.

Remote connections originate in Anthropic's cloud even when you use a phone, according to the custom-connector help page. A service visible only on your home Wi-Fi or corporate VPN is not automatically reachable. A local desktop extension is also a separate connection mechanism; it does not move onto your phone with your account.

## Claude: continue by voice

Use the sound-wave control to enter voice mode in the same conversation. Try: “Read those three titles aloud, then tell me which one is due first.” Review the displayed tool activity and source records. The voice help page says connected tools work under the same plan rules as text; it also notes that some results cannot be displayed and multiple tools can add delay.

The page describes connected tools generally, with examples such as Gmail and Slack. It does not certify every custom server, interactive interface or tool on every mobile version. Test your particular connector. It also does not give a universal spoken-approval contract for custom writes, so do not rely on saying “yes” to authorize a change. Review the approval controls your app presents.

## ChatGPT: separate creation, installed plugins and Live

Use the web to create a custom server connection when your plan and role allow it; [the ChatGPT connection guide](/learn/connect-mcp-server-to-chatgpt) covers the workflow. The current custom-MCP Help Center page lists Business and Enterprise/Edu, with Business creation restricted to admins/owners and Enterprise/Edu creation controlled through permissions. Only admins/owners publish workspace apps.

That page's FAQ says custom MCP connections are web only. Meanwhile, the [current Voice help page](https://help.openai.com/en/articles/20001274-chatgpt-voice) says Live on web and mobile can use plugins available to the account. Those statements do not establish that every web-created custom MCP plugin is usable on mobile. Treat that combination as **unconfirmed for an arbitrary custom server**, rather than promising it works after web setup. Use the web when the custom plugin is unavailable on your phone.

For a plugin that is available in your current app, connect it, sign in, and try a small read in text first. Select **Live** under Voice settings when offered, then ask the same question aloud. The Voice page distinguishes Live, Advanced and Standard; its plugin instructions are for Live. Do not infer identical tool support from the presence of another voice option.

For Live actions needing approval, OpenAI documents on-screen review on web and mobile; spoken approval is unsupported. Live access across consumer plans does not confer custom-MCP creation rights, and workspace settings can restrict both voice and apps.

## A useful first trip out

Pick a read action with a short result: three tasks, the next calendar event, or one document summary. Say the workspace and date explicitly. Ask the assistant to identify its source and say when it could not retrieve one. Review source links once you can look at the screen.

Keep sensitive results out of shared audio spaces. For “send this,” “move the meeting,” or “delete those rows,” stop and inspect the exact target and proposed change. The [MCP safety guide](/learn/is-mcp-safe) explains why tool approvals remain useful after you trust the connection.

## Test the server before testing the microphone

Open the remote endpoint in the [mcptest.io playground](/), inspect the tools, and call one read tool with synthetic data. mcptest can expose transport, OAuth and tool-result problems. It cannot certify that a particular phone app or voice mode will offer that connector. Once the endpoint works, repeat that one call in the actual app and mode you intend to use.
