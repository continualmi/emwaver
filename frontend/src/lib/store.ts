import { backendFetch } from "./backend";

export type CreateCheckoutSessionResponse = {
  url: string;
  session_id: string;
  order_id?: string;
};

export async function createCheckoutSession(params: {
  email: string;
  quantity: number;
  idToken?: string;
}): Promise<CreateCheckoutSessionResponse> {
  const res = await backendFetch("/v1/store/checkout_session", params.idToken || "", {
    method: "POST",
    body: JSON.stringify({ email: params.email, quantity: params.quantity }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return JSON.parse(text);
}

export async function claimOrder(params: { sessionId: string; idToken: string }) {
  const res = await backendFetch("/v1/store/orders/claim", params.idToken, {
    method: "POST",
    body: JSON.stringify({ session_id: params.sessionId }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return JSON.parse(text) as { order: any };
}
