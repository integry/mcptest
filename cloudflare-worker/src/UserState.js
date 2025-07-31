export class UserState {
  constructor(state, env) {
    this.storage = state.storage;
  }

  async fetch(request) {
    if (request.method === "POST") {
      const data = await request.json();
      await this.storage.put("state", data);
      return new Response("State updated", { status: 200 });
    }

    const state = (await this.storage.get("state")) || {};
    return new Response(JSON.stringify(state), {
      headers: { "Content-Type": "application/json" },
    });
  }
}