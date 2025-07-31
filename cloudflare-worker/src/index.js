import { UserState } from "./UserState";

export default {
  async fetch(request, env, ctx) {
    // In a real implementation, you would use a library to verify the Firebase JWT.
    // This is a simplified example of getting the user ID.
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response("Unauthorized", { status: 401 });
    }
    const token = authHeader.substring(7, authHeader.length);
    const userId = getUserIdFromToken(token); // Placeholder for JWT verification logic

    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const id = env.USER_STATE.idFromName(userId);
    const stub = env.USER_STATE.get(id);

    return stub.fetch(request);
  },
};

// Placeholder for a real JWT decoding function
function getUserIdFromToken(token) {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.user_id; // Or `sub` depending on the token structure
    } catch (e) {
        return null;
    }
}

// Export the Durable Object class
export { UserState };