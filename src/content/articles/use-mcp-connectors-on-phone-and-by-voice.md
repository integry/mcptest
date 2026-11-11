---
title: "Use MCP connectors on your phone and by voice"
navTitle: "MCP on phone and by voice"
summary: "Check Claude and ChatGPT mobile and voice support as of November 2026, distinguish custom-server setup from plugin use, and test a small read action before going hands-free."
track: "use"
level: "newcomer"
order: 401
category: "Use cases"
readingTimeMinutes: 5
lastReviewed: "2026-11-11"
metaTitle: "MCP on phone and by voice | mcptest.io"
metaDescription: "Check Claude and ChatGPT mobile and voice support as of November 2026, distinguish custom-server setup from plugin use, and test a small read action before going hands-free."
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
  - title: "Claude docs: Authentication for connectors"
    url: "https://claude.com/docs/connectors/building/authentication"
  - title: "OpenAI Help: custom MCP servers"
    url: "https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt"
  - title: "OpenAI Help: ChatGPT Voice"
    url: "https://help.openai.com/en/articles/20001274-chatgpt-voice"
  - title: "OpenAI Apps SDK: Connect from ChatGPT"
    url: "https://developers.openai.com/apps-sdk/deploy/connect-chatgpt"
---

A phone is a good place to ask "What needs my attention today?" A remote MCP server can supply the task list behind the answer. A connector is the saved connection between your assistant and that server. Whether the assistant can use it while you speak depends on the app, the voice mode, your plan and your workspace's policy.

The Claude pages below were checked on **11 November 2026**. OpenAI's Help Center pages block automated checks; their details were last read on **24 October 2026**, and OpenAI's developer documentation was checked on 11 November 2026. Two points apply to both assistants:

- Older advice that voice cannot use connected tools is too broad.
- Mobile support for installed plugins does not prove that a phone can add any custom MCP server.

## What the current help pages establish

| Experience | Plans and apps | What the docs establish |
| --- | --- | --- |
| Claude remote custom connectors | Free, Pro, Max, Ultra, Team and Enterprise. The setup steps use the web or desktop app | Free has one custom connector. On Team, only Owners and Primary Owners add them; on Enterprise, Owners, Primary Owners and custom roles with "Manage access to Libraries". Connections run from Anthropic's cloud for every Claude client, including the mobile apps. |
| Claude voice | All six plans; iOS, Android, desktop and web. Voice mode is in beta | Claude can use your connected tools in voice. Free can connect one tool; paid plans can connect more. |
| ChatGPT custom MCP creation | Business and Enterprise/Edu on the web, with role restrictions; Pro with read and fetch actions only | The custom-MCP help page says custom MCP connections are web only. Full MCP, including write actions, is listed for Business and Enterprise/Edu only. Versions of the page have differed on Pro and Plus, so check your own settings. |
| ChatGPT Live voice | Consumer plans and eligible workspaces; web, iOS and Android | Live can use the plugins and connected apps available to your account. It does not give access to a plugin your account lacks. |

Sources: [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [Claude voice](https://support.claude.com/en/articles/11101966-use-voice-mode), [ChatGPT custom MCP](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt), and [ChatGPT Voice](https://help.openai.com/en/articles/20001274-chatgpt-voice). These are product features, not properties of MCP, so check again if your account's menus differ.

## Claude: start with text on your phone

1. Add the remote connector on the web or in the desktop app, following [the Claude connection guide](/learn/add-remote-mcp-server-to-claude). On a Team or Enterprise account, an Owner or an authorized role adds it first; you still sign in to your own connection.
2. Open the same account on your phone and enable the connector for a conversation.
3. Type a narrow request: "Read my Demo task list and give me three task titles. Do not make changes."
4. Open the source task list and compare.

Starting with text catches account, permission and retrieval problems before speech recognition adds another variable.

Claude connects to remote servers from Anthropic's cloud, not from your phone. A service you can reach only on your home Wi-Fi or a corporate VPN is not automatically reachable. A local desktop extension is a separate mechanism; it does not move to your phone with your account.

## Claude: continue by voice

1. Start voice mode in the same conversation. On mobile, tap the voice mode icon next to the microphone in the text field. On the web and desktop, select the sound wave symbol in the lower right of the chat window.
2. Try: "Read those three titles aloud, then tell me which one is due first."
3. Review the tool activity and the source records on screen.

The voice help page says Claude can use the tools you have connected, with examples such as Gmail, Google Calendar, Google Docs and Slack. It also says not every result can be shown on screen in voice mode, and using several tools at once can add a short delay.

The page does not promise that every custom server, interactive interface or tool works on every mobile version, so test your own connector. It also says nothing about approving tool actions by voice. Do not rely on saying "yes" to authorize a change; review the approval controls the app shows.

## ChatGPT: separate creation, installed plugins and Live

ChatGPT packages a custom MCP server as a plugin. Create it on the web, from the Plugins page with **Add custom MCP server**, when your plan and role allow it. [The ChatGPT connection guide](/learn/connect-mcp-server-to-chatgpt) covers the workflow.

According to the custom-MCP Help Center page:

- Business and Enterprise/Edu workspaces can create custom MCP plugins.
- On Business, only admins and owners can create them. On Enterprise/Edu, creation is controlled by role permissions.
- Only admins and owners publish plugins to the workspace.
- Custom MCP connections are web only.

The [Voice help page](https://help.openai.com/en/articles/20001274-chatgpt-voice) says Live, on the web and on mobile, can use the plugins available to the account. Together, those pages do not establish that a custom MCP plugin created on the web works on your phone. Treat that as **unconfirmed for any particular custom server**, and use the web if the plugin is missing on your phone.

For a plugin that is available in your app:

1. Connect it, sign in, and try a small read in text first.
2. Select **Live** in the Voice settings when offered, then ask the same question aloud.

The Voice page describes Live, Advanced and Standard voice. Its plugin instructions are for Live, so do not assume the other options support tools the same way.

For Live actions that need approval, OpenAI documents on-screen review on the web and mobile; spoken approval is not supported. Having Live on a consumer plan does not grant the right to create custom MCP plugins, and workspace settings can restrict both voice and plugins.

## A useful first trip out

Pick a read action with a short result: three tasks, the next calendar event, or a one-document summary. Name the workspace and date explicitly. Ask the assistant to name its source and to say when it could not retrieve one. Check the source links once you can look at the screen.

Keep sensitive results out of shared audio spaces. For "send this", "move the meeting" or "delete those rows", stop and inspect the exact target and the proposed change. The [MCP safety guide](/learn/is-mcp-safe) explains why tool approvals stay useful after you trust the connection.

## Test the server before testing the microphone

Open the remote endpoint in the [mcptest.io playground](/), inspect the tools, and call one read tool with test data. mcptest can expose transport, OAuth and tool-result problems. It cannot confirm that a particular phone app or voice mode will offer the connector. Once the endpoint works, repeat the same call in the app and voice mode you plan to use.
