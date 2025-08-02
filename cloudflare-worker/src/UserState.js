export class UserState {
  constructor(state, env) {
    this.storage = state.storage;
  }

  async fetch(request) {
    console.log(`[DEBUG] UserState: Received ${request.method} request`);
    
    if (request.method === "POST") {
      try {
        const data = await request.json();
        console.log("[DEBUG] UserState: Received data to save:", JSON.stringify(data));
        
        await this.storage.put("state", data);
        console.log("[DEBUG] UserState: Data successfully saved to Durable Object storage");
        
        return new Response("State updated", { status: 200 });
      } catch (error) {
        console.error("[DEBUG] UserState: Error saving data:", error);
        return new Response(`Error saving data: ${error.message}`, { status: 500 });
      }
    }

    try {
      const state = (await this.storage.get("state")) || {};
      console.log("[DEBUG] UserState: Retrieved state from storage:", JSON.stringify(state));
      
      return new Response(JSON.stringify(state), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("[DEBUG] UserState: Error retrieving data:", error);
      return new Response(`Error retrieving data: ${error.message}`, { status: 500 });
    }
  }
}