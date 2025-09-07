from playwright.sync_api import sync_playwright

def run(playwright):
    # Define the localStorage content
    storage_state = {
        "origins": [
            {
                "origin": "http://localhost:5173",
                "localStorage": [
                    {
                        "name": "mcp_tested_servers",
                        "value": """[
                            { "url": "server1.com", "score": 95, "timestamp": 1678886400000 },
                            { "url": "server2.com", "score": 80, "timestamp": 1678886300000 },
                            { "url": "server3.com", "score": 75, "timestamp": 1678886200000 }
                        ]"""
                    }
                ]
            }
        ]
    }

    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(storage_state=storage_state)
    page = context.new_page()

    # Capture console logs
    page.on("console", lambda msg: print(f"Browser console: {msg.text}"))

    page.goto("http://localhost:5173/report/dummy.server.com")

    page.wait_for_selector("[data-testid=recent-reports-panel]", timeout=10000)

    page.screenshot(path="jules-scratch/verification/01-server-list.png")

    # Click on the second server in the list
    page.locator("text=server2.com").click()
    page.screenshot(path="jules-scratch/verification/02-server-selected.png")

    # Remove the first server from the list
    page.locator("li:has-text('server1.com') >> text=×").click()
    page.screenshot(path="jules-scratch/verification/03-server-removed.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
